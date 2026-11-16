import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';

/** Set the state of the work item for an issue/PR in `<dir>/work.yaml`. Returns false if none matches. */
export function setWorkState(
  dir: string,
  at: { issue?: number; pr?: number },
  state: string,
): boolean {
  const file = join(dir, 'work.yaml');
  if (!existsSync(file)) return false;
  const doc = YAML.parseDocument(readFileSync(file, 'utf8'));
  const items = doc.get('items') as YAML.YAMLSeq | null;
  if (!items || !YAML.isSeq(items)) return false;
  let hit = false;
  for (const it of items.items) {
    if (!YAML.isMap(it)) continue;
    const issue = it.get('issue');
    const pr = it.get('pr');
    if ((at.issue && issue === at.issue) || (at.pr && pr === at.pr)) {
      it.set('state', state);
      if (at.pr && !pr) it.set('pr', at.pr);
      hit = true;
    }
  }
  if (hit) writeFileSync(file, String(doc));
  return hit;
}

export interface InvocationUpdate {
  id: string;
  kind?: string;
  status: string;
  nodes?: string[];
  runUrl?: string;
  now?: string;
}

/**
 * Check-in / check-out: upsert one dispatch record in `<dir>/invocations.yaml`.
 * Check-in sets queued/in_progress; check-out sets success/failure (and `finished`).
 */
export function setInvocation(dir: string, u: InvocationUpdate): void {
  const file = join(dir, 'invocations.yaml');
  const doc = existsSync(file)
    ? YAML.parseDocument(readFileSync(file, 'utf8'))
    : new YAML.Document();
  const root = (doc.toJS() as { items?: any[] } | null) ?? {};
  const items = root.items ?? [];
  const at = u.now ?? new Date().toISOString();
  let it = items.find((i) => i.id === u.id);
  if (!it) {
    if (!u.kind) throw new Error('--kind is required for a new invocation');
    it = { id: u.id, kind: u.kind, status: u.status, nodes: u.nodes ?? [] };
    items.push(it);
  }
  it.status = u.status;
  if (u.kind) it.kind = u.kind;
  if (u.nodes?.length) it.nodes = u.nodes;
  if (u.runUrl) it.run_url = u.runUrl;
  if (u.status === 'in_progress' || u.status === 'queued') it.started ??= at;
  if (u.status === 'success' || u.status === 'failure') it.finished = at;
  writeFileSync(file, YAML.stringify({ items }));
}
