import {
  IMAGE_TYPES,
  MAX_COMMENT_LEN,
  MAX_IMAGES,
  MAX_IMAGE_BYTES,
  type Thread,
} from '@specage/core/browser';
import { api, ApiError } from './api.js';
import { h } from './dom.js';

export type ThreadFilter = 'open' | 'resolved' | 'all';

export const openCount = (threads: Thread[], node: string) =>
  threads.filter((t) => t.node === node && t.state === 'open').length;

export const byFilter = (threads: Thread[], f: ThreadFilter) =>
  threads.filter((t) => f === 'all' || t.state === f);

const when = (at: string) => at.slice(0, 16).replace('T', ' ');

/** Read-only thread (static viewer). Text only; never innerHTML. */
export function threadView(t: Thread, actions?: HTMLElement | null): HTMLElement {
  return h(
    'div',
    { class: `thread th-${t.state}`, 'data-thread': t.id },
    h('div', { class: 'thread-head' }, h('span', { class: 'th-state' }, t.state), ` ${t.id}`),
    ...t.comments.map((c) =>
      h(
        'div',
        { class: 'comment' },
        h('div', { class: 'cmeta' }, h('strong', {}, c.author), ` · ${when(c.at)}`),
        h('div', { class: 'cbody' }, c.body),
        c.images?.length
          ? h(
              'div',
              { class: 'thumbs' },
              ...c.images.filter((i) => IMAGE_TYPES.includes(i.type)).map(thumb),
            )
          : null,
      ),
    ),
    t.state === 'resolved' && t.resolved_by
      ? h('div', { class: 'cmeta' }, `resolved by ${t.resolved_by}`)
      : null,
    actions,
  );
}

export interface Attached {
  type: string;
  data: string;
}

/** Image files on a clipboard (`DataTransferItemList`-like). Non-image items are ignored. */
export function clipboardImages(
  items: ArrayLike<{ kind: string; type: string; getAsFile(): File | null }> | undefined,
): File[] {
  const out: File[] = [];
  for (const it of Array.from(items ?? []))
    if (it.kind === 'file' && it.type.startsWith('image/')) {
      const f = it.getAsFile();
      if (f) out.push(f);
    }
  return out;
}

/** Why `file` cannot be attached next to `count` existing images, or null. */
export const imageProblem = (file: { type: string; size: number }, count: number) =>
  count >= MAX_IMAGES
    ? `at most ${MAX_IMAGES} images`
    : !IMAGE_TYPES.includes(file.type)
      ? `image type ${file.type} not allowed`
      : file.size > MAX_IMAGE_BYTES
        ? `image larger than ${MAX_IMAGE_BYTES / 1024} KB`
        : null;

const toBase64 = (f: File) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] ?? '');
    r.onerror = () => rej(r.error);
    r.readAsDataURL(f);
  });

const thumb = (i: Attached) =>
  h('img', { class: 'thumb', alt: 'attached image', src: `data:${i.type};base64,${i.data}` });

export interface ThreadsCtx {
  repo: string;
  threads: Thread[];
  /** called with the full, merged thread list after a successful write */
  onChange(threads: Thread[]): void;
}

let filter: ThreadFilter = 'open';

/** Interactive panel for one node: filter, threads, reply/resolve/reopen, new-thread composer. */
export function threadsPanel(
  node: { id: string; hash: string },
  ctx: ThreadsCtx,
  rerender: () => void,
): HTMLElement {
  const err = h('p', { class: 'error', role: 'alert' });
  const send = async (body: Record<string, unknown>) => {
    err.textContent = '';
    try {
      const r = await api<{ threads: Thread[] }>('POST', `/api/r/${ctx.repo}/comments`, body);
      ctx.onChange(r.threads);
    } catch (e) {
      err.textContent = e instanceof ApiError ? e.message : String(e);
    }
  };
  /** Textarea whose pasted images become removable thumbnails (shown in `strip`). */
  const box = (label: string) => {
    const images: Attached[] = [];
    const strip = h('div', { class: 'thumbs' });
    const draw = () => {
      strip.replaceChildren(
        ...images.map((i) =>
          h(
            'span',
            { class: 'thumb-wrap' },
            thumb(i),
            h(
              'button',
              {
                class: 'thumb-x',
                type: 'button',
                'aria-label': 'Remove image',
                onclick: () => {
                  images.splice(images.indexOf(i), 1);
                  draw();
                },
              },
              '×',
            ),
          ),
        ),
      );
    };
    const ta = h('textarea', {
      rows: '2',
      maxlength: String(MAX_COMMENT_LEN),
      placeholder: label,
      'aria-label': label,
      onpaste: (e: ClipboardEvent) => {
        const files = clipboardImages(e.clipboardData?.items);
        if (!files.length) return; // plain text paste stays normal
        e.preventDefault();
        err.textContent = '';
        void (async () => {
          for (const f of files) {
            const p = imageProblem(f, images.length);
            if (p) {
              err.textContent = p;
              continue;
            }
            images.push({ type: f.type, data: await toBase64(f) });
          }
          draw();
        })();
      },
    }) as HTMLTextAreaElement & { images: Attached[]; strip: HTMLElement };
    ta.images = images;
    ta.strip = strip;
    return ta;
  };
  const payload = (b: { images: Attached[] }, extra: Record<string, unknown>) => ({
    ...extra,
    ...(b.images.length ? { images: b.images } : {}),
  });

  const mine = ctx.threads.filter((t) => t.node === node.id);
  const sel = h(
    'select',
    {
      'aria-label': 'Thread filter',
      class: 'th-filter',
      onchange: (e: any) => {
        filter = e.target.value;
        rerender();
      },
    },
    ...(['open', 'resolved', 'all'] as const).map((f) => h('option', { value: f }, f)),
  ) as HTMLSelectElement;
  sel.value = filter;

  const panel = h('div', { class: 'threads', id: 'threads' }, h('h4', {}, 'Comments ', sel));
  for (const t of byFilter(mine, filter)) {
    const reply = box('Reply…');
    const actions = h(
      'div',
      { class: 'thread-actions' },
      t.state === 'open' ? reply : null,
      t.state === 'open' ? reply.strip : null,
      t.state === 'open'
        ? h(
            'button',
            {
              class: 'btn',
              onclick: () =>
                reply.value.trim() &&
                send(payload(reply, { op: 'reply', thread: t.id, body: reply.value })),
            },
            'Reply',
          )
        : null,
      h(
        'button',
        {
          class: 'btn',
          onclick: () => send({ op: t.state === 'open' ? 'resolve' : 'reopen', thread: t.id }),
        },
        t.state === 'open' ? 'Resolve' : 'Reopen',
      ),
    );
    panel.append(threadView(t, actions));
  }
  if (!byFilter(mine, filter).length)
    panel.append(h('p', { class: 'note' }, `No ${filter === 'all' ? '' : filter + ' '}threads.`));
  const nb = box('Start a thread on this node…');
  panel.append(
    nb,
    nb.strip,
    h(
      'button',
      {
        class: 'btn',
        id: 'new-thread',
        onclick: () =>
          nb.value.trim() && send(payload(nb, { op: 'create', node: node.id, body: nb.value })),
      },
      'Comment',
    ),
    err,
  );
  return panel;
}
