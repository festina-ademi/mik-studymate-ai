# Deployment

This guide covers running StudyMate AI with Docker locally and deploying it to free-tier hosts.
The frontend is a static site; the backend is a FastAPI service that needs a database, a vector
store folder and (optionally) an embedding model.

## 1. Local run with Docker Compose

```bash
cp backend/.env.example backend/.env      # then set GEMINI_API_KEY (and ADMIN_PASSWORD if needed)
docker compose up --build
```

- Frontend: <http://localhost:5173> (nginx serves the build and proxies `/api` to the backend,
  so no CORS or API URL setup is needed).
- Backend: <http://localhost:8000/api/health>.
- Data (SQLite, Chroma, uploads) lives in the `backend-data` volume and survives restarts.

The Docker images were written but **not built in the Phase 10 session** (Docker Desktop was not
running), so run `docker compose build` once and report any problem.

## 2. Free-tier path

| Part      | Suggested hosts                                | Notes                                   |
| --------- | ---------------------------------------------- | --------------------------------------- |
| Frontend  | Vercel, Netlify or Cloudflare Pages            | Build `npm run build`, output `dist`    |
| Backend   | Render, Railway or Hugging Face Spaces (Docker)| Use `backend/Dockerfile`, port 8000     |
| Database  | Neon or Supabase (free Postgres)               | Set `DATABASE_URL`                      |

### Frontend

1. Import the repository, set the root directory to `frontend`.
2. Build command `npm run build`, output directory `dist`.
3. Set `VITE_API_BASE_URL` to the backend's public URL (for example
   `https://studymate-api.onrender.com`) **before the build**: Vite bakes it in at build time.
4. Add a SPA rewrite so deep links work: Netlify `/* /index.html 200` (in `_redirects`),
   Vercel `{"rewrites":[{"source":"/(.*)","destination":"/"}]}` in `vercel.json`, Cloudflare Pages
   does this automatically when there is no `404.html`.

### Backend

Set these environment variables on the host:

| Variable | Value |
| -------- | ----- |
| `APP_ENV` | `production` (makes the admin cookie `Secure`) |
| `LLM_PROVIDER` | `gemini` (or `openai`) plus the matching API key |
| `CORS_ORIGINS` | the exact frontend origin, e.g. `https://studymate.vercel.app` |
| `DATABASE_URL` | `postgresql+psycopg://user:pass@host/db?sslmode=require` |
| `EMBEDDING_PROVIDER` | `gemini` or `openai` on small servers (see below) |
| `ADMIN_PASSWORD` | a long random password (admin area is disabled without it) |
| `LLM_MAX_CONCURRENT_REQUESTS` | `2`–`4` on small servers |

Never set `MOCK_LLM_FIXTURES_PATH`, `STUDY_RETENTION_DELAY_DEV_MINUTES`, or
`EMBEDDING_PROVIDER=hash` in production.

### Small-RAM servers

The default local embedding model needs about 1 GB RAM and a ~470 MB download, which free
instances (512 MB) cannot hold. Set `EMBEDDING_PROVIDER=gemini` (or `openai`) so embeddings come
from an API instead. Existing documents must be re-indexed after switching
(`POST /api/documents/{id}/reindex`) because vectors from different models are not comparable.
You can then drop `sentence-transformers` and `torch` from the image to shrink it a lot.

### Persistent data

Free web servers usually have an **ephemeral disk**: SQLite and the Chroma folder disappear on
every redeploy. Use Postgres through `DATABASE_URL` (Neon, Supabase) for all relational data
(documents, quizzes, study data). The vector index (`CHROMA_DIR`) still lives on disk; it is
rebuilt per document with `/reindex`, or attach a persistent disk where the host offers one
(Render disks, Railway volumes). Uploaded files themselves are not needed after ingestion.

### Admin login across two domains (important)

The admin session cookie is `SameSite=Lax`. Browsers do **not** send Lax cookies on cross-site
`fetch` requests, so if the frontend is on `*.vercel.app` and the backend on `*.onrender.com`,
`/admin` login will appear to succeed but the next request is unauthenticated. Use one of:

1. **Proxy `/api` through the frontend host** (recommended): a Netlify redirect
   `/api/*  https://your-backend/api/:splat  200`, or the equivalent Vercel rewrite. The browser
   then only talks to one origin and `VITE_API_BASE_URL` can stay empty.
2. Put both under the same registrable domain (`app.example.com` and `api.example.com`).

Study participants do not use cookies, so only the admin dashboard is affected.

### Protecting the admin area

- `/admin` only works with `ADMIN_PASSWORD`; login attempts are limited and the session cookie is
  `HttpOnly`, `SameSite=Lax` and `Secure` in production.
- Use a long random password and rotate it after the study.
- Optionally restrict `/api/admin/*` to your IP at the host or CDN (Cloudflare Access, Render
  private rules) so the login form is not exposed to the whole internet.
- Set `FEATURE_STUDY_MODE=false` on deployments that are not running the experiment.

See [SECURITY.md](SECURITY.md) for the full security review.
