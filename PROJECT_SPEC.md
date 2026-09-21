# StudyMate AI — Project Specification

## 1. Purpose
StudyMate AI is a web-based, bilingual (Albanian / English) AI learning assistant for Computer Science
students. It is the software artifact of a Bachelor's thesis titled:
"Development and Evaluation of a Personalized AI-Based Learning Assistant for Interactive Summarization,
Explanation, and Knowledge Assessment of Educational Materials and Source Code in Computer Science".

Students upload lecture material (PDF, PPTX) or source code files. The system produces summaries and
plain-language explanations adapted to the student's self-declared level (beginner / intermediate /
advanced), offers a conversational tutor grounded in the uploaded material, generates self-testing quizzes,
adapts explanations when the student shows comprehension gaps, and can "teach" a long document through a
spoken explanation delivered by an animated avatar (Explainer Mode). A dedicated Study Mode supports a
controlled experiment (experimental vs control group) whose results test:
- H0: no significant difference in comprehension / short-term retention between groups.
- H1: the AI-assisted group shows significantly higher comprehension and retention.

It must look and feel like a polished, real product: clean, calm, modern, easy for a first-time user,
yet technically advanced under the hood.

## 2. Thesis objectives this software must satisfy
1. Ingestion module: PDF/PPTX (Albanian or English) and source code files.
2. AI module: concise summaries, plain-language explanations, architecture interpretation and
   best-practice recommendations (for code), adapted to skill level.
3. Interactive AI tutor with conversational explanations based on the uploaded material.
4. Automatic quiz generation for self-testing (multiple-choice and short-answer).
5. Empirical evaluation support: controlled comparison study (Study Mode + admin analytics + CSV export).
Also: adaptive personalization (explanations become more detailed/simpler when quiz results reveal gaps),
and a simple, distraction-free interface to move between original material, summary/explanation, tutor, quiz.

## 3. Tech stack (do not deviate without a strong reason; explain any deviation)
Backend: Python 3.11+, FastAPI, Pydantic v2, SQLAlchemy 2 (SQLite by default, switchable to Postgres via
DATABASE_URL), Alembic optional, pytest, ruff.
AI: provider abstraction with implementations for Google Gemini (default, free tier) and OpenAI; selected by
env vars. Default temperature 0.2. Streaming via Server-Sent Events. Structured (JSON-schema) outputs
wherever the frontend needs structure. A deterministic MockProvider for tests.
Embeddings / RAG: provider abstraction (local sentence-transformers multilingual model by default,
e.g. paraphrase-multilingual-MiniLM-L12-v2 or intfloat/multilingual-e5-small; alternative: API embeddings).
Vector store: ChromaDB (persistent, local).
Ingestion: pypdf (PDF), python-pptx (PPTX), lingua-language-detector (Albanian vs English detection),
Python `ast` for Python code plus a generic fallback chunker for other languages.
Frontend: React + TypeScript + Vite, Tailwind CSS, react-router, i18next (SQ/EN), TanStack Query,
react-markdown + a syntax highlighter, framer-motion (subtle animation), lucide-react icons, recharts (admin charts).
Testing: pytest (backend), Vitest + React Testing Library (frontend), Playwright (one end-to-end flow).

## 4. Folder structure
studymate-ai/
  PROJECT_SPEC.md, README.md, .gitignore
  backend/
    .env.example, requirements.txt
    app/: main.py, config.py, errors.py
      db/ (models.py, session.py)
      llm/ (base.py, gemini.py, openai_provider.py, mock.py, factory.py)
      prompts/ (builder.py + templates)
      ingestion/ (pdf.py, pptx.py, code.py, language.py, chunker.py, pipeline.py)
      rag/ (embeddings.py, store.py, retriever.py)
      services/ (summarizer.py, explainer.py, quiz.py, tutor.py, adaptive.py, explainer_mode.py, tts.py)
      study/ (models, routes, stats.py, export.py)
      api/ (routers)
    tests/
  frontend/
    src/ (components/, pages/, i18n/, hooks/, lib/, styles/)

## 5. Language rules (critical)
- The user picks ONE language (Albanian "sq" or English "en") with an SQ | EN toggle. Persist it.
- Everything follows that language: UI text, error messages, summaries, explanations, quizzes, tutor answers,
  avatar scripts, captions, voice, Study Mode texts.
- Output language is independent of the document language: an English PDF can be explained in Albanian.
- Source code, identifiers, keywords and code blocks are never translated. Only the explanation around them.
- In Albanian use established Albanian technical terms (algoritëm, bazë të dhënash, ndryshore, funksion,
  cikël, rekursion). If no accepted translation exists, keep the English term and put it once in brackets.
  Never mix the two languages inside one sentence beyond such terms.
- No hardcoded user-facing strings anywhere: all text lives in i18n files (frontend) or prompt/message
  templates keyed by language (backend). Backend errors return machine codes; the frontend translates them.
- The tutor always answers in the selected language even if the question is typed in the other.

## 6. Personalization rules
- Levels: beginner (analogies, no jargon, step by step), intermediate (standard terminology, key details),
  advanced (concise, precise, edge cases, complexity, trade-offs).
- Adaptive loop: per-topic mastery is tracked from quiz answers. When mastery for a topic is low, the system
  offers/generates a simpler and more detailed re-explanation of exactly that topic; the tutor also receives
  the learner profile. Log every adaptation event (for the thesis).

