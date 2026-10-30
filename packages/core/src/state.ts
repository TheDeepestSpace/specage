import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import {
  QuestionsSchema,
  TraceSchema,
  WorkSchema,
  type State,
} from './schemas.js';

export interface StateIssue {
  file: string;
  message: string;
}

function readYaml(p: string): unknown {
  return existsSync(p) ? (YAML.parse(readFileSync(p, 'utf8')) ?? undefined) : undefined;
}

export function parseState(raw: { trace?: unknown; work?: unknown; questions?: unknown }): {
  state: State;
  issues: StateIssue[];
} {
  const issues: StateIssue[] = [];
  const run = <T>(file: string, schema: { safeParse(v: unknown): any }, v: unknown, dflt: unknown): T => {
    const r = schema.safeParse(v ?? dflt);
    if (r.success) return r.data as T;
    for (const i of r.error.issues) issues.push({ file, message: `${i.path.join('.')}: ${i.message}` });
    return schema.safeParse(dflt).data as T;
  };
  return {
    state: {
      trace: run('trace.yaml', TraceSchema, raw.trace, {}),
      work: run('work.yaml', WorkSchema, raw.work, {}),
      questions: run('questions.yaml', QuestionsSchema, raw.questions, []),
    },
    issues,
  };
}

/** Load and validate a spec-state checkout directory. */
export function loadState(dir: string) {
  const r = parseState({
    trace: readYaml(join(dir, 'trace.yaml')),
    work: readYaml(join(dir, 'work.yaml')),
    questions: readYaml(join(dir, 'questions.yaml')),
  });
  // outbox entries
  return r;
}
