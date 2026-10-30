# Deploying the server (HUMAN steps marked)

1. **HUMAN** Create the Fly app and volume in the separate org: `flyctl apps create <name> -o <org>`, `flyctl volumes create specage_data --size 1 --region yyz`.
2. **HUMAN** Decide the final hostname (passkeys bind to it).
3. Generate the GitHub App manifest: `node packages/server/dist/admin.js app-manifest https://<host>`; **HUMAN** submits it at
   https://github.com/settings/apps/new (manifest flow), installs the App on specage-enabled repos, and keeps the private key.
4. **HUMAN** Set Fly secrets: `SESSION_SECRET` (`openssl rand -base64 32`), `OWNER_PUBKEY` (`cat ~/.ssh/id_ed25519.pub`),
   `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `PUBLIC_URL`, `AUTHOR_NAME`, `AUTHOR_EMAIL`.
5. **HUMAN** In this repo: secret `FLY_API_TOKEN`, variable `FLY_APP`. Pushes to `main` that touch the server, web, core or `deploy/` then deploy.
6. Visit `/signup`, sign the challenge with the owner key, create the passkey.

Local UI work without GitHub: `npm run build && npm run dev:fake` (real server, in-memory GitHub, dev-only).
