# Security Policy

## Secrets

Do not commit secrets to this repository.

Required secrets:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PRIVATE_KEY`
- `SHEET_ID`
- `CALENDAR_ID`
- `ADMIN_EMAILS`
- `ALLOWED_ORIGINS`

Use Cloudflare Worker secrets for production and `.dev.vars` for local development.

## Authentication

All app data APIs require a Google ID token. The Worker verifies:

- RS256 signature against Google's public keys
- `aud` equals `GOOGLE_CLIENT_ID`
- `iss` is a Google issuer
- token expiry
- verified email

## Authorization

- Admin users are determined server-side from `ADMIN_EMAILS`.
- Parent users can edit only members linked to their Google email in the `Members` sheet.
- Google Sheets and Google Calendar writes happen only from the Worker.

## Public Repository Rules

- Never hard-code service account JSON, private keys, OAuth secrets, tokens, sheet URLs, or calendar IDs.
- Keep `.dev.vars`, `.env`, and generated deployment state out of Git.
- Review diffs before pushing.

