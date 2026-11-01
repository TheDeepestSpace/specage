# specage

A human-written, structured, natural-language spec for a project, plus a trace linking each spec node to the evidence that it is implemented.
An agent ([the-intern](https://github.com/TheDeepestSpace/the-intern)) is dispatched with the node-level diff of the spec, reconciles it against what exists,
and files or amends issues and PRs only where there is a real gap.

Specs and traces for every project live in one private data repo ([specage-data](https://github.com/TheDeepestSpace/specage-data)),
as orphan branch pairs `specages/<project>/spec` and `specages/<project>/trail`, dispatched by commit: a commit on `specages/<project>/spec` starts the-intern (see [Setup](#setup)).
Issues, PRs and Pages stay on each project's own repo.

- Language: [`protocol/GRAMMAR.md`](protocol/GRAMMAR.md). Agent runbook: [`protocol/PROTOCOL.md`](protocol/PROTOCOL.md). Both are usable by hand.
- Build spec: [`SPECAGE-HANDOFF.md`](SPECAGE-HANDOFF.md).

## Packages

| Package | |
|---|---|
| `packages/core` | parser, hashing, lint, node-level diff, zod schemas for state |
| `packages/cli` | `specage parse \| lint \| hash \| diff \| state \| cursor \| outbox \| render` |
| `packages/web` | read-only renderer (GitHub Pages) and the CodeMirror editor |
| `packages/server` | Fly.io server: passkeys, owner-key sign-up, fixed GitHub API |
| `packages/action` | composite actions used by the data-repo workflows |

## Use

```sh
npx --yes github:TheDeepestSpace/specage#v0 lint my.specage
```

Docs: [`docs/security.md`](docs/security.md), [`docs/spikes.md`](docs/spikes.md) (not yet run), [`docs/deploy.md`](docs/deploy.md).

## Setup

Projects are added in the web UI (home page, **Add project**, passkey step-up): pick a repo the specage GitHub App can see, review the preview, create.
The server (using the App installation token only; no PATs, nothing secret written to the data repo) creates `specages/<project>/spec` and `.../trail` from `templates/` and the `specage-dispatch` / `specage` labels on the project repo. It is idempotent: existing branches are left alone.
The project name currently equals the repo name; Pages publishing is off.

**App permissions:** Contents: read & write on the data repo, Issues: read & write and Metadata: read on project repos. A missing permission shows up as a 403 with the permission named. The data repo must already have at least one commit.

**Dispatch on commit:** saving in the editor commits to `specages/<project>/spec`. The server lints on save and commits; it files no issue. The cursor is the last dispatched commit, stored as the ref `refs/specage/dispatched/<project>` in the data repo (replaces `dispatch/*` tags). The agent diffs from the cursor to the dispatched sha and advances the cursor itself once it has handled the dispatch (see `protocol/PROTOCOL.md`). The App's `push` webhook goes to the-intern's Cloudflare worker (see the-intern#253), which verifies it and runs `dispatcher.yml` with `Run the specage dispatch for commit <sha>`.

**One-time webhook setup:** in the specage App settings enable the webhook, set its URL to the worker's URL, set the same secret as the worker's webhook secret, subscribe to **Push** events, and add the data repo to the worker's allowlist. Pushes made outside the server (plain `git push`) reach the worker but are dispatched the same way.

**Not covered by this path:** outbox fan-out (`specage-trail.yml`, needs a token and the App's Workflows permission) and Pages publishing are no longer provisioned by init.
