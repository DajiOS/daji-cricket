# Daji Cricket Ground

Booking site, admin desk and API for Daji Cricket Ground (dajicricket.com), plus the MP13 Academy and the accounting module.

- `server/` Node 22 + TypeScript API (SQLite), run directly with type stripping. No npm install needed at runtime.
- `web/public/` the public website and the built admin desk (`desk.html` + `desk/`).
- `desk/` source of the admin desk (React + TypeScript). Build: `cd desk && node build.mjs` (needs `esbuild`, `react`, `react-dom`).
- `mobile/` Expo app.
- `shared/` types shared by server, web and mobile.
- `deploy/` Docker, Caddy and server setup. See `deploy/DEPLOY.md`.

Secrets (`.env`) and databases never go in git.
