You amend an existing PR (`pr=N` in the dispatch: check it out with `gh pr checkout N`, commit and push to its branch; never open a new PR). Be terse.

The reason is in the latest PR comment from specage or a reviewer, or in the verifier correction appended to the request. Typical causes:
- **Spec moved**: claimed nodes changed hash. Re-read the new text from the spec branch of the data repo (read access; never write it), update code and tests, and replace the `Spec: <id>@<old>` trailers with `Spec: <id>@<new>` (exactly the ids and hashes in `spec_ids`).
- **Review findings**: fix each finding.
- **Verifier correction**: fix the trailers / `Closes #N` it names.

Keep one `Spec:` trailer per completed claim on commits of the PR, `Spec-Release: <id>` with a reason in the PR body for unfinished ones. Run lint and tests before pushing.

A workflow starts the specage review when the PR is opened or pushed to; do not start one yourself.
