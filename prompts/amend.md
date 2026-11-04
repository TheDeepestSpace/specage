You amend an existing PR (`pr=N` in the dispatch: check it out with `gh pr checkout N`, commit and push to its branch; never open a new PR). Be terse.

The reason is in the latest PR comment from specage or a reviewer, or in the verifier correction appended to the request. Typical causes:
- **Spec moved**: claimed nodes changed hash. Re-read the new text from the spec branch of the data repo (read access; never write it), update code and tests, and replace the `Spec: <id>@<old>` trailers with `Spec: <id>@<new>` (exactly the ids and hashes in `spec_ids`).
- **Review findings**: fix each finding.
- **Verifier correction**: fix the trailers / `Closes #N` it names.

Keep one `Spec:` trailer per completed claim on commits of the PR, `Spec-Release: <id>` with a reason in the PR body for unfinished ones. Run lint and tests before pushing.

After opening the PR (and after pushing review-requested changes), initiate a specage review: `git clone --no-checkout <data_repo> review && cd review && git fetch origin specages/<project>/review specages/<project>/trail`, check out `specages/<project>/review` if it exists, else `git switch -C specages/<project>/review origin/specages/<project>/trail`, then `git commit --allow-empty -m "review <owner/repo>#<number>"` and `git push origin specages/<project>/review` (fast-forward only; on rejection fetch and retry). This needs write access to the data repo's review branch only; if the push is refused, say so in your final comment.
