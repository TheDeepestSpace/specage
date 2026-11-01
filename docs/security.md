# Security notes

## Roots of trust

- **The owner's SSH private key** unlocks passkey sign-up (`OWNER_PUBKEY`, Ed25519, pinned: never fetched from GitHub).
- **Control of the Fly org** (`flyctl ssh console`) can reset credentials.

Losing every passkey: `flyctl ssh console -C "node dist/admin.js reset-credentials"`. This deletes all passkeys and
logs the action; `/signup` is then open again, still gated by the owner key. Rotate the owner key by setting a new `OWNER_PUBKEY`.

## Sign-up

`GET /signup` (JSON) only exists while no passkey exists, and mints a challenge (purpose, host, 32-byte nonce, expiry 5 min)
held in a sealed cookie. The owner signs it with
`ssh-keygen -Y sign -f ~/.ssh/id_ed25519 -n specage-signup@<host> challenge.txt`. The server verifies the SSHSIG
framing, namespace, `sha512`, the owner key, host, expiry and a never-before-seen nonce (consumed on success). That opens one
5-minute registration window for exactly one passkey; afterwards `/signup` is 404. Tests use real `ssh-keygen` signatures:
valid, tampered, wrong namespace, other key, expired, replayed.

Choose the final hostname before signing up: passkeys are bound to the RP ID.

## Sessions, CSRF, step-up

- Session: AES-256-GCM sealed cookie (`HttpOnly; Secure; SameSite=Strict; Path=/`), 12 h absolute.
- Every non-GET request needs a matching `Origin` and `X-Specage: 1`. Authenticated routes also need the per-session CSRF token
  (`X-CSRF-Token`, delivered by `/api/me` and `/auth/login/verify`). Unauthenticated auth routes (login/sign-up) cannot have a
  session token yet, so they rely on Origin + custom header + `SameSite=Strict` + the sealed challenge cookie.
- Dispatch needs a passkey assertion in the last 5 minutes. The SPA always asserts right before it POSTs.
- Add-device: a signed-in session with a fresh assertion mints a single-use link (10 min). Redeeming it opens a registration window.
  (The handoff wording, "its use requires a passkey assertion first", is read as the minting side: the new device has no passkey yet.)
- Signature counter: enforced by the WebAuthn library whenever either side is non-zero; authenticators that always report 0 work.

## GitHub access

The server talks to one repository only: the data repo (`SPECAGE_DATA_REPO`) that holds every project's
`specages/<project>/{spec,trail}` branches. It reaches GitHub only through `RealGitHub`, whose request wrapper refuses anything
not in `ALLOWED` (`packages/server/src/github.ts`): installation lookup, token minting, reads of file contents/refs/commits,
blob/tree/commit creation, a non-force update of `refs/heads/specages/*/spec`, and creation of `refs/tags/dispatch/*`-style refs.
Installation tokens are limited to the data repo and `contents`, cached in memory until 5 minutes before expiry, and never sent
to the browser (tested). Data-repo rulesets (`specage install --rulesets`, HUMAN-CONFIRM) further limit the App to the
`specages/*/spec` branches and `dispatch/*` tags.

`DEV_GITHUB_TOKEN` is refused unless `NODE_ENV=development`.

## Untrusted content

Spec text and everything on a trail branch is untrusted. The SPA builds DOM with `textContent` only (no `innerHTML`, no markdown),
and links come from an allowlist (`github.com`, `*.githubusercontent.com`, `*.github.io`, same origin). Evidence must be pinned to a commit
or it is not linked. The Pages build has no auth path and no token handling.

## Not logged

Tokens, cookies, request bodies and spec content. Request logs are `METHOD path status`. The audit table stores time, action, repo, result.
