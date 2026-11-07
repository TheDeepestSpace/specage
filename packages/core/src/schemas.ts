import { z } from 'zod';

export const ConfigSchema = z.object({
  specage_version: z.string(),
  project: z.string(),
  /** the project's code repo (owner/repo); issues, PRs and Pages live here */
  repo: z.string().optional(),
  /** the shared data repo holding the specages/<project>/{spec,trail} branches */
  data_repo: z.string().optional(),
  spec_file: z.string(),
  reviewer: z.string(),
  intern: z.object({
    repo: z.string(),
    workflow: z.string().default('dispatcher.yml'),
    backend: z.string().default('claude'),
    /** complexity tier -> model/effort; the planner rates an issue and copies its tier's values into the outbox entry */
    tiers: z
      .record(z.object({ model: z.string().optional(), effort: z.string().optional() }))
      .default({}),
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
  state: z.enum([
    'filed',
    'in_progress',
    'in_review',
    'merged',
    'closed',
    'withdrawn',
    'failed',
    'needs_human',
  ]),
  /** why the planner last changed this item's state or issue (reconcile: updated / withdrawn / reopened) */
  reason: z.string().optional(),
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
  /** `id@hash` claims the dispatched run must satisfy (verified on callback) */
  spec_ids: z.array(z.string()).default([]),
  created: z.string(),
  /** planner's complexity rating, a key of `intern.tiers` */
  complexity: z.string().optional(),
  /** per-entry overrides of the config/CLI defaults, resolved from the tier by the planner */
  backend: z.string().optional(),
  model: z.string().optional(),
  effort: z.string().optional(),
  /** set by `outbox fire --unfired` once dispatched (idempotency mark) */
  fired: z.string().optional(),
});
export type OutboxEntry = z.infer<typeof OutboxSchema>;

export interface State {
  trace: Trace;
  work: Work;
  questions: Question[];
  thread_events: ThreadEvent[];
}

// ---- node-anchored comment threads ----
// Human-authored threads live in `comments.yaml` on the spec branch. Agents never write the spec
// branch, so their replies/resolutions are events in `thread-events.yaml` on the trail branch;
// `mergeThreads` folds both into the view shown to people.
export const CommentSchema = z.object({
  id: z.string(),
  author: z.string(),
  at: z.string(),
  body: z.string(),
});
export const ThreadSchema = z.object({
  id: z.string(),
  node: z.string(),
  node_hash: Hash,
  state: z.enum(['open', 'resolved']),
  comments: z.array(CommentSchema).min(1),
  resolved_by: z.string().optional(),
  resolved_at: z.string().optional(),
});
export const CommentsFileSchema = z.object({ threads: z.array(ThreadSchema).default([]) });
export type Comment = z.infer<typeof CommentSchema>;
export type Thread = z.infer<typeof ThreadSchema>;

export const ThreadEventSchema = z.object({
  thread: z.string(),
  kind: z.enum(['reply', 'resolve', 'reopen']),
  author: z.string(),
  at: z.string(),
  body: z.string().optional(),
});
export const ThreadEventsSchema = z.array(ThreadEventSchema);
export type ThreadEvent = z.infer<typeof ThreadEventSchema>;
