# specage dispatch protocol

Instructions for a dispatch session. Follow them exactly. Be terse.

The spec and trail live in a shared data repo (`data_repo` in `.specage/config.yaml`), one branch pair per project:
`specages/<project>/spec` and `specages/<project>/trail`. Dispatch tags are `dispatch/<project>/<ts>` on the data repo.
You never edit the spec branch. You write the trail branch only through `specage state commit`, once per session.
Run the CLI with `npx --yes github:TheDeepestSpace/specage#v0 <cmd>` (call it `specage` below).

## Session

1. Clone the data repo named in the dispatch message: `git clone --branch specages/<project>/spec <data_repo>` then `git fetch origin specages/<project>/trail --tags`. Read `.specage/config.yaml`, `.specage/policy.yaml` and `GRAMMAR.md` from the spec branch. Check out the trail branch in a separate worktree with exactly `git worktree add -b specages/<project>/trail ../trail origin/specages/<project>/trail` (or, if the local branch exists, `git worktree add ../trail specages/<project>/trail`). Never create the trail checkout from a fresh `git init`, from the data repo's default branch, or with `--orphan`: it must descend from `origin/specages/<project>/trail`, and `git log` there must show the previous dispatch commits. Run `specage state commit` from that worktree, and if the push is not a fast-forward, `git pull --rebase` and retry; never force-push. The project's code repo is `repo` in the config; issues and PRs are filed there.
2. **Cursor.** The cursor is the last spec commit already dispatched, stored in the data repo as the ref `refs/specage/dispatched/<project>` (not a branch). `<sha>` is the commit named in the dispatch message. Fetch it: `git fetch origin refs/specage/dispatched/<project>:refs/specage/dispatched/<project>` (if the ref does not exist, this is the first dispatch: diff from empty). Then: `specage diff --from <cursor> --to <sha> --spec-file <spec_file> --project <project> --json`. If `entries` is empty, advance the cursor (step 7) and stop.
3. **Sync.** Scan PRs merged since the cursor for `Spec: <id>@<hash>` commit trailers or PR-body lines. Mark those claims `done`, set the work item to `merged`, add `pr` evidence to the trace.
4. **Reconcile** every entry (ladder below).
5. **Group** gaps into work items and file issues.
6. Write `trace.yaml`, `work.yaml`, `questions.yaml`, `thread-events.yaml` (if you replied to or resolved threads), `dispatches/<tag>.md` and any `outbox/` entries. Run `specage state validate`, then `specage state commit -m "dispatch <tag>"`. One commit per session.
7. Post the report where the dispatch was started, then **advance the cursor** only after everything above succeeded: `git push origin <sha>:refs/specage/dispatched/<project>` (create it if missing; fast-forward only, never force). If the session fails earlier, leave the cursor so the next dispatch re-diffs the same changes. The specage server never moves the cursor.

## Reconcile ladder

Stop at the first rung that applies.

1. **moved** (same hash): no work.
2. **renamed / split / merged**: carry trace and claims to the new IDs. Split halves get the old evidence marked `inherited: true`; continue at rung 5 to confirm each half. Add the new IDs to `consumed_lineage` and the old IDs to `retired_ids`.
3. **Cosmetic** change (same meaning): refresh `spec_hash`, keep `verified`.
4. **Claimed by in-flight work**: classify against the **claimed hash** (not the cursor) as `refinement | addition | reversal | unsure`. Combine with the item's state (early = `filed`/`in_progress`, late = `in_review`) and apply `policy.yaml`.
5. **Discovery** (new or changed nodes with no in-flight work). Search code, tests, scenarios, goldens, merged PRs and closed issues.
   - satisfied: link evidence with tiers; status `implemented`; no issue.
   - partial: file an issue for the gap only, linking existing evidence.
   - contradicts: open a **question**, not an issue.
   - absent: file an issue.
6. **removed**: first, if the removal pairs with an added node that has a derived name (ID-less statements get a new name when reworded), compare old and new text. If the meaning is unchanged, treat it as cosmetic (rung 3): no action, and carry the old trace entry, evidence and claims over to the new derived name. If it changed, handle the pair as removed + added. Otherwise, if in-flight work exists, ask. Otherwise retire the ID and note whether code for it still exists. Never delete code unprompted.
7. **suspected_rename**: ask (question kind `rename`).

Skip nodes marked `?` (open question) and `>later:`; list them in the report only.

