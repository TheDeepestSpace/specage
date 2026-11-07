Run the specage dispatch protocol: follow `protocol/PROTOCOL.md` (sections Session, Reconcile ladder, Reconcile existing issues, Grouping and filing, Report). The context JSON names the project and the range: `before` (last dispatched commit, null on the first run) and `after` (the spec commit to reconcile).

Implementation is not started from here: write an `outbox/` entry per issue to implement (kind `implement`, `target` = the issue number) and specage fires it through `dispatch_agent`. Do not comment on issues to trigger the-intern.

When you open a question about an issue, set `issue: <number>` so dispatch is held until it is resolved. Anchor questions about removed nodes with `specage question anchor`. On every run, apply human answers from open questions' `thread`, then resolve or follow up (see Questions in the protocol).
