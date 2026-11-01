# specage

A human-written, structured, natural-language spec for a project, plus a trace linking each spec node to the evidence that it is implemented.
An agent ([the-intern](https://github.com/TheDeepestSpace/the-intern)) is dispatched with the node-level diff of the spec, reconciles it against what exists,
and files or amends issues and PRs only where there is a real gap.

Specs and traces for every project live in one private data repo ([specage-data](https://github.com/TheDeepestSpace/specage-data)),
as orphan branch pairs `specages/<project>/spec` and `specages/<project>/trail`, with dispatch tags `dispatch/<project>/<ts>`.
Issues, PRs and Pages stay on each project's own repo.

- Language: [`protocol/GRAMMAR.md`](protocol/GRAMMAR.md). Agent runbook: [`protocol/PROTOCOL.md`](protocol/PROTOCOL.md). Both are usable by hand.
- Build spec: [`SPECAGE-HANDOFF.md`](SPECAGE-HANDOFF.md).

## Packages

| Package | |
|---|---|
| `packages/core` | parser, hashing, lint, node-level diff, zod schemas for state |
| `packages/cli` | `specage parse \| lint \| hash \| diff \| state \| cursor \| outbox \| render \| install` |
| `packages/web` | read-only renderer (GitHub Pages) and the CodeMirror editor |
| `packages/server` | Fly.io server: passkeys, owner-key sign-up, fixed GitHub API |
| `packages/action` | composite actions used by the data-repo workflows |

## Use

```sh
npx --yes github:TheDeepestSpace/specage#v0 lint my.specage
npx --yes github:TheDeepestSpace/specage#v0 install --repo owner/repo --from my.specage --dry-run
```

Docs: [`docs/security.md`](docs/security.md), [`docs/spikes.md`](docs/spikes.md) (not yet run), [`docs/deploy.md`](docs/deploy.md).
