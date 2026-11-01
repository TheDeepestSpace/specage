# specage: build spec for the first pass

> Handoff document for the implementing agent. It describes the whole system
> that has been designed, and marks which parts are **in scope for this pass**
> (phases P0–P5) and which are **later**. Where this document and an
> attached file disagree, this document wins.
>
> Attached / to be committed as fixtures:
> - `fixtures/tbgwaf/tbgwaf.specage`: a hand-written spec of tbgwaf at master `9ff2e3a` (344 lines, 218 nodes)
> - `fixtures/tbgwaf/GRAMMAR.md`: an early grammar draft, **superseded by §3 of this document**
> - `fixtures/check_specage.py`: a throwaway structure checker, superseded by `specage lint`

---

> **Revision (issue #13): in-app init and commit-driven dispatch.** This supersedes the parts of this document below that describe `specage install`,
> the `install.yml` workflow, `dispatch/*` tags, `specage-spec.yml`/`specage-trail.yml`, the dispatch action and the `INTERN_DISPATCH_TOKEN` / `PROJECT_TOKEN` / `INSTALL_TOKEN` secrets:
> - Projects are added in the web UI (`GET /api/init/repos`, `POST /api/init/preview`, `POST /api/init` with passkey step-up), using only the GitHub App installation token. Shared code: `packages/server/src/init.ts`. The CLI `install` command is removed.
> - A commit on `specages/<project>/spec` is a dispatch. The App's push webhook goes to the-intern's Cloudflare worker, which runs `dispatcher.yml` (the-intern#253). The specage server only lints and commits; the agent reads the cursor, diffs cursor → sha and advances the cursor after a successful run (PROTOCOL.md).
> - Cursor = last dispatched commit, advanced by the agent, stored as ref `refs/specage/dispatched/<project>` in the data repo (no tags). `POST …/dispatch` and the Dispatch button are gone; `GET …/dispatch/preview` remains.
> - Not provisioned any more: the outbox-firing trail workflow and Pages publishing (both needed a token / Workflows permission).
> - App permissions: Contents rw on the data repo; Issues rw + Metadata r on project repos; webhook with Push events.

## 0. TL;DR

specage is a **human-written, structured, natural-language spec** for a
project, plus a **trace** that links every spec node to the evidence that it
has been implemented (issues, PRs, code, tests, screenshots). An agent
(**the-intern**) is dispatched with the **node-level diff** of the spec. It
reconciles that diff against what already exists and in-flight work, and
files or amends issues and PRs only where there is a real gap.

Core rules (they shape everything below):

1. **Agents never edit the spec.** It lives on its own orphan branch `spec`,
   written only by the human.
2. **One writer per artifact.** Trace, work ledger, questions and reports live
   on a second orphan branch, `spec-state`, written only by automation. Code
   branches touch neither, so merge conflicts on the spec are impossible.
3. **Nodes have stable IDs.** Diffing, tracing, claims and questions are all
   keyed by node ID, never by line or path.
4. **Discover before building.** A changed node only becomes an issue if the
   current code doesn't already satisfy it.
5. **The grammar's skeleton is fixed; its vocabulary grows per project.** The
   parser understands nesting, IDs and a small fixed set of markers.
   Everything else is prose.

---

## 1. Scope of this pass

| Phase | Deliverable | Scope |
|---|---|---|
| P0 | `specage` repo bootstrap: monorepo, CI, devcontainer, dev image for the-intern | **this pass** |
| P1 | Protocol as documents: `GRAMMAR.md`, `PROTOCOL.md`, templates. Usable by hand with no tooling | **this pass** |
| P2 | Lezer grammar + `@specage/core` + CLI: parse, lint, hash, node-level diff | **this pass** |
| P3 | `specage install`, project-repo workflows, the-intern integration (dispatch + outbox fan-out) | **this pass** |
| P4 | Static renderer: spec + state as a read-only page on GitHub Pages | **this pass** |
| P5 | Editor webapp (CodeMirror, trace pane, save, dispatch) served by the **specage server on Fly.io** (passkey login) | **this pass** |
| P6 | Merge gates on the project's default branch: claims check, `!proof` sign-off check | later (design in §11) |
| P7 | Automatic amend / stack / supersede actions without human confirmation | later (v0 asks instead) |

Do the phases in order. Each phase ends with its acceptance criteria passing
in CI. **Pause before anything that writes to a real project repo**
(installing into tbgwaf, setting secrets). Those steps are marked
**HUMAN-CONFIRM**.

---

## 2. Glossary

- **spec**: the `.specage` file on the `spec` branch of a project repo.
- **node**: one statement in the spec. A **leaf** ends in `;`. A **block**
  has `{ … }` children.
- **ID**: the node's stable name, written `@shoot.burst.cap`.
- **hash**: hash of a node's normalized *own* text (§3.5).
- **subtree hash**: hash over a node and all its descendants.
- **dispatch**: one run of the protocol, started by pushing a tag
  `dispatch/<UTC timestamp>` on the `spec` branch.
- **cursor**: the most recent `dispatch/*` tag before the current one. The
  diff is computed from it. If there is none, the diff is from an empty spec.
- **trace**: per-node evidence and status (`spec-state/trace.yaml`).
- **work item**: an issue and/or PR, with **claims** on a set of
  `node@hash` (`spec-state/work.yaml`).
- **claim**: a work item's statement that it implements a node *at a given
  hash*.
- **question**: something the agent needs the human to decide
  (`spec-state/questions.yaml`).
- **outbox**: requests to trigger the-intern, written by a dispatch session
  and fired by a workflow (`spec-state/outbox/`).
- **the-intern**: the existing agent runner,
  `github.com/TheDeepestSpace/the-intern`. See §8.

---

## 3. The specage language (normative)

### 3.1 Lexical

- UTF-8. Text is normalized to NFC before hashing.
- **Comment**: `#` at the start of a line, or preceded by whitespace, runs to
  the end of the line. Comments have no meaning and are excluded from hashes.
- **Reserved characters** in statement text: `{ } ; @ #`. Escape them with a
  backslash (`\;`, `\{`, `\}`, `\@`, `\#`, `\\`).
- Indentation and line breaks are cosmetic. Text may wrap freely.

### 3.2 Structure

```ebnf
file      = { statement } ;
statement = leaf | block ;
leaf      = text , id_clause , ";" ;
block     = text , id_clause , "{" , { statement } , "}" , ";" ;
id_clause = "@" , id , [ "<-" , id , { "," , id } ] ;
id        = segment , { "." , segment } ;
segment   = /[a-z][a-z0-9_-]*/ ;
text      = [ marker ] , prose ;
```

- **Every statement must have an ID** (v0 rule; lint error otherwise).
  Untracked asides go in comments.
- An ID is a name, not a path. A child *usually* extends its parent's prefix
  (lint warning if not). A node that moves keeps its ID.
- IDs are unique in the file and **never reused**. Removing a node retires
  its ID, and `spec-state/trace.yaml` keeps `retired_ids`.
- `<-` is the **lineage clause**, used for renames, splits and merges (§3.4).
  It's meant to stay for one dispatch. Lint warns if a `<-` survives past a
  dispatch that consumed it.

### 3.3 Markers

A marker is the first token of a **leaf's** text. Blocks carry no markers in
v0.

| Marker | Meaning to agents | Phase |
|---|---|---|
| *(none)* | Behaviour: what the thing does, as a player or developer sees it | P1 |
| `!constraint:` | A hard rule. Never trade it away | P1 |
| `!impl:` | Pins *how* something is built | P1 |
| `!invariant:` | Must hold for all inputs. Should map to a property or generated test | P1 (parse/render), gate later |
| `!proof <kind>:` | The human must see this artifact before a PR touching the parent subtree merges (§11) | P1 (parse/render), gate P6 |
| `?` | Open question or undecided. Don't implement it | P1 |
| `>later:` | Known follow-up. Don't build it until the marker is removed | P1 |

`!proof` kinds: `video`, `screenshot`, `demo`, `snippet`, `transcript`,
`walkthrough`. An unknown kind is a lint warning.

### 3.4 Lineage (renames, splits, merges)

```
burst cap … @shoot.cap <- shoot.burst.cap;          # rename
gate by FOV … @shoot.gate.fov <- shoot.gate;        # split: both halves
gate by range … @shoot.gate.range <- shoot.gate;    #   name the old ID
lock-on … @shoot.lock <- shoot.lock.stage, shoot.lock.torso;   # merge
```

The diff turns these into `renamed` / `split` / `merged` entries, and
reconcile carries trace and claims forward (§7.2).

### 3.5 Normalization and hashing

`own_text(node)` is the marker plus prose of the node, **excluding**: the ID
clause, children, comments and escapes (unescaped). Normalize it by:
NFC, collapsing whitespace runs to one space, and trimming. Case is
preserved.

- `hash(node) = sha256(own_text)` → first 12 hex characters.
- `subtree_hash(node) = sha256(hash(node) + "\n" + join(subtree_hash(child) for child in order))`
  → first 12 hex characters.
- Claims and trace use `hash`. Proof scope and "has anything under here
  changed" use `subtree_hash`.

### 3.6 Lint rules (`specage lint`)

| Code | Level | Rule |
|---|---|---|
| E001 | error | Parse error (unbalanced braces, missing `;`, stray reserved character) |
| E002 | error | Statement without an ID |
| E003 | error | Duplicate ID |
| E004 | error | ID in `retired_ids` reused (needs `--state`) |
| E005 | error | Unknown marker |
| E006 | error | `<-` names an ID that still exists elsewhere in the file (except in a split, where several nodes share one old ID) |
| W101 | warn | ID doesn't extend its parent's prefix |
| W102 | warn | Leaf longer than 280 characters after normalization ("spec or pseudocode?") |
| W103 | warn | Leaf contains a file path, `#123`-style issue reference, or URL (those belong in the trace) |
| W104 | warn | Unknown `!proof` kind |
| W105 | warn | A `<-` clause older than the last dispatch (needs `--state`) |
| W106 | warn | Marker on a block (ignored in v0) |

The output has a human format and a `--json` format (file, line, column,
code, message, node ID).

---

## 4. Repositories and layout

### 4.1 The `specage` tool repo (new, clean)

TypeScript, Node 22, npm workspaces, vitest, Vite. Suggested layout:

```
specage/
  packages/
    core/        # Lezer grammar, parser → model, hashing, diff, lint, schemas (zod)
    cli/         # `specage` binary: parse | lint | hash | diff | render | install | outbox
    web/         # SPA: read-only renderer (P4) + editor (P5); CodeMirror 6
    server/      # specage server (Fly.io): auth, fixed API, serves the SPA
    action/      # composite GitHub Actions used by project-repo workflows
  deploy/fly.toml
  Dockerfile     # server image (also the base for the dev image, see §12)
  templates/
    spec-branch/       # files `specage install` writes to the `spec` branch
    state-branch/      # files written to `spec-state`
  protocol/
    GRAMMAR.md         # §3, for humans and agents
    PROTOCOL.md        # §7, the dispatch session's instructions
  fixtures/
    tbgwaf/            # tbgwaf.specage + expected parse/hash JSON
    grammar/           # small positive/negative cases per rule
  .devcontainer/
  .github/workflows/
```

Distribution in v0: GitHub-only, no npm publish yet. Release tags `vX.Y.Z`
plus a moving major tag `v0`. Project workflows use
`TheDeepestSpace/specage/packages/action/<name>@v0`, and agents run the CLI
with `npx --yes github:TheDeepestSpace/specage#v0 <cmd>`. The CLI must
therefore build on install (a `prepare` script) or commit `dist/` on release
tags. Pick one and document it.

### 4.2 A project repo after `specage install`

```
<default branch>          untouched in this pass (P6 adds one gate workflow)

spec  (orphan)            written ONLY by the human (directly or via the webapp)
  <project>.specage
  GRAMMAR.md              copy pinned to the installed specage version
  .specage/config.yaml
  .specage/policy.yaml
  .specage/PROTOCOL.md    copy pinned to the installed specage version
  .github/workflows/specage-spec.yml       # lint + publish on push; dispatch on tag

spec-state  (orphan)      written ONLY by automation (dispatch sessions, specage workflows)
  trace.yaml
  work.yaml
  questions.yaml
  dispatches/<tag>.md     one report per dispatch
  outbox/<id>.json        immutable trigger requests (§8.3)
  .github/workflows/specage-state.yml      # outbox fan-out + republish on push

gh-pages                  existing or created. specage publishes under /specage/
```

Workflows on orphan branches run for `push` events, because GitHub reads the
workflow file from the pushed commit. `workflow_dispatch` and `pull_request`
need the workflow on the default branch, so this design avoids them until P6.

### 4.3 `spec`-branch config

```yaml
# .specage/config.yaml
specage_version: v0
project: tbgwaf
spec_file: tbgwaf.specage
reviewer: TheDeepestSpace            # requested on PRs, signs off proofs
intern:
  repo: TheDeepestSpace/the-intern
  workflow: dispatcher.yml
  backend: claude                    # leading token for comment_body (see §8.1)
auto_implement: true                 # after filing, also trigger implementation
pages:
  mode: gh-pages-subdir              # gh-pages-subdir | off (forced off for private repos)
  path: specage
ui:
  url: https://specage.fly.dev       # specage server, for the Edit link
```

```yaml
# .specage/policy.yaml  (§7.3; v0 defaults are conservative)
reconcile:
  cosmetic:    {early: refresh, late: refresh}
  refinement:  {early: amend,   late: amend}
  addition:    {early: amend,   late: ask}      # later: stack / follow_up
  reversal:    {early: ask,     late: ask}      # later: supersede
  unsure: ask
split_items: ask
```

---

## 5. State formats (`spec-state`)

All files are YAML or JSON, validated by zod schemas in `@specage/core`.
Every write goes through `specage state commit`, which validates, rebases
onto the latest `spec-state`, and retries the push (up to 5 tries with
backoff).

### 5.1 `trace.yaml`

```yaml
retired_ids: [shoot.lock.torso]
nodes:
  shoot.burst.cap:
    spec_hash: 3f9a1c07d2e4          # node hash the evidence was attested against
    status: implemented              # planned | in_progress | implemented | contradiction | absent
    evidence:
      - {kind: scenario, ref: tests/scenarios/burst_mag_caps.yaml, commit: 9ff2e3a, tier: tested}
      - {kind: code,     ref: src/game/Weapon.h#L60-L75,          commit: 9ff2e3a, tier: located}
      - {kind: pr,       ref: 138}
    verified: {by: TheDeepestSpace, at: 2026-10-30T14:02Z, hash: 3f9a1c07d2e4}   # optional
    discovered: {dispatch: dispatch/2026-10-30T02-11Z}                            # optional
```

Derived when read, never stored:
- **stale**: `spec_hash` ≠ the node's current hash.
- **verified**: `verified.hash` = the current hash.

**Evidence tiers:**
- `tested`: a test or scenario asserts the behaviour.
- `located`: implementation found, nothing asserts it.
- `asserted`: the agent believes it but couldn't point to anything specific.

Evidence must be pinned to a commit SHA. Never link `master`.

### 5.2 `work.yaml`

Keyed by work item, so one issue can claim many nodes. The node → items
index is computed, never stored.

```yaml
items:
  - id: w-0042
    issue: 251
    pr: 254                       # null until opened
    state: in_review              # filed | in_progress | in_review | merged | closed
    relations: []                 # [{supersedes: w-0039}] | [{stacked_on: w-0040}] | [{follows: w-0041}]
    claims:
      shoot.burst.bar:   {hash: 1c07aa19be02, status: done}
      shoot.burst.cap:   {hash: 3f9a1c07d2e4, status: done}
      shoot.burst.death: {hash: 9e12f0c3a7b1, status: pending}
```

Claims are always on **leaves**. A block-level request is expanded to its
leaves when the item is filed.

### 5.3 `questions.yaml`

```yaml
- id: q-0007
  node: fog.openings
  node_hash: ab12cd34ef56
  dispatch: dispatch/2026-10-30T02-11Z
  kind: contradiction            # ambiguity | contradiction | reconcile | rename | split
  text: "Jev docs say Blue vs Jev auto-commits; code requires manual commit. Which is intended?"
  options: ["spec is right (manual)", "docs are right (auto)"]   # optional
  state: open                    # open | addressed | resolved | withdrawn
  answer: null
```

- **addressed** is automatic: the node's hash changed after the question was
  asked.
- **resolved** is set by the next dispatch after it confirms the edit
  settles the question, or by a session triggered when the human answers on
  the dispatch issue.

### 5.4 `dispatches/<tag>.md`

A short report: counts per outcome, then one line per node with outcome,
action and links. Contradictions and questions come first. The same text is
posted on the dispatch issue (§8.2).

### 5.5 `outbox/<id>.json`

```json
{"id":"o-2026-10-30T02-15Z-001","kind":"implement","target":251,
 "body":"Implement the claims on issue #251 per .specage/PROTOCOL.md §Implement.","created":"2026-10-30T02:15:11Z"}
```

`kind` is one of `implement`, `amend`, `answer`, `continue`. `target` is an
issue or PR number in the project repo. Entries are **immutable and
append-only**. The fan-out fires only the entries *added* in the pushed
commit range, so nothing is ever deleted and no extra writer is needed.

---

## 6. Diff (`specage diff`) — node level, deterministic

Input: two specs, as files or git refs. `--from dispatch/latest` resolves to
the cursor. Output: JSON (schema in core) plus a human summary.

Entry kinds:
- `added`, `removed`
- `changed`: same ID, different `hash`
- `moved`: same ID and hash, different parent
- `renamed`, `split`, `merged`: from `<-` clauses
- `suspected_rename`: an unlinked `removed` + `added` pair whose normalized
  text similarity is ≥ 0.8. Emitted for the agent to ask about, never
  auto-applied.

Each entry carries: ID(s), old and new hash, old and new text, old and new
parent, and line numbers. A `subtree_changed` set lists every block whose
`subtree_hash` changed, which proof scope (P6) and the renderer use.

Acceptance criteria:
- Diffing the tbgwaf fixture against itself is empty.
- Diffing it against a copy with whitespace reflowed is empty.
- A move-only edit yields only `moved`.
- Each lineage case has a fixture test.

---

## 7. The dispatch protocol (`PROTOCOL.md`)

This is the instruction file a dispatch session follows. Write it as an
imperative runbook for an agent, using the-intern's style rules (short, no
preamble). In P1 it is run by hand. From P3 on it's started by the workflow,
and the session uses `specage` CLI commands instead of reasoning about diffs
itself.

### 7.1 Session steps

1. `git fetch origin spec spec-state --tags`. Read `.specage/config.yaml`,
   `policy.yaml` and `GRAMMAR.md` from `origin/spec`.
2. Compute the diff from the cursor to the dispatch tag (`specage diff
   --json`). If the diff is empty, write the report and stop.
3. **Sync**: before reconciling, scan PRs merged since the cursor for
   `Spec: <id>@<hash>` commit trailers or PR-body lines. Mark those claims
   done, update work items to `merged`, and add `pr` evidence to the trace.
4. **Reconcile** each entry (§7.2).
5. **Group** the gaps into work items (§7.4), and file the issues.
6. Write `trace.yaml`, `work.yaml` and `questions.yaml`, the report, and the
   outbox entries. Commit with `specage state commit`. **One commit per
   session**, so the outbox fan-out sees one coherent range.
7. Post the report on the dispatch issue.

### 7.2 Reconcile ladder

Stop at the first rung that applies:

1. **moved** (same hash): no work.
2. **renamed / split / merged**: carry the trace and claims to the new IDs.
   Split halves get the old evidence marked `inherited`, then continue at
   rung 5 to confirm it covers each half.
3. **cosmetic** change (same meaning): refresh `spec_hash`, keep
   `verified`.
4. **claimed by in-flight work**: classify against the **claimed hash**
   (not the cursor) as `refinement | addition | reversal | unsure`. Combine
   with the item's state (early = `filed`/`in_progress`, late = `in_review`)
   and apply the policy (§7.3).
5. **Discovery** (new or changed nodes with no in-flight work): search code,
   tests, scenarios, goldens, merged PRs and closed issues.
   - **satisfied**: link the evidence with tiers. Status `implemented`. No
     issue.
   - **partial**: file an issue scoped to the gap only, linking the existing
     evidence.
   - **contradicts**: the code does something else. Open a **question**, not
     an issue.
   - **absent**: file an issue.
6. **removed**: if there's in-flight work, ask. Otherwise retire the ID and
   note in the report whether code for it still exists. Never delete code
   unprompted.
7. **suspected_rename**: ask.

Discovery is biased toward "it's implemented". Never write `verified`; only
the human can. Report `asserted` evidence separately. `located`-only nodes
are listed in the report as test-gap candidates and don't become issues
automatically.

### 7.3 Actions (v0)

- **refresh**: update the hash.
- **amend**:
  - rewrite the issue's generated "Spec" section, which holds the claimed
    nodes' current text;
  - append an amendment note to the issue;
  - post **one** PR review comment listing every moved node of that item,
    with old → new text and the instruction to claim the new hash;
  - write an outbox `amend` entry for the PR. Required because the-intern
    ignores its own comments (§8.1).
- **ask**: open a question that names the options (amend, stack, follow-up,
  supersede, split).
- **later (P7)**: `stack` (new branch off the PR branch, with the PR
  targeting it), `follow_up` (an issue blocked by the item), `supersede`
  (close the PR, link the new item).

### 7.4 Grouping and filing

- Group gap nodes into one issue when they share a block and a code area, or
  only make sense together. Nodes dispatched under one block are a strong
  hint that they belong together.
- The issue body has a generated **Spec** section: each claimed leaf's
  current text, `id@hash`, and the spec commit SHA. It also lists any
  `!constraint` / `!impl` / `!invariant` leaves in the same subtree as
  binding context, plus any existing evidence.
- With `auto_implement: true`, write an `implement` outbox entry per new
  issue.
- **Implementation sessions** must:
  - only change code and tests;
  - never write to `spec` or `spec-state`;
  - add a trailer `Spec: <id>@<hash>` per completed claim to the final
    commit, or a `Spec-Release: <id>` line in the PR body for a claim they
    deliberately leave unfinished;
  - open the PR with `Closes #N` and request review from `reviewer`.

---

## 8. the-intern integration

### 8.1 What the-intern already provides

Read from `TheDeepestSpace/the-intern` at `5013218`. Don't change the-intern
in this pass unless something below turns out to be false. In that case,
stop and report.

- `.github/workflows/dispatcher.yml` accepts **`workflow_dispatch`** with
  inputs:
  - `target_repo` (`owner/repo`)
  - `pr_number` (an issue or PR number, required)
  - `comment_body` (the prompt)
  - `installation_id` (optional)
- A leading run of `backend=… model=… effort=…` tokens in `comment_body` is
  parsed as options.
- One run per `(target_repo, issue_number)` at a time (a concurrency group),
  so dispatches against the same issue queue up.
- The agent runs in `ghcr.io/<owner>/<repo>-dev:latest` if that image
  exists, otherwise in a fallback image. Each session is fresh; continuity
  comes from per-issue summaries the-intern stores itself.
- The shared style already makes PRs request review from `TheDeepestSpace`
  and use `Closes #N`.
- **Gating**: issue and PR comments trigger the bot only from
  `ALLOWED_USERS` and only with an `@the-intern-bot` mention, **or** for a
  non-bot comment on a bot-authored thread. **Comments the bot posts itself
  never trigger it.** That's why amend and implement go through the outbox
  and `workflow_dispatch`, not through comments.

### 8.2 Dispatch flow (P3)

```
human pushes tag dispatch/<ts> on `spec` (git or webapp button)
  └─ spec branch: specage-spec.yml (on: push tags dispatch/*)
       1. specage lint (fail → comment nothing, job fails)
       2. specage diff --from <cursor> --to <tag> --json > changes.json (upload artifact)
       3. create issue "specage dispatch <ts>" (label: specage-dispatch) with the diff summary
       4. gh workflow run dispatcher.yml -R TheDeepestSpace/the-intern \
            -f target_repo=<repo> -f pr_number=<dispatch issue> \
            -f comment_body="backend=claude Run the specage dispatch for tag <ts>. Follow origin/spec:.specage/PROTOCOL.md exactly."
          (token: secret INTERN_DISPATCH_TOKEN)
  └─ the-intern session (in project repo) runs PROTOCOL.md → one commit to spec-state
  └─ spec-state branch: specage-state.yml (on: push)
       1. for each outbox/*.json ADDED in ${{ before }}..${{ after }}:
            gh workflow run dispatcher.yml -R <intern> -f target_repo=<repo> -f pr_number=<target> -f comment_body=<body>
       2. specage render → publish to gh-pages/<path>
```

- Pushes from the-intern use a GitHub App installation token, so they
  **do** trigger `specage-state.yml`. Pushes made with `GITHUB_TOKEN` don't.
  specage workflows must therefore never be the thing that's expected to
  trigger another workflow.
- The human answers questions in one of two ways:
  - by **editing the spec** (the normal path, picked up by the next
    dispatch);
  - by **replying on the dispatch issue with `@the-intern-bot`**, for
    decisions that aren't spec text, like "close the PR". That session
    records the answer in `questions.yaml`.

  The dispatch issue is opened by `github-actions[bot]`, not the-intern, so
  a mention is required.
- Workflows that write `spec-state` use concurrency group
  `specage-state-${{ github.repository }}` with `cancel-in-progress: false`.

### 8.3 Secrets and permissions

| Where | Name | Scope |
|---|---|---|
| project repo | `INTERN_DISPATCH_TOKEN` | fine-grained PAT: `TheDeepestSpace/the-intern`, **Actions: read & write**, nothing else |
| project repo | `GITHUB_TOKEN` | `contents: write` (gh-pages), `issues: write` (dispatch issue) |
| the-intern | (existing) | the App must be installed on the project repo, which the-intern's own docs mark as a human step |

In the **specage repo**: secret `FLY_API_TOKEN` (an org-scoped deploy token
for the separate Fly org, provided by the human) and variable `FLY_APP`. On
**Fly**: `SESSION_SECRET`,
`OWNER_PUBKEY`, the specage App ID and private key, and `PUBLIC_URL` (§10.3).

The agent API key and the-intern's App private key never enter the project
repo, the specage repo, or Fly.

---

## 9. CLI (`@specage/cli`)

| Command | Purpose | Phase |
|---|---|---|
| `specage parse <file> [--json]` | AST/model dump | P2 |
| `specage lint <file> [--state <dir>] [--json]` | §3.6 | P2 |
| `specage hash <file> [--json]` | node → hash and subtree hash | P2 |
| `specage diff --from <ref\|file\|empty> --to <ref\|file> [--json]` | §6. Git refs are resolved with `git show <ref>:<spec_file>` | P2 |
| `specage state validate <dir>` / `state commit -m <msg>` | schema check; rebase + retry push | P2 / P3 |
| `specage cursor` | prints the cursor tag for the current dispatch | P3 |
| `specage outbox fire --range <a>..<b>` | §8.2 fan-out | P3 |
| `specage render --spec <file> --state <dir> --out <dir>` | §10.1 | P4 |
| `specage install` | §9.1 | P3 |

Exit codes: 0 ok, 1 lint or validation errors, 2 usage error, 3 git/GitHub
error.

### 9.1 `specage install`

`specage install --repo <owner/repo> [--spec-file <name>.specage | --from <existing file>] [--upgrade] [--dry-run]`

Requires `gh` to be authenticated with admin access to the repo. The command
is **idempotent**. `--upgrade` refreshes workflows, the pinned
`GRAMMAR.md`/`PROTOCOL.md` copies and the config schema, and **never**
touches spec text or state data. Steps:

1. **Preflight**: repo exists and is reachable; the default branch;
   whether `spec` or `spec-state` already exist (if so, upgrade mode); the
   Pages configuration (`GET /repos/{o}/{r}/pages`).
2. **`spec` branch** (orphan): `<name>.specage` (from `--from`, or a skeleton
   `project <name> @<name> { … };`), `GRAMMAR.md`, `.specage/*`,
   `specage-spec.yml`.
3. **`spec-state` branch** (orphan): empty `trace.yaml`, `work.yaml` and
   `questions.yaml`; `dispatches/` and `outbox/` with `.gitkeep`;
   `specage-state.yml`.
4. **Pages**:
   - no Pages site → create a `gh-pages` branch with a minimal index, and
     enable Pages from `gh-pages` / root;
   - Pages from a branch → publish under `/<pages.path>/`, preserving
     everything else. Copy tbgwaf's retry-push pattern from
     `scripts/publish_to_preview.sh`; never use a whole-branch replace;
   - Pages built by an Actions workflow → set `pages.mode: off`, and print
     how to add specage to their build.
5. **Secrets**: prompt for `INTERN_DISPATCH_TOKEN` with no echo, and set it
   with `gh secret set`. Skipped in `--dry-run`.
6. **Labels**: `specage-dispatch`, `specage`.
   Optionally `--rulesets` (§10.4, **HUMAN-CONFIRM**). Private repo →
   force `pages.mode: off`.
7. **Don't create a dispatch tag.** The first dispatch diffs against empty,
   so every node goes through discovery. That is how adopting specage on an
   existing project works.
8. Print a summary and the HUMAN checklist:
   - the-intern App installed on the repo;
   - the specage App installed on the repo;
   - the first dispatch command;
   - the Pages URL and the server URL.

Acceptance criteria:
- `--dry-run` against a scratch repo prints the full plan.
- A real run against a throwaway repo (`specage-sandbox`, created by the
  agent) passes end to end. A second run is a no-op.
- `--upgrade` changes only templated files.

---

## 10. Interface

Two surfaces, one SPA (`packages/web`):

| Surface | Host | Data source | Auth | For |
|---|---|---|---|---|
| **Read-only page** (P4) | GitHub Pages, `https://<owner>.github.io/<repo>/specage/` | baked `data.json` | none | public repos: sharing and browsing |
| **specage server** (P5) | Fly.io, `https://<fly-app>.fly.dev/r/<owner>/<repo>` | server API | passkey (WebAuthn) | editing, dispatching, and viewing private repos |

The read-only page shows an **Edit** link to the server URL (`ui.url` in
config). Production never asks for a pasted token.

### 10.1 Read-only view (P4)

`specage render` bakes `data.json` (the parsed spec, hashes, trace, work,
questions and the latest report) and copies the SPA build to `--out`.
Features:
- The spec as collapsible cards, following the block structure.
- Per-node status chip: planned / in progress / implemented / verified /
  stale / contradiction / absent.
- Aggregate status on blocks ("4/6 verified, 1 stale").
- Evidence links pinned to the commit, image thumbnails with a lightbox, and
  video players for `.webm`/`.mp4` evidence.
- Open questions shown next to their node.
- Markers styled distinctly: constraint/impl/invariant/proof/question/later.
- Deep links per node (`#shoot.burst.cap`).
- A search box.
- Static files only. Must work without storage; wrap any `localStorage` use
  in try/catch.

### 10.2 Editor (P5, served by the specage server)

Layout: CodeMirror 6 on the left, trace pane on the right.

**Editor:**
- Lezer-based highlighting, folding by node, and a **gutter status dot per
  node**. A folded block shows aggregate status.
- Live lint diagnostics, using the same core lint.
- ID autocomplete from the parent prefix, and a quick-fix for a missing ID.
- **Live hashing**: a node edited since its trace `spec_hash` immediately
  shows "changed since verified/implemented".

**Trace pane:**
- Follows the **innermost node at the cursor** (debounced ~150 ms), with a
  breadcrumb up the tree and a pin toggle.
- Shows the node's trace entry, evidence, work items with claim status,
  questions and proofs.
- Clicking a child in the pane moves the editor cursor to it.

**Save:** `PUT /api/r/:owner/:repo/spec` with `{content, base_sha}`.
- On a conflict (409), the SPA shows a 3-way diff (base / remote / local)
  and lets the user re-apply.
- On lint errors (422), the SPA shows the diagnostics.

**Dispatch button:**
- `GET …/dispatch/preview` returns the node-level diff from the cursor to
  the saved `spec` head. The SPA shows it, and the user confirms.
- Then `POST …/dispatch` with `{expected_head}`.
- Requires a saved working copy.

### 10.3 specage server (P5, on Fly.io)

`packages/server`: Node 22, Hono (or Fastify), one container. It serves the
SPA build, handles auth, and exposes a **small, fixed API**. There is no
generic GitHub proxy.

**Auth: passkeys (WebAuthn), one user, sign-up unlocked by the owner's key.** There is no
GitHub login. The server reaches GitHub as a **dedicated specage GitHub App**
(separate from the-intern's App, so the two have separate blast radii).

*Passkey login*
- Library: `@simplewebauthn/server` + `@simplewebauthn/browser`.
- RP ID = the server's hostname. `userVerification: "required"`; resident
  keys preferred.
- **Choose the final hostname before the first sign-up.** Passkeys are bound
  to the RP ID, so moving from `*.fly.dev` to a custom domain later means
  registering again.
- **Bootstrap with the owner's key (single user).** The server is set up
  with **one Ed25519 public key**: the Fly secret `OWNER_PUBKEY`, in OpenSSH
  format, e.g. the human's `~/.ssh/id_ed25519.pub`. It's pinned, not fetched
  from `github.com/<user>.keys`, so a GitHub account compromise can't open
  sign-up. Passkey registration is unlocked only by a signature from the
  matching private key:
  1. `GET /signup` is available **only while no passkey exists**. It shows
     a challenge file with:
     - the purpose (`specage-signup`);
     - the server host;
     - a 32-byte random nonce;
     - an expiry 5 minutes out.
  2. The human signs it locally:
     `ssh-keygen -Y sign -f ~/.ssh/id_ed25519 -n specage-signup@<host> challenge.txt`
     and pastes the armored `SSHSIG` signature.
  3. The server verifies it with `node:crypto` (Ed25519 only). Verification
     checks:
     - the SSHSIG framing;
     - the namespace;
     - the hash algorithm (sha512);
     - the challenge's host, nonce and expiry.

     The nonce is single-use (stored as consumed).
  4. A verified signature opens a one-time registration window (5 minutes,
     same browser session) for **exactly one** passkey. Once a passkey
     exists, `/signup` returns 404.
  5. CI tests the verifier against real signatures produced by `ssh-keygen`
     in the test run, including tampered, wrong-namespace, expired and
     replayed cases.
- **More devices:** only from a signed-in session. "Add device" mints a
  one-time link that expires after 10 minutes, and its use requires a
  passkey assertion first.
- **Recovery (HUMAN):** if every passkey is lost, run
  `flyctl ssh console -C "node dist/admin.js reset-credentials"`. This
  deletes the passkeys and logs the action, which makes `/signup` available
  again, still gated by the owner key. The roots of trust are therefore the
  owner's private key *and* control of the Fly org. Write that down in
  `docs/security.md`. Rotate the owner key by setting a new `OWNER_PUBKEY`.
- **Storage:** SQLite on a 1 GB Fly volume (one machine). Tables:
  - credentials (id, public key, counter, transports, created, last used,
    label);
  - consumed challenge nonces;
  - an audit log (time, action, repo, result).
- **Signature counter:** enforce it when it's non-zero. Some passkeys always
  report 0.

*Session*
- An AES-256-GCM-encrypted cookie (key: `SESSION_SECRET`) holding
  `{credential_id, issued, expires}`.
- Cookie flags: `HttpOnly; Secure; SameSite=Strict; Path=/`.
- 12 h absolute lifetime.
- **Step-up:** a dispatch requires a fresh passkey assertion (within the
  last 5 minutes), because a dispatch starts paid agent runs.

*CSRF:* every non-GET request needs:
- a matching `Origin` header;
- the custom header `X-Specage: 1`;
- a per-session CSRF token (double-submit).

*GitHub access (server-side only)*
- **The specage App:**
  - Permissions: Contents read & write; Metadata read. No webhooks.
  - Installed only on specage-enabled repos.
  - Created from a **manifest** the agent generates. The human submits it
    in the browser (HUMAN) and installs it on the project repos.
  - Its private key goes into the Fly secret `GITHUB_APP_PRIVATE_KEY`.
- Per request, the server mints a 1 h **installation token** for that repo,
  with the token request limited to `contents: write` on that one repo.
- Tokens are cached in memory until 5 minutes before expiry and never sent
  to the browser.
- The server's code is the allowlist (the API table below). On top of that,
  rulesets (§10.4) limit the App to `spec` and `dispatch/*` tags, so even a
  compromised server can't push to the default branch or `spec-state`.

**API.** Every route checks the session, that the specage App is installed
on the repo, and that the repo has a `spec` branch with
`.specage/config.yaml`.

| Route | Does |
|---|---|
| `GET /api/me` | session info (credential label, expiry), or 401 |
| `GET /api/repos` | specage-enabled repos among the App's installations |
| `GET /api/r/:owner/:repo/spec` | `{content, head_sha, path}` from `spec` |
| `GET /api/r/:owner/:repo/state` | trace, work, questions and the latest report from `spec-state` |
| `PUT /api/r/:owner/:repo/spec` | parse + lint with `@specage/core`; on errors → 422 + diagnostics. Otherwise commit via the Git Data API (blob → tree → commit → update `refs/heads/spec`, **non-force**). If `base_sha` ≠ head → 409 with the remote content |
| `GET /api/r/:owner/:repo/dispatch/preview` | cursor → head node diff (JSON) |
| `POST /api/r/:owner/:repo/dispatch` | if head = `expected_head`, create `refs/tags/dispatch/<UTC ts>`, else 409 |
| `POST /auth/register/{options,verify}` | `GET /signup` + `POST /auth/signup/verify` (owner-key challenge, only while no passkey exists), then registration; or add-device (needs a session + one-time link) |
| `POST /auth/login/{options,verify}` | passkey login; also used for step-up |
| `POST /auth/logout` | clear the session |
| `GET/DELETE /api/credentials` | list or revoke passkeys (step-up required; can't delete the last one) |
| `GET /healthz` | liveness |

Server-side lint on save means a broken spec can't reach the branch, and so
can't reach a dispatch.

**Commit identity:** the committer is the specage App. The author is set to
the human (`AUTHOR_NAME`/`AUTHOR_EMAIL` env) in the Git Data API commit, so
history shows who wrote the spec. Commit message: `spec: <summary>` (first changed
node IDs).

**Headers:**
- `Content-Security-Policy`:
  - `default-src 'self'`
  - `connect-src 'self'`
  - `img-src 'self' https://*.githubusercontent.com https://github.com`
  - `media-src 'self' https://*.githubusercontent.com`
  - `frame-ancestors 'none'`
  - `base-uri 'none'`
  - `form-action 'self' https://github.com`
- Also HSTS, `X-Content-Type-Options: nosniff` and
  `Referrer-Policy: no-referrer`.

**Ops:**
- Per-session rate limit: 60 writes/hour.
- Never log tokens, cookies or spec content. Log route, status, login and
  repo only.

**Fly.io deployment:**
- **Where:** the separate org whose API token the human provides.
  - `deploy/fly.toml`; `Dockerfile` (multi-stage, non-root).
  - `auto_stop_machines = "stop"`, `min_machines_running = 0`, health check
    on `/healthz`.
  - The region is set in `fly.toml` (default `yyz`).
- **Fly secrets:**
  - `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `SESSION_SECRET`
    (32 random bytes, base64), `OWNER_PUBKEY`, `GITHUB_APP_ID`,
    `GITHUB_APP_PRIVATE_KEY`, `PUBLIC_URL`, `AUTHOR_NAME`, `AUTHOR_EMAIL`.
  - A volume `specage_data` mounted at `/data`, holding the SQLite file.
    Back it up with Fly volume snapshots (the default retention is fine).
- **Deploy workflow:** `.github/workflows/deploy.yml` in the specage repo.
  - Triggers: push to `main` touching `packages/{core,web,server}/**`,
    `deploy/**` or `Dockerfile`; also manual.
  - Runs `flyctl deploy --remote-only` with repo secret `FLY_API_TOKEN`, an
    org-scoped deploy token for that org.
  - The app name comes from repo variable `FLY_APP` (default `specage`).
  - Concurrency group `fly-deploy`.
- **Local dev:** `npm run dev` runs the server with `DEV_GITHUB_TOKEN` (a
  PAT) in place of the App and a virtual authenticator for passkeys. It's
  refused unless `NODE_ENV=development`.

**Later (P6), not now:** a webhook endpoint and sign-off writes to
`spec-state`, which would mean widening the App's ruleset bypass. That gets
its own design review then.

### 10.4 Security rules for both surfaces

- **Untrusted content.** Spec text, and everything agents write to
  `spec-state`, is untrusted.
  - Render it as text: no raw HTML, and markdown only through a sanitizer
    with an allowlist.
  - Links are allowlisted to `github.com`, `*.githubusercontent.com` and the
    project's Pages paths.
- **The Pages build is read-only.** It is never given an auth path or any
  token handling. Every Pages site of an account shares one origin
  (`<owner>.github.io`), including tbgwaf's PR-preview builds of
  agent-written code, so nothing secret may live there.
- **Private repos.** Pages sites are public on non-Enterprise plans.
  `specage install` must detect a private repo and set `pages.mode: off`
  with a warning. Private repos are viewed through the server only.
- **Repo rulesets.** `specage install --rulesets` is optional and needs
  **HUMAN-CONFIRM**. It sets up:
  - `spec`: updates only by the repo admin (the human) and the specage App;
    no force-push or deletion;
  - `spec-state`: updates only by the-intern's App (bypass actor) and
    GitHub Actions; no force-push or deletion;
  - `refs/tags/dispatch/*`: creation only by the admin and the specage App;
    update and deletion blocked;
  - the default branch: the specage App is **not** a bypass actor.

Acceptance criteria (P4/P5):
- Playwright e2e against fixture data, with GitHub and the server API mocked:
  - read-only page render;
  - passkey sign-up and login (Playwright virtual authenticator); `/signup` is gone once a passkey exists; step-up before dispatch;
  - cursor sync and gutter dots;
  - lint shown on the client and enforced by the server (422);
  - save, including a conflict (409);
  - dispatch preview and dispatch.
- Server unit tests:
  - cookie encryption round-trip, and tampering rejected;
  - CSRF rejections;
  - SSHSIG verification against `ssh-keygen` signatures (valid, tampered,
    wrong namespace, expired, replayed nonce); signature-counter regression rejected;
    installation tokens never reach the client;
  - no route reaches GitHub with anything outside the listed operations.

---

## 11. Later: merge gates and `!proof` (P6, design only)

- One workflow on the project's **default branch**, `specage-gate.yml` (on
  `pull_request`), installed via a PR that `specage install --gates` opens.
  It provides two required checks:
  - **`specage/claims`**: every claim of the PR's work item is at the
    current node hash and `done`, or explicitly released. A label
    `spec-drift-ok` overrides it, and then a follow-up item is filed
    automatically.
  - **`specage/proofs`**: every `!proof` whose parent subtree contains a
    claimed leaf has a sign-off.
- **Producing proofs**: CI generates artifacts from the PR commit, never
  from agent uploads. The agent supplies:
  - a scenario, for `video` and `screenshot`;
  - preview URLs and steps, for `demo`;
  - a runnable example, for `snippet` and `transcript`;
  - code links, for `walkthrough`.
- **Sign-off**: recorded in `spec-state/signoffs.yaml` as `{proof_id,
  proof_hash, commit, artifact}` and pinned to a commit. New commits
  invalidate it, unless the regenerated artifact is byte- or pixel-identical.
- **Scope**: a signed-off proof is standing, and is only re-triggered when a
  PR claims a leaf in its subtree.

---

## 12. P0 details: repo bootstrap, CI, devcontainer

**Devcontainer** (`.devcontainer/devcontainer.json`):
- Node 22, `gh` CLI, git, and Playwright's Chromium with its dependencies.
- `postCreateCommand: npm ci`.
- Forward the Vite port.

**Dev image for the-intern**:
- Build and push `ghcr.io/thedeepestspace/specage-dev:latest` from the same
  Dockerfile on pushes to `main` that touch `.devcontainer/**` or the
  Dockerfile.
- Mirror tbgwaf's `docker-build.yml` pattern. the-intern picks it up
  automatically (§8.1).

**CI** (`.github/workflows/ci.yml`, on push and PR):
1. `npm ci`; typecheck; lint (eslint + prettier check).
2. `vitest`: core unit tests, Lezer grammar tests (`@lezer/generator`
   test files per rule), and **golden tests**: `fixtures/tbgwaf/tbgwaf.specage`
   → expected `parse.json`, `hash.json`, `lint.json`. Regenerating these is a
   deliberate script, `npm run fixtures:update`.
3. CLI e2e: run the built binary over the fixtures, with exit codes checked.
4. Build `web`, then run Playwright e2e (P4/P5).
5. On `main`: publish a **dogfood page**, the tbgwaf fixture rendered with a
   sample state, to the specage repo's own Pages.

**Release**: a tag `v*` → GitHub Release, and the `v0` tag is moved.

**Repo hygiene**:
- `CONTRIBUTING.md` points agents at this document.
- `.github/dependabot.yml` for npm and actions.
- Pin all actions by SHA, the way the-intern and tbgwaf do.

---

## 13. Spikes: verify these first and record the results in `docs/spikes.md`

1. A workflow on an **orphan branch** runs for `push` to that branch and for
   tags pushed onto its commits.
2. A tag created through the REST API (`POST /git/refs`) with a GitHub App
   installation token fires a
   `push` workflow.
3. Pushes to `spec-state` by the-intern's App token trigger
   `specage-state.yml`. Pushes made with `GITHUB_TOKEN` don't.
4. `gh workflow run` against the-intern's `dispatcher.yml` with a
   fine-grained PAT (Actions: write only) works cross-repo.
5. Publishing under `gh-pages/specage/` with the retry-push pattern leaves an
   existing site (tbgwaf's `pr-preview/`, `performance/`, `gallery/`)
   intact.
6. GitHub retargets a stacked PR to the default branch when its base PR
   merges and the base branch is deleted. This is for P7; just record the
   behaviour.

If a spike fails, stop and report with a proposed alternative. Don't
silently redesign.

---

## 14. Pilot: tbgwaf (end of P3, **HUMAN-CONFIRM** before each write)

1. `specage install --repo TheDeepestSpace/tbgwaf --from fixtures/tbgwaf/tbgwaf.specage --dry-run`,
   then show the plan.
2. After confirmation, the real install. The Pages mode will be
   `gh-pages-subdir` (tbgwaf deploys `gh-pages` with `keep_files: true` and
   a retry-push script).
3. First dispatch. Expect **mostly `satisfied` outcomes and very few
   issues**. Known contradictions the report must surface, found while
   writing the fixture:
   - `docs/jev-preview.md` says Blue vs Jev auto-commits, but
     `web/jev-preview.js` requires a manual commit (the spec follows the
     code);
   - the `GameLogic.h` comment says a round ends when nothing is in flight,
     but the code always runs the full 5 s.

   If the first dispatch files more than ~10 issues, discovery is broken.
   Stop and report.
4. A reorg-only edit (move two blocks, rename one ID with `<-`, reflow some
   text) followed by a dispatch must file **zero** issues.

---

## 15. Out of scope for this pass

- npm publishing.
- Server webhooks and any server write to `spec-state` (P6).
- GitHub OAuth login. Passkeys replace it (§10.3).
- Automatic stack / supersede (P7).
- Merge gates and proof sign-off enforcement (P6). Parsing and rendering
  `!proof` and `!invariant` **is** in scope.
- Multi-file specs (`include`). One file per project in v0.
- Generating property tests from `!invariant`.
- Any change to the-intern. If one turns out to be needed, open an issue on
  the-intern describing it instead.

---

## 16. Design notes (why, so you don't undo it)

- **Orphan branches, not files on the default branch**: nothing for code PRs
  to conflict with, no CI noise on spec edits, and the human-only rule is
  enforced by git itself.
- **Diff from the claimed hash, not from the cursor**: two quick edits to
  the same node must reach an in-flight PR as one change.
- **Outbox plus `workflow_dispatch`, not comments**: the-intern deliberately
  ignores its own comments.
- **Evidence tiers, and `verified` reserved for the human**: discovery
  agents over-report "already implemented".
- **Policy file, not agent judgement, chooses the action**: the agent
  classifies changes; a fixed table decides the action, so behaviour stays
  predictable and tunable.
- **Leaf-level claims**: block-level claims would invalidate a whole PR on
  any small edit in the block.
