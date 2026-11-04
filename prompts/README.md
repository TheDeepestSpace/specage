# Agent prompts

Prompts for the-intern `dispatch_agent` runs, referenced as
`TheDeepestSpace/specage:prompts/<name>.md@<ref>` (the-intern allowlists
`prompts/*.md` on `main` and `v*`). The dispatch `context` JSON
(`{project, spec_ids, attempt, max_attempts, kind}`) is appended by the-intern.

| file | used for |
| --- | --- |
| `implement.md` | implement a filed issue (opens a PR) |
| `amend.md` | amend an open PR (`pr=N`): spec moved, review findings, verifier correction |
| `review.md` | review an implement PR against the spec |
| `discovery.md` | the planner session for a spec commit (reconcile ladder, filing). Not dispatched through `dispatch_agent` yet: it has no issue/PR to target, so it still runs via the-intern's commit trigger (`prompt_file: protocol/PROTOCOL.md`) |

specage verifies the result itself (`specage callback`): the agent's claim of
success is never trusted.