Discovery is biased toward "implemented", so be strict:
- Never write `verified`; only the human can.
- Evidence tiers: `tested` (a test/scenario asserts it), `located` (code found, nothing asserts it), `asserted` (you believe it, can't point to anything). Report `asserted` separately.
- `located`-only nodes go in the report as test-gap candidates; they don't become issues.
- Pin every evidence ref to a commit SHA. Never link a branch name.

## Actions

Chosen by `policy.yaml`, not by your judgment. You only classify.

- **refresh**: update the hash.
- **amend**: rewrite the issue's generated "Spec" section with the claimed nodes' current text; append an amendment note; write an `outbox/` entry `{kind: amend, target: <PR number>, spec_ids: [<id>@<new hash>, ...], body: <every moved node: old -> new text, "claim the new hash">}`. specage fires it through the-intern's `dispatch_agent` (prompt `prompts/amend.md`) and verifies the result on callback. Do not comment on the PR to trigger the-intern.
- **ask**: open a question naming the options: amend, stack, follow-up, supersede, split.

## Grouping and filing

- Group gap nodes into one issue when they share a block and a code area, or only make sense together.
- Issue body has a generated **Spec** section: each claimed leaf's current text, `id@hash`, and the spec commit SHA. List any `!constraint` / `!impl` / `!invariant` leaves in the same subtree as binding context, plus existing evidence.
- Claims are on leaves. Expand a block request to its leaves.
- If `auto_implement: true`, write an `outbox/` entry `{kind: implement, target: <issue number>, spec_ids: [<id>@<hash> of every claimed leaf], body: ""}` right after filing the issue. specage fires it through `dispatch_agent` (prompt `prompts/implement.md`, which carries the Implement rules below) and verifies the `Spec:` trailers and `Closes #N` on callback, redispatching with a correction up to `max_attempts`. Never comment `@the-intern-bot` to start work.

## Implement

For sessions working a filed issue:

- Change only code and tests. Never write to the data repo's spec or trail branches.
- Add a trailer `Spec: <id>@<hash>` per completed claim to the final commit. For a claim deliberately left unfinished, put `Spec-Release: <id>` in the PR body.
- Open the PR with `Closes #N`. Do not request review from the owner or `reviewer`.
- After opening the PR — and again after pushing changes a review asked for — initiate a specage review by pushing an empty commit to the data repo's review branch (a push is the authenticated trigger; there is no HTTP endpoint). `<data_repo>` and `<project>` come from `.specage/config.yaml`; `<owner/repo>` is its `repo`:
  `git clone --no-checkout <data_repo> review && cd review && git fetch origin specages/<project>/review specages/<project>/trail`, then check out `specages/<project>/review` if it exists, else create it from `origin/specages/<project>/trail`: `git switch -C specages/<project>/review origin/specages/<project>/review` (or `... origin/specages/<project>/trail`). Then `git commit --allow-empty -m "review <owner/repo>#<number>"` and `git push origin specages/<project>/review` (fast-forward only, never force; on rejection fetch and retry). The commit message must be exactly that form: it names the PR to review. If the push fails, fall back to requesting review from `reviewer` in the config and say so in your final comment.

## Review

For sessions dispatched to review an implement PR (the dispatch message names the PR):

- Check the PR against the spec, not just the code: every claimed statement (`Spec: <id>@<hash>` trailers and the issue's generated Spec section) must be implemented at the claimed hash and covered by tests; `Spec-Release: <id>` lines excuse a claim only when the PR body says why; the trace and work items on the trail branch must stay consistent with what the PR actually does.
- Submit the verdict with `gh pr review --approve` or `--request-changes`, with a short body listing findings. GitHub rejects approving or requesting changes on the bot's own PR; fall back to `gh pr review --comment` whose first line is `APPROVE` or `CHANGES REQUESTED`.
- When you request changes, also post a PR comment that starts with `@the-intern-bot` followed by the findings to fix. That mention has no data-repo access, so list the exact `id@hash` claims affected.
- Never push to the PR branch, never merge, and never push to the review branch yourself. The human owner stays the final merger: on APPROVE, stop; the owner merges by hand.
- Ignore your own earlier reviews as evidence that anything works.

## Comment threads

Humans comment on spec nodes in the editor. Threads are in `comments.yaml` on the **spec** branch (read-only for you): `threads: [{id, node, node_hash, state: open|resolved, comments: [{id, author, at, body}], resolved_by?, resolved_at?}]`.

- At dispatch, read `comments.yaml` and treat every `open` thread on a node in the diff (or one that asks you something) as input. A thread whose `node_hash` differs from the node's current hash is about older text; say so rather than guessing.
- You never edit `comments.yaml`. To answer, append events to `thread-events.yaml` on the trail branch (append-only list): `{thread, kind: reply|resolve|reopen, author: the-intern, at: <ISO ts>, body?}` (`body` required for `reply`). Resolve only when the thread is settled by the spec or code as it stands; otherwise reply.
- Unknown thread IDs are ignored. Keep replies short.
- `questions.yaml` is unchanged and still the channel for reconcile/rename/split questions; threads are for free-form discussion.

## Report (`dispatches/<tag>.md`)

Contradictions and questions first. Then counts per outcome, then one line per node: outcome, action, links.

## Questions

Format in `questions.yaml`: id, node, node_hash, dispatch, kind (ambiguity | contradiction | reconcile | rename | split), text, options, state, answer.
- `addressed` is automatic when the node's hash changed after the question was asked.
- Mark `resolved` after confirming the edit settles it, or when the human answers on the dispatch issue.
