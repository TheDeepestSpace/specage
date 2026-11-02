import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import {
  CommentsFileSchema,
  QuestionsSchema,
  ThreadEventsSchema,
  TraceSchema,
  WorkSchema,
  type State,
  type Thread,
} from './schemas.js';

export interface StateIssue {
  file: string;
  message: string;
}

const HASH_KEYS = new Set(['spec_hash', 'hash', 'node_hash']);

/**
 * YAML.parse that keeps hash values as strings. A 12-hex-digit hash such as 123456789012 or
 * 12e456789012 is a valid YAML number, and would otherwise lose its text (and fail the schema).
 */
export function parseYaml(text: string): unknown {
  const doc = YAML.parseDocument(text);
  YAML.visit(doc, {
    Pair(_, pair) {
      const k = pair.key as any;
      const v = pair.value as any;
      if (
        HASH_KEYS.has(String(k?.value)) &&
        YAML.isScalar(v) &&
        typeof v.value === 'number' &&
        v.source !== undefined
      )
        v.value = v.source;
    },
  });
  return doc.toJS() ?? undefined;
}

function readYaml(p: string): unknown {
  return existsSync(p) ? parseYaml(readFileSync(p, 'utf8')) : undefined;
}

export function parseState(raw: {
  trace?: unknown;
  work?: unknown;
  questions?: unknown;
  thread_events?: unknown;
}): {
  state: State;
  issues: StateIssue[];
} {
  const issues: StateIssue[] = [];
  const run = <T>(
    file: string,
    schema: { safeParse(v: unknown): any },
    v: unknown,
    dflt: unknown,
  ): T => {
    const r = schema.safeParse(v ?? dflt);
    if (r.success) return r.data as T;
    for (const i of r.error.issues)
      issues.push({ file, message: `${i.path.join('.')}: ${i.message}` });
    return schema.safeParse(dflt).data as T;
  };
  return {
    state: {
      trace: run('trace.yaml', TraceSchema, raw.trace, {}),
      work: run('work.yaml', WorkSchema, raw.work, {}),
      questions: run('questions.yaml', QuestionsSchema, raw.questions, []),
      thread_events: run('thread-events.yaml', ThreadEventsSchema, raw.thread_events, []),
    },
    issues,
  };
}

/** Load and validate a trail-branch checkout directory. */
export function loadState(dir: string) {
  const r = parseState({
    trace: readYaml(join(dir, 'trace.yaml')),
    work: readYaml(join(dir, 'work.yaml')),
    questions: readYaml(join(dir, 'questions.yaml')),
    thread_events: readYaml(join(dir, 'thread-events.yaml')),
  });
  // outbox entries
  return r;
}

export function parseComments(text: string | null | undefined): {
  threads: Thread[];
  issues: string[];
} {
  if (!text) return { threads: [], issues: [] };
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (e) {
    return { threads: [], issues: [`comments.yaml: ${(e as Error).message}`] };
  }
  const r = CommentsFileSchema.safeParse(raw ?? {});
  if (r.success) return { threads: r.data.threads, issues: [] };
  return {
    threads: [],
    issues: r.error.issues.map((i) => `comments.yaml ${i.path.join('.')}: ${i.message}`),
  };
}

export function stringifyComments(threads: Thread[]): string {
  return YAML.stringify({ threads });
}

/** Load `comments.yaml` from a spec-branch checkout directory (absent file = no threads). */
export function loadComments(dir: string) {
  const p = join(dir, 'comments.yaml');
  return parseComments(existsSync(p) ? readFileSync(p, 'utf8') : null);
}
