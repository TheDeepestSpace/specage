# specage dispatch protocol

Instructions for a dispatch session. Follow them exactly. Be terse.

The spec and trail live in a shared data repo (`data_repo` in `.specage/config.yaml`), one branch pair per project:
`specages/<project>/spec` and `specages/<project>/trail`. Dispatch tags are `dispatch/<project>/<ts>` on the data repo.
You never edit the spec branch. You write the trail branch only through `specage state commit`, once per session.
Run the CLI with `npx --yes github:TheDeepestSpace/specage#v0 <cmd>` (call it `specage` below).

## Session

1. Clone the data repo named in the dispatch message: `git clone --branch specages/<project>/spec <data_repo>` then `git fetch origin specages/<project>/trail --tags`. Read `.specage/config.yaml`, `.specage/policy.yaml` and `GRAMMAR.md` from the spec branch. Check out `specages/<project>/trail` in a separate worktree. The project's code repo is `repo` in the config; issues and PRs are filed there.
2. **Cursor.** The cursor is the last spec commit already dispatched, stored in the data repo as the ref `refs/specage/dispatched/<project>` (not a branch). `<sha>` is the commit named in the dispatch message. Fetch it: `git fetch origin refs/specage/dispatched/<project>:refs/specage/dispatched/<project>` (if the ref does not exist, this is the first dispatch: diff from empty). Then: `specage diff --from <cursor> --to <sha> --spec-file <spec_file> --project <project> --json`. If `entries` is empty, advance the cursor (step 7) and stop.
3. **Sync.** Scan PRs merged since the cursor for `Spec: <id>@<hash>` commit trailers or PR-body lines. Mark those claims `done`, set the work item to `merged`, add `pr` evidence to the trace.
4. **Reconcile** every entry (ladder below).
5. **Group** gaps into work items and file issues.
6. Write `trace.yaml`, `work.yaml`, `questions.yaml`, `dispatches/<tag>.md` and any `outbox/` entries. Run `specage state validate`, then `specage state commit -m "dispatch <tag>"`. One commit per session.
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
- **amend**: rewrite the issue's generated "Spec" section with the claimed nodes' current text; append an amendment note; post **one** PR review comment listing every moved node (old -> new text, "claim the new hash"); write an outbox `amend` entry for the PR (the-intern ignores its own comments).
- **ask**: open a question naming the options: amend, stack, follow-up, supersede, split.

## Grouping and filing

- Group gap nodes into one issue when they share a block and a code area, or only make sense together.
- Issue body has a generated **Spec** section: each claimed leaf's current text, `id@hash`, and the spec commit SHA. List any `!constraint` / `!impl` / `!invariant` leaves in the same subtree as binding context, plus existing evidence.
- Claims are on leaves. Expand a block request to its leaves.
- If `auto_implement: true`, write an `implement` outbox entry per new issue.

Outbox entry (`outbox/<id>.json`, immutable, never edited or deleted):

```json
{"id":"o-2026-10-30T02-15Z-001","kind":"implement","target":251,"body":"Implement the claims on issue #251 per .specage/PROTOCOL.md section Implement.","created":"2026-10-30T02:15:11Z"}
```

`kind`: implement | amend | answer | continue. `target`: issue or PR number.

## Implement

For sessions working a filed issue:

- Change only code and tests. Never write to the data repo's spec or trail branches.
- Add a trailer `Spec: <id>@<hash>` per completed claim to the final commit. For a claim deliberately left unfinished, put `Spec-Release: <id>` in the PR body.
- Open the PR with `Closes #N` and request review from `reviewer` in the config.

## Report (`dispatches/<tag>.md`)

Contradictions and questions first. Then counts per outcome, then one line per node: outcome, action, links.

## Questions

Format in `questions.yaml`: id, node, node_hash, dispatch, kind (ambiguity | contradiction | reconcile | rename | split), text, options, state, answer.
- `addressed` is automatic when the node's hash changed after the question was asked.
- Mark `resolved` after confirming the edit settles it, or when the human answers on the dispatch issue.
