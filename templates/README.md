# Templates

Files the server's project init (`packages/server/src/init.ts`) writes into the data repo (`specage-data`). `{{name}}` placeholders are filled from the init options.

- `spec-branch/` -> the orphan `specages/<project>/spec` branch (`config.yaml` and `policy.yaml` go under `.specage/`).
- `trail-branch/` -> the orphan `specages/<project>/trail` branch.

`GRAMMAR.md` and `PROTOCOL.md` are copied from `protocol/` and pinned to the installed version.
