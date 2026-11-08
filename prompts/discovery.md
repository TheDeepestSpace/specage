Run the specage dispatch protocol: follow `protocol/PROTOCOL.md` (sections Session, Reconcile ladder, Reconcile existing issues, Grouping and filing, Report). The context JSON names the project and the range: `before` (last dispatched commit, null on the first run) and `after` (the spec commit to reconcile).

Implementation is not started from here: write an `outbox/` entry per issue to implement (kind `implement`, `target` = the issue number) and specage fires it through `dispatch_agent`. Do not comment on issues to trigger the-intern.

When you open a question about an issue, set `issue: <number>` so dispatch is held until it is resolved. Anchor questions about removed nodes with `specage question anchor`. On every run, apply human answers from open questions' `thread`, then resolve or follow up (see Questions in the protocol).

On every run, also enqueue outbox entries for filed issues never dispatched (`specage plan undispatched`), and run `specage question reanchor` before validating so no question points at a missing node.

On every run, even when the spec diff has no entries (e.g. the commit only added a comment), run `specage threads pending <trail> --spec-dir <spec checkout>` and reply to each listed thread via `thread-events.yaml` (see Comment threads in the protocol). A comment-only commit is never "no action": commit the reply to the trail branch and advance the cursor.
