import { z } from 'zod';

export const ConfigSchema = z.object({
  specage_version: z.string(),
  project: z.string(),
  spec_file: z.string(),
  reviewer: z.string(),
  intern: z.object({
    repo: z.string(),
    workflow: z.string().default('dispatcher.yml'),
    backend: z.string().default('claude'),
  }),
  auto_implement: z.boolean().default(true),
  pages: z.object({
    mode: z.enum(['gh-pages-subdir', 'off']).default('gh-pages-subdir'),
    path: z.string().default('specage'),
  }),
  ui: z.object({ url: z.string().optional() }).default({}),
});
export type Config = z.infer<typeof ConfigSchema>;

const Action = z.enum(['refresh', 'amend', 'ask']);
const Timing = z.object({ early: Action, late: Action });
export const PolicySchema = z.object({
  reconcile: z.object({
    cosmetic: Timing,
    refinement: Timing,
    addition: Timing,
    reversal: Timing,
    unsure: Action,
  }),
  split_items: Action,
});
export type Policy = z.infer<typeof PolicySchema>;

export const Hash = z.string().regex(/^[0-9a-f]{12}$/);

export const EvidenceSchema = z.object({
  kind: z.string(),
  ref: z.union([z.string(), z.number()]).transform(String),
  commit: z.string().optional(),
  tier: z.enum(['tested', 'located', 'asserted']).optional(),
  inherited: z.boolean().optional(),
  url: z.string().optional(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const TraceNodeSchema = z.object({
  spec_hash: Hash,
  status: z.enum(['planned', 'in_progress', 'implemented', 'contradiction', 'absent']),
  evidence: z.array(EvidenceSchema).default([]),
  verified: z.object({ by: z.string(), at: z.string(), hash: Hash }).optional(),
  discovered: z.object({ dispatch: z.string() }).optional(),
});
export const TraceSchema = z.object({
  retired_ids: z.array(z.string()).default([]),
  /** IDs whose `<-` clause has been consumed by a dispatch (drives lint W105) */
  consumed_lineage: z.array(z.string()).default([]),
  nodes: z.record(TraceNodeSchema).default({}),
});
export type Trace = z.infer<typeof TraceSchema>;

export const WorkItemSchema = z.object({
  id: z.string(),
  issue: z.number().nullable().default(null),
  pr: z.number().nullable().default(null),
  state: z.enum(['filed', 'in_progress', 'in_review', 'merged', 'closed']),
  relations: z
    .array(
      z.union([
        z.object({ supersedes: z.string() }),
        z.object({ stacked_on: z.string() }),
        z.object({ follows: z.string() }),
      ]),
    )
    .default([]),
  claims: z.record(z.object({ hash: Hash, status: z.enum(['pending', 'done']) })).default({}),
});
export const WorkSchema = z.object({ items: z.array(WorkItemSchema).default([]) });
export type Work = z.infer<typeof WorkSchema>;

export const QuestionSchema = z.object({
  id: z.string(),
  node: z.string(),
  node_hash: Hash,
  dispatch: z.string(),
  kind: z.enum(['ambiguity', 'contradiction', 'reconcile', 'rename', 'split']),
  text: z.string(),
  options: z.array(z.string()).optional(),
  state: z.enum(['open', 'addressed', 'resolved', 'withdrawn']),
  answer: z.string().nullable().default(null),
});
export const QuestionsSchema = z.array(QuestionSchema);
export type Question = z.infer<typeof QuestionSchema>;

export const OutboxSchema = z.object({
  id: z.string(),
  kind: z.enum(['implement', 'amend', 'answer', 'continue']),
  target: z.number().int().positive(),
  body: z.string(),
  created: z.string(),
});
export type OutboxEntry = z.infer<typeof OutboxSchema>;

export interface State {
  trace: Trace;
  work: Work;
  questions: Question[];
}
