# StudyMate AI

A bilingual (Albanian / English) AI learning assistant for Computer Science students. Students upload
lecture material or source code and get summaries, explanations, a grounded tutor and quizzes. The full
specification lives in [PROJECT_SPEC.md](PROJECT_SPEC.md).

**Status: Phase 0 (project skeleton).** The backend exposes a health endpoint and the frontend shows an app
shell with a language toggle, theme toggle and a "backend connected" indicator. No learning features exist yet.

## Requirements

| Tool    | Version                   | Check              |
| ------- | ------------------------- | ------------------ |
| Python  | 3.11 or newer (3.12 used) | `python --version` |
| Node.js | 22 LTS (20.19+ works)     | `node --version`   |
| npm     | 10 or newer               | `npm --version`    |

## Project layout

```
PROJECT_SPEC.md   README.md   CLAUDE.md   .gitignore
backend/          FastAPI app (app/), tests (tests/), .env.example, requirements.txt
frontend/         React + TypeScript + Vite app (src/)
```

## Run it

Use two terminals: one for the backend, one for the frontend. Start the backend first.

### 1. Backend (http://127.0.0.1:8000)

**Windows (PowerShell)**

```powershell
cd backend
py -3.12 -m venv .venv          # any Python 3.11+ works: py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1    # if blocked: Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
pip install -r requirements.txt
Copy-Item .env.example .env
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

If activation is blocked you can skip it and call the venv directly:
`.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload`.

**macOS / Linux**

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Check it: open <http://127.0.0.1:8000/api/health> (returns `{"status":"ok",...}`) or the interactive API
docs at <http://127.0.0.1:8000/docs>.

### 2. Frontend (http://localhost:5173)

Identical on Windows, macOS and Linux:

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>. The Vite dev server proxies `/api` to the backend, so no CORS setup is needed in
development. The footer shows **Backend connected** when both servers are running.

To point the proxy at a different backend, create `frontend/.env.local` containing
`VITE_BACKEND_URL=http://127.0.0.1:9000`.

## Configuration

All backend configuration comes from environment variables, read from `backend/.env`. Every variable is
documented in [backend/.env.example](backend/.env.example). Nothing else is required to start the app; the AI
provider keys (`GEMINI_API_KEY` / `OPENAI_API_KEY`) are only needed once AI features are added.
**Never commit `.env`.**

## Test, lint and build

Backend (from `backend/`, with the virtual environment active):

```bash
pytest
ruff check .
ruff format --check .
```

Frontend (from `frontend/`):

```bash
npm test          # Vitest
npm run lint      # ESLint + Prettier check
npm run build     # type-check + production build into dist/
npm run format    # rewrite files with Prettier
```

## Languages

The UI language (Albanian `sq` or English `en`) is chosen with the SQ | EN toggle. On the first visit it is
taken from the browser; afterwards the saved choice (`localStorage`) wins. All user-facing text lives in
`frontend/src/i18n/sq.json` and `frontend/src/i18n/en.json`; add every new string to both files.
