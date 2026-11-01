# Spikes (handoff section 13)

**Status: none of the six has been run.** They need things the implementing session did not have:
a throwaway repo with admin rights, the-intern's GitHub App, a specage GitHub App and a fine-grained PAT.
The session's token could not create repositories (`gh api repos/TheDeepestSpace/specage-sandbox` is a 404 and
the installation token has no admin on any repo). Per the handoff, a failed or unrun spike means stop and report:
nothing in P3 should be treated as proven until these are recorded here.

Run them with a throwaway project repo (`specage-sandbox`) and a throwaway data repo (`specage-data-sandbox`).
Record the date, the result, and the evidence URL under each heading.

> Superseded: spikes 1 and 2 covered the tag/workflow dispatch and the CLI `install`, both removed (project init is in the web UI, dispatch is commit-driven via the worker). The cursor ref `refs/specage/dispatched/<project>` created with an installation token still needs one real-GitHub check.

## 1. Workflow on an orphan branch of the data repo runs for `push` and for tags pushed onto its commits

```sh
gh repo create TheDeepestSpace/specage-sandbox --public --add-readme
gh repo create TheDeepestSpace/specage-data-sandbox --private --add-readme
node packages/cli/dist/bin.js install --repo TheDeepestSpace/specage-sandbox --data-repo TheDeepestSpace/specage-data-sandbox --dry-run   # review the plan
node packages/cli/dist/bin.js install --repo TheDeepestSpace/specage-sandbox --data-repo TheDeepestSpace/specage-data-sandbox
# push a trivial change to specages/specage-sandbox/spec in the data repo: the lint job of specage-spec.yml should run
# then: git tag dispatch/specage-sandbox/2026-01-01T00-00Z <spec sha> && git push origin dispatch/specage-sandbox/2026-01-01T00-00Z
# the dispatch job should run, with github.ref_type == tag
```

Result: _not run_

## 2. A tag created by `POST /git/refs` with an App installation token fires a `push` workflow

Use the specage server's dispatch route (or `curl` with an installation token). Watch Actions for the `dispatch` job.
Known risk: events created with `GITHUB_TOKEN` do not trigger workflows; installation tokens should.

Result: _not run_

## 3. Pushes to a trail branch with the-intern's App token trigger `specage-trail.yml`; `GITHUB_TOKEN` pushes do not

Push once with each token to `specages/<project>/trail` in the data repo and compare Actions runs.

Result: _not run_

## 4. `gh workflow run` on the-intern's `dispatcher.yml` with a fine-grained PAT (Actions: write only) works cross-repo

The handoff section 8.1 claims were checked by reading `dispatcher.yml` at the time of writing: it declares
`workflow_dispatch` with `target_repo`, `pr_number`, `comment_body`, `installation_id`. That confirms the inputs, not the PAT scope.

```sh
GH_TOKEN=<pat> gh workflow run dispatcher.yml -R TheDeepestSpace/the-intern \
  -f target_repo=TheDeepestSpace/specage-sandbox -f pr_number=1 -f comment_body='backend=claude say hi'
```

Result: _not run_ (inputs confirmed by reading the workflow)

## 5. Publishing under `gh-pages/specage/` leaves the existing site intact

The publish action (`packages/action/publish`) only rewrites `<path>/` on a fresh clone and retries `pull`-less
clone-and-push up to 5 times. Verify against a `gh-pages` branch that has `pr-preview/`, `performance/`, `gallery/`.

Result: _not run_

## 6. GitHub retargets a stacked PR when its base PR merges and the base branch is deleted (for P7)

Result: _not run_
