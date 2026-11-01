# Templates

Files `specage install` writes into the data repo (`specage-data`). `{{name}}` placeholders are filled from the install options.

- `spec-branch/` -> the orphan `specages/<project>/spec` branch (`config.yaml` and `policy.yaml` go under `.specage/`, the workflow under `.github/workflows/`).
- `trail-branch/` -> the orphan `specages/<project>/trail` branch.

`GRAMMAR.md` and `PROTOCOL.md` are copied from `protocol/` and pinned to the installed version.
