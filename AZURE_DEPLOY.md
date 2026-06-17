# Azure App Service deployment (Tapsys PMS)

Live demo: **https://tapsys-pms-3huqr.azurewebsites.net**

The app is a Node/Express + Prisma backend that also serves the single-file front-end.
On Azure it runs on **App Service (Linux, Node 22)** with **SQLite** on the persistent
`/home` share. Below is exactly how it's deployed, including the gotchas that bit us.

## Resources
- Resource group: `tapsys-pms-rg`
- Plan: `tapsys-pms-plan` — **Basic B1**, Linux (Free F1 hit the daily CPU quota and was disabled)
- Web app: `tapsys-pms-3huqr` — runtime `NODE|22-lts`, region Southeast Asia

## App settings
| Setting | Value |
|---|---|
| `DATABASE_URL` | `file:/home/site/wwwroot/prisma/prod.db` (absolute — see gotcha #2) |
| `JWT_SECRET` | generated random |
| `DEMO_PASSWORD` | `tapsys` |
| `SCM_DO_BUILD_DURING_DEPLOYMENT` | `false` (we ship a pre-built package) |
| Startup command | `cd /home/site/wwwroot && node src/index.js` |

## How to (re)deploy
A pre-built package is used (no remote Oryx build), so the Linux Prisma engine and a
schema-initialised SQLite DB are bundled.

1. Generate the Linux query engine + a tables-only `prod.db` locally:
   ```pwsh
   cd server
   $env:DATABASE_URL='file:./prod.db'
   node scripts/prepare-schema.js
   npx prisma generate            # needs binaryTargets ["native","debian-openssl-3.0.x"]
   npx prisma db push --skip-generate --accept-data-loss
   ```
2. Stage `server/` (incl. `node_modules`, `prisma/prod.db`, generated `prisma/schema.prisma`)
   plus the root `index.html` copied to `public/index.html`. Exclude `.env` and `dev.db`.
3. **Zip with `tar` (forward slashes!), not Compress-Archive/ZipFile** — see gotcha #1:
   ```pwsh
   tar -a -c -f deploy.zip *        # run from the staging dir
   ```
4. Deploy: `az webapp deployment source config-zip -g tapsys-pms-rg -n <app> --src deploy.zip`
5. First boot auto-seeds the DB (idempotent: only when empty).

## Gotchas we hit (so the next person doesn't)
1. **Windows zip path separators.** `Compress-Archive` and `System.IO.Compression.ZipFile`
   write entries with backslashes (`node_modules\.bin\x`). Azure's Linux `rsync` rejects these
   (`Invalid argument (22)`) and silently leaves `wwwroot` empty. Use `tar -a -c -f` which
   writes forward slashes.
2. **SQLite relative path.** Prisma resolves `file:./prod.db` relative to the process CWD at
   runtime (here `wwwroot`, so `wwwroot/prod.db` — empty), but relative to the schema dir at
   `db push` time (`wwwroot/prisma/prod.db`). Use an **absolute** `DATABASE_URL` to avoid the mismatch.
3. **Free F1 tier** has a ~60 CPU-min/day quota; the build/seed tripped it and the site was
   disabled. Basic B1 has no quota.
4. **Custom startup command** must `cd /home/site/wwwroot` first — a bare `npm start`/`node`
   runs from `/` and fails to find `package.json` / `src/index.js`.
5. Azure now disables **SCM basic auth** by default; enable it
   (`basicPublishingCredentialsPolicies`) to read detailed Kudu deployment logs.

For a managed PostgreSQL setup instead of SQLite, set `DATABASE_URL` to the Postgres
connection string — the provider auto-switches (see `scripts/prepare-schema.js`).
