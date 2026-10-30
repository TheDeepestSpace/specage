# Templates

Files `specage install` writes. `{{name}}` placeholders are filled from the install options.

- `spec-branch/` -> the orphan `spec` branch (`config.yaml` and `policy.yaml` go under `.specage/`, the workflow under `.github/workflows/`).
- `state-branch/` -> the orphan `spec-state` branch.

`GRAMMAR.md` and `PROTOCOL.md` are copied from `protocol/` and pinned to the installed version.
