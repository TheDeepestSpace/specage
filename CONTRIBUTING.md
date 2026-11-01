# Contributing

Agents: read `SPECAGE-HANDOFF.md` first. It is the build spec; it wins over any attached draft.

```sh
npm ci            # also builds (prepare)
npm test          # tsc -b + vitest: core, grammar fixtures, goldens, server, CLI e2e
npm run lint      # eslint + prettier --check
npm run e2e       # Playwright (needs `npx playwright install --with-deps chromium`)
npm run e2e:visual   # mocked-API visual/layout tests (packages/web/visual), no Fly/GitHub needed
npm run fixtures:update   # deliberately regenerate fixtures/tbgwaf golden files and sample state
```

- Pin GitHub Actions by SHA.
- Never write the data repo's `specages/<project>/spec` or `specages/<project>/trail` branches from code that runs in a code PR.
- Anything that writes to a real project or data repo is HUMAN-CONFIRM.
- `dist/` and `packages/cli/bundle/` are not committed. `prepare` builds the CLI into one self-contained file (esbuild bundle), which, which is what makes
  `npx --yes github:TheDeepestSpace/specage#v0 <cmd>` work.

## Visual snapshots

`packages/web/visual` runs the built web app with every `/api` call mocked and checks layout
assertions plus `toHaveScreenshot()` baselines at desktop (1280x800) and mobile (390x844).
Baselines live in `packages/web/visual/__screenshots__` and are only valid for the pinned image
`mcr.microsoft.com/playwright:v1.64.1-noble` (fonts/Chromium differ elsewhere). To update them,
run the **Update visual snapshots** workflow (Actions tab, on your branch) and pull the commit it
pushes; or locally:

```sh
docker run --rm -v "$PWD":/w -w /w mcr.microsoft.com/playwright:v1.64.1-noble \
  sh -c 'npm ci && npm run build && npx playwright test -c packages/web/visual/playwright.config.ts --update-snapshots'
```

Bump the image tag in `ci.yml` and `update-snapshots.yml` together with `@playwright/test`.
