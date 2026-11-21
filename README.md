# NestGuard Backend (FastAPI)

API for the NestGuard hostel access-control system: staff login, resident enrolment, fingerprint verification
logging, alerts and live dashboard events. Phase-I scope only; everything else is designed, not built.

- **Stack:** Python 3.12, FastAPI, Uvicorn, Motor (MongoDB), python-socketio, PyJWT, bcrypt, `cryptography` (AES-256-GCM)
- **Gate:** verify-and-log. No lock, relay or solenoid. The guard opens the door.
- **Notifications, SMS/WhatsApp, Telegram, AI scoring:** not in Phase-I.

## Run
```bash
python -m venv .venv && . .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
cp .env.example .env                                  # fill the three secrets (see comments inside)
python -m scripts.seed                                # staff accounts + default gates
uvicorn app.asgi:app --port 3000 --reload
pytest                                                # 37 tests, no database needed
```
Docs UI: http://localhost:3000/docs. Existing plaintext templates: `python -m scripts.migrate_templates --dry-run`, then without the flag.

## Modules (`app/modules/<name>/`)
Each feature is one folder with `router.py` + `service.py`, switched on by `ENABLED_MODULES`. Modules never reach into
each other's internals: they call another module's `service` functions or publish events on `app/core/events.py`.

| Module | Does | Calls |
|---|---|---|
| `auth` | email/password login, JWT, roles | - |
| `students` | residents, workers, staff records | - |
| `biometric` | enrol / update finger / thumb login arming, template cache for the Gate PC | students, auth, access |
| `access` | scan to access log, curfew rules, alerts | gates, alerts |
| `gates` | gate registry | - |
| `alerts` | alert feed, acknowledge | - |
| `realtime` | Socket.IO (`scan_event`, `alert_event`, ...) | listens to events |

Adding a feature (e.g. visitors): create `app/modules/visitors/` with a `router`, add the name to `ENABLED_MODULES`.

## Security model
- Secrets are required at startup (min 32 chars, key = 64 hex); no defaults, `.env` is git-ignored.
- Fingerprint templates are AES-256-GCM encrypted in MongoDB and only decrypted for the Gate PC (`X-Service-Key`).
- Gate/hardware endpoints need the service key or a staff JWT; thumb login uses a one-time nonce and hands the token over once.
- A fingerprint that is not matched never logs anyone in. `simulate-touch` exists only with `ENV=development` and `ENABLE_SIMULATE=true`.
- Socket.IO: only signed-in staff receive scans, alerts and enrolments; clients cannot inject events.

## Hardware acceptance test (first day with the Live20R)
1. Start API + `gateway/zkteco-live20r-bridge.ps1`. Bridge prints cache count 0.
2. Dashboard > Enrollment: enrol a person, touch 1 finger. Student appears, cache re-syncs to 1.
3. Touch the enrolled finger: VERIFIED entry in the live feed; touch again: exit.
4. Touch an unenrolled finger: REJECTED + critical alert.
5. Stop the API, touch an enrolled finger twice, restart the API: 2 logs appear once each.
6. Login page > thumb login with an enrolled staff finger; an unenrolled finger must NOT log in.

## Migrating from the old Node backend
**Rotate the MongoDB Atlas password and every old secret**: the old `.env` was committed and stays readable in git history.

## CI/CD
- `.github/workflows/ci.yml`: runs the test suite and a Docker build on every push and pull request.
- `.github/workflows/release.yml`: on `main`, publishes `ghcr.io/<owner>/nestguard-backend:latest` (and a `sha-` tag).
- Cloudflare Workers cannot run this API (long-lived Python process + Socket.IO + MongoDB). Run the image on any Docker host
  (VPS, Render, Railway, Fly.io) and put it behind HTTPS; a Cloudflare Tunnel (`cloudflared`) can expose a machine you own.
  Set the same `JWT_SECRET` as the frontend, `CLIENT_URL` to the frontend URL, and the other variables from `.env.example`.
