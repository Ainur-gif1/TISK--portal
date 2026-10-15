# TIK College server and PostgreSQL

This directory adds the server layer beside the existing static portal. It does not replace the current design. When served by this Next.js app, the same HTML/JavaScript portal uses server authentication, PostgreSQL-backed portal state, and the account API. The existing Sites preview remains in demo mode until the backend is installed and configured on a server.

## What is stored

- The 79 groups, 150 teachers, 770 subject records and 32,147 baseline timetable entries from the current portal seed.
- User accounts, password hashes, role, teacher/group association and expiring server sessions.
- Shared admin edits as a JSON portal workspace, plus an audit record for each saved change.
- Failed login counters with hashed client address; raw addresses and passwords are not stored.

Teacher accounts are imported disabled with no password. An administrator assigns a unique password in **Аккаунттар**. Student names and student numbers were not in the source archive, so no students are invented; add each student from **Аккаунттар** or import an approved roster later.

## Initial server setup

Use the previously selected one-server layout: Next.js and PostgreSQL on the college's private VPS. Put the portal behind HTTPS and a reverse proxy that overwrites `X-Real-IP`. Keep PostgreSQL bound to localhost/private networking; do not open port 5432 to the public internet.

1. Install Node.js 24.11+ and PostgreSQL on the authorized VPS.
2. Copy `.env.example` to `.env` on the server, set `DATABASE_URL`, `PORTAL_ORIGIN`, a unique bootstrap admin login and a strong bootstrap password. Keep `.env` outside Git and restrict it to the service account (`chmod 600`).
3. From this folder run `npm install`, then `npm run db:generate`.
4. The initial PostgreSQL migration is included in `prisma/migrations`. On the empty production database run `npm run db:migrate`, then run `npm run db:seed` once. Seed refuses to re-seed a database that already contains timetable rows.
5. Run `npm run build` and `npm start` behind HTTPS. For local UI work, `npm run dev` copies the current portal assets before starting Next.js. Check `/api/health`; it reports only whether PostgreSQL is connected.
6. Use the admin's **Аккаунттар** page to activate teacher accounts and create student accounts. Each account gets its own password; passwords are hashed with bcrypt and never returned by the API.

Do not deploy the backend until the college has approved the server, account roster, and handling of student information. The current Sites static host cannot run this Node/PostgreSQL server; the published static portal is therefore not changed by this scaffold.

## Backup

The starter `scripts/backup/backup.sh` is the PostgreSQL dump script from the supplied security archive. Configure it on the VPS with a restricted backup account and the sample `backup.env`. Schedule it for 02:00 daily, keep roughly seven days locally, and copy encrypted backups off-server. A restore must be tested against a separate test database before relying on a backup.

## API

- `POST /api/auth/login` — login and password; creates a Secure/HttpOnly session cookie on HTTPS.
- `GET /api/auth/session` — current account profile.
- `POST /api/auth/logout` — revokes the current session.
- `GET /api/portal-state` — shared workspace for an authenticated account.
- `PUT /api/portal-state` — save shared workspace; administrator only, with audit record.
- `GET/POST /api/admin/users` — list accounts and create/activate an account; administrator only.
- `GET /api/health` — database connectivity status without connection details.

Write requests validate the request origin. Login attempts are limited to eight per username/address pair in fifteen minutes. Session tokens are random, stored only as SHA-256 hashes, and expire after the configured period.

## Current limitation

No VPS address, PostgreSQL connection string, DNS/reverse-proxy access, or production account roster was supplied in this turn. The schema and API are prepared, but the database has not been initialized and real accounts cannot sign in until these are configured on the authorized server. The browser demo login remains available on the existing static Site.

## Initial administrator and shared group accounts

After migrations and curriculum seed, run `npm run accounts:bootstrap` from `server` with `DATABASE_URL` set. The command creates one `STUDENT` account for each database group with login `group-<group ID in lowercase>` and a separate randomly generated initial password. These are shared group accounts, not individual student identities. Anyone with a group password can use that group's student view; do not use them for private individual records.

If no active administrator with a password exists, it also creates login `admin` with a separate random password. It never replaces an existing password, role, or group association. An existing disabled admin must be recovered using `npm run user:set-password -- admin`.

New credentials are saved to `server/.private/initial-accounts.json` with permissions `0600`, excluded from Git. Retrieve them privately on the backend server and share each group only its own credentials. Do not put this file in `dist`, `public`, or GitHub. An existing output file is never overwritten; move it securely before provisioning additional accounts. Repeated runs with no new accounts leave the existing file intact.

This command requires the initialized PostgreSQL backend. Pushing the code to a static host alone does not create accounts or enable login. The admin and group passwords are not embedded in browser JavaScript.