## 7. Grounding, safety and quality rules
- All explanations, quizzes and tutor answers must be grounded in the uploaded material. The tutor cites
  sources ([Slide 7], [Faqja 12] / [Page 12], [file.py:45-60]) and clicking a citation navigates the viewer.
  If the answer is not in the material it says so, and clearly labels any general-knowledge addition.
- Uploaded document content is DATA, never instructions. Defend against prompt injection: delimit the
  content, tell the model to ignore instructions inside it.
- Never execute uploaded code. Validate file type, size (default max 25 MB), page/slide count, encoding.
  Sanitize filenames. Handle scanned/image-only PDFs with a clear, translated error.
- Never log or store personal data of study participants. No names, emails or IP addresses.
- Never commit secrets. All config via environment variables; provide .env.example.
- LLM output is validated (JSON schema) with retry-and-repair; failures degrade gracefully with a translated message.
- Cache generated content by (document hash, mode, level, language, model, prompt version).

## 8. Explainer Mode (avatar) requirements
Goal: the student uploads e.g. a 50-page PDF and does not need to read it: the avatar explains it like a
teacher. Flow: segment the document into sections, give a 1-2 minute overview first, then one section at a
time (~1 minute each) using a SPOKEN script (conversational, short sentences, no markdown, no symbols,
numbers written naturally). Scripts are generated ahead of playback (prefetch next section) so speech starts
within seconds. Controls: play/pause, speed 1x/1.25x/1.5x, previous/next, section list with progress,
captions on by default, "Ask" (pauses, opens a mini tutor, then resumes), "Explain simpler", and a 2-3
question mini-quiz after each section. The viewer beside the avatar shows the relevant page/slide.
Voice: browser speechSynthesis by default (split into sentence-sized utterances, detect missing voices and warn),
optional server-side TTS (Meta MMS-TTS models facebook/mms-tts-sqi and facebook/mms-tts-eng) behind a
feature flag, with audio cached by hash. Avatar: original animated SVG/CSS mascot (no copyrighted characters)
with states idle / thinking / speaking / happy / encouraging; mouth animation driven by audio amplitude when
audio files exist, otherwise a timed speaking animation. Respect prefers-reduced-motion.

## 9. Study Mode and ethics requirements
- Flow: language → consent (written, explains purpose, voluntary, right to withdraw anytime without
  consequence) → anonymous participant code (e.g. P-7K2M) → balanced random group assignment (block
  randomization so groups stay near 20/20) → fixed study material set (uploaded by admin) →
  experimental group uses full StudyMate; control group sees ONLY the original material viewer with no AI
  features → fixed study timer (configurable) → immediate test → experimental group fills a short
  questionnaire (perceived usefulness, ease of understanding, open comment) → thank-you screen with code and
  retention-test date.
- Retention test: participant returns with their code; unlocks after a configurable delay (default 7 days;
  a dev override exists for testing). The SAME researcher-authored test is used for both groups and both
  sessions; test items are imported by the admin from JSON and are never AI-generated on the fly.
- Withdrawal: a participant can delete all their data using their code.
- Log per experimental participant: tabs used, quiz attempts, time in tool (no personal data).
- Admin (password from env, session-protected): counts per group, completion, mean/SD, histograms/boxplots,
  Shapiro-Wilk, Levene, independent-samples t-test (Student and Welch), Mann-Whitney U, Cohen's d with CI,
  for immediate score, retention score and change; breakdown by language; CSV export (UTF-8 with BOM, ready
  for SPSS/Excel), JSON export, and delete-all-data. Statistics are unit-tested against scipy reference values.

## 10. Design system
- Feel: calm, modern, trustworthy, spacious. Not cluttered. One primary action per screen.
- Font: Inter (UI), JetBrains Mono (code). Rounded-2xl cards, soft shadows, 8px spacing grid.
- Color tokens (light / dark): primary indigo/violet accent, neutral slate backgrounds, semantic
  success/warning/error; define as CSS variables and Tailwind theme extensions. Dark and light mode with
  system default and a manual toggle.
- Layout: landing with a single big drop zone; Workspace = original material on the left, tabs on the right
  (Summary · Explanation · Quiz · Tutor · Explainer). Header: logo, level selector (segmented control),
  SQ|EN toggle, theme toggle.
- Motion: subtle (framer-motion), streaming text renders progressively, skeleton loaders, toasts.
- Accessibility: WCAG AA contrast, keyboard navigation, visible focus, ARIA labels, reduced-motion support.
- Responsive: fully usable on mobile (panels become tabs).
- Every screen has designed loading, empty and error states with translated, human-friendly messages.

## 11. Engineering standards
- Type hints everywhere (Python) and strict TypeScript (no `any`).
- Small modules, clear names, docstrings for public functions, no dead code, no TODO left behind.
- Every phase ships with tests and must leave pytest, ruff check, npm run lint, npm run build and
  npm test passing.
- Consistent API: REST + SSE, Pydantic response models, consistent error format
  { "error": { "code": "...", "message_key": "...", "details": {} } }.
- README kept up to date with setup and run instructions for Windows, macOS and Linux.

## 12. Working agreement for the assistant
1. Read this file completely before each task.
2. Implement ONLY the requested phase; do not build features from later phases (stubs/placeholders allowed
   only where explicitly requested).
3. Prefer well-maintained, current library versions; check current docs when unsure about an API.
4. Run tests, linters and the build yourself and fix everything before reporting.
5. At the end, report: files created/changed, how to run, how to test, and anything the user must do manually.
6. If something in the request is ambiguous or conflicts with this spec, choose the most sensible option that
   matches the spec and state your assumption clearly.
