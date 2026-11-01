# Contributing

Agents: read `SPECAGE-HANDOFF.md` first. It is the build spec; it wins over any attached draft.

```sh
npm ci            # also builds (prepare)
npm test          # tsc -b + vitest: core, grammar fixtures, goldens, server, CLI e2e
npm run lint      # eslint + prettier --check
npm run e2e       # Playwright (needs `npx playwright install --with-deps chromium`)
npm run fixtures:update   # deliberately regenerate fixtures/tbgwaf golden files and sample state
```

- Pin GitHub Actions by SHA.
- Never write the data repo's `specages/<project>/spec` or `specages/<project>/trail` branches from code that runs in a code PR.
- Anything that writes to a real project or data repo is HUMAN-CONFIRM.
- `dist/` and `packages/cli/bundle/` are not committed. `prepare` builds the CLI into one self-contained file (esbuild bundle), which, which is what makes
  `npx --yes github:TheDeepestSpace/specage#v0 <cmd>` work.
