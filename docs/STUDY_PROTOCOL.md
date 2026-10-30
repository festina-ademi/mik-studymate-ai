# Study Protocol: Controlled Comparison of AI-Assisted and Unassisted Learning

This document describes the controlled experiment implemented by StudyMate AI's Study Mode: its
procedure, randomization method, the data it collects and how that data is anonymized, and the
statistical analysis it produces. It is written to be usable, with light editing, as the
methodology section of the accompanying Bachelor's thesis, _"Development and Evaluation of a
Personalized AI-Based Learning Assistant for Interactive Summarization, Explanation, and
Knowledge Assessment of Educational Materials and Source Code in Computer Science."_

The implementation referenced throughout is `backend/app/study/` (data model, randomization,
scoring, statistics, export) and `backend/app/api/study.py` / `backend/app/api/admin.py`
(the participant and researcher-facing APIs).

## 1. Research questions and hypotheses

The study tests whether AI-assisted study (StudyMate AI's summaries, explanations, grounded
tutor, quizzes and adaptive re-explanation) improves comprehension and short-term retention of
technical material, compared to studying the same material unassisted.

- **H0 (null hypothesis):** there is no significant difference in comprehension or short-term
  retention between the AI-assisted (experimental) group and the unassisted (control) group.
- **H1 (alternative hypothesis):** the AI-assisted group shows significantly higher
  comprehension and retention than the control group.

Three outcomes operationalize "comprehension and retention":

1. **Immediate score** — the score on a knowledge test taken right after the study session.
2. **Retention score** — the score on the _same_ test, retaken after a delay (default 7 days).
3. **Retention change** — `retention score − immediate score`, per participant: how much a
   participant's performance changed between the two sittings.

## 2. Design

A **between-subjects, two-arm design**: each participant is randomly assigned to exactly one of
two groups and experiences only that group's condition.

| Group            | Condition                                                                                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Experimental** | Full StudyMate AI workspace on the fixed study material: original-material viewer, AI summary, AI explanation, the grounded tutor, self-testing quizzes, and adaptive re-explanation. |
| **Control**      | Only the original-material viewer (the same source document, unmodified) — no AI summary, explanation, tutor, quiz or avatar.                                                         |

Both groups study for the same fixed session length and then sit the identical test under the
identical conditions; only the _study_ condition differs, isolating the effect of the AI
assistance itself rather than of the material, the test, or the time spent.

## 3. Procedure

Every participant follows the same sequence (`frontend/src/pages` under `/study/participate`,
a direct link the researcher gives participants, not in the app's navigation; backend
endpoints under `/api/study/participants`):

1. **Language choice.** The participant picks Albanian or English; every following screen,
   the test, and (for the experimental group) the AI assistant use that language for the rest
   of the session.
2. **Informed consent.** A plain-language consent screen states the study's purpose, that
   participation is voluntary, and that the participant may withdraw at any time without
   consequence by using their code (Section 6). Continuing requires an explicit affirmative
   action; there is no pre-ticked or implied consent.
3. **Participant code.** On consenting, the system issues an anonymous, human-readable code in
   the form `P-XXXX` (e.g. `P-7K2M`; see `generate_participant_code` in
   `backend/app/study/randomization.py`) and asks the participant to save it — it is the _only_
   way to return for the retention test or to withdraw, and it is never linked to any personal
   identifier (Section 6).
4. **Group assignment.** Immediately on code creation, the participant is assigned to the
   experimental or control group by balanced block randomization (Section 4).
5. **Material assignment.** The participant receives the single study material set the admin
   has marked active (Section 5.1) — the same material for every participant, in both groups.
6. **Study session.** A server-authoritative timer starts (default 20 minutes, configurable via
   `STUDY_SESSION_MINUTES`); the experimental group has the full workspace, the control group
   has only the viewer. The client polls the server for remaining time and transitions
   automatically to the test when the timer reaches zero; the timer's start and duration are
   stored server-side (`Participant.timer_started_at/timer_duration_seconds`), so a
   participant cannot extend their session by altering the client clock.
7. **Immediate test.** The same researcher-authored test (Section 5.2) is presented one item
   per page, in the participant's study language, with no way to go back once an item is
   submitted. Answers are graded immediately (Section 7) but **no per-item correctness or the
   correct answers are shown** — only whether the sitting is complete — precisely so the
   participant cannot study the answer key before the retention sitting.
8. **Questionnaire (experimental group only).** A short post-session questionnaire: perceived
   usefulness (1–5), perceived ease of understanding (1–5), and an optional open comment. The
   control group, having used no AI feature, is not asked to rate one.
9. **Thank-you screen.** Shows the participant's code again and the date their retention test
   will unlock.
10. **Retention test (later return visit).** The participant returns to `/study/return`,
    enters their code, and — once the configured delay has elapsed since their immediate
    submission — sits the identical test again, under the identical one-item-per-page, no
    -going-back conditions. Before the delay has elapsed, the page instead shows when it will
    unlock.

## 4. Randomization

Group assignment uses **random permuted block randomization** with a default block size of 4
(`STUDY_BLOCK_SIZE`, must be a positive even number; see `assign_group` in
`backend/app/study/randomization.py`). Within each consecutive block of 4 participants, exactly
2 are assigned to each group; which 2 of the 4 slots go to which group is decided by a fair coin
toss for each new participant, constrained only to stop offering a group once its 2 slots in the
current block are filled. This gives two properties that a single global coin-flip-per-participant
scheme (simple randomization) does not:

- **Bounded imbalance at every point in recruitment**, not only at the end: with block size 4,
  the running group counts can never differ by more than 2, so a study that recruits a total of
  _N_ participants converges to as close to an even split as parity allows (e.g. exactly 20/20
  for _N_ = 40), even if it is stopped early or participants trickle in over weeks.
- **Assignment is still unpredictable**: a participant (or the admin) cannot infer the next
  assignment from the sequence so far beyond knowing which group has a free slot left in the
  current, possibly still-open block.

Assignment is computed fresh from the full, chronologically ordered history of every
participant ever created — **including withdrawn ones** — each time a new participant is
created, so it needs no persisted "current block" state and is unaffected by server restarts.
Including withdrawn participants in that history is deliberate: they already occupied a slot in
their block, and excluding them after the fact would let a later block drift out of balance.

This property is verified directly: `backend/tests/test_study_randomization.py` simulates many
(500+) participants and asserts every completed block is exactly 2/2 and the running group
counts never diverge by more than half a block.

## 5. Materials and instruments

### 5.1 Study material

A single, fixed material set (one uploaded document — lecture PDF/PPTX or a source-code bundle)
that the admin imports and marks active before recruiting participants
(`POST /api/admin/materials`, `POST /api/admin/materials/{id}/activate`). It is reused as-is by
the existing ingestion pipeline (the same one used outside Study Mode), so both groups see
exactly the same source content; only the experimental group additionally sees AI-generated
material _about_ it.

### 5.2 Knowledge test

Authored once by the researcher and imported as JSON (`POST /api/admin/tests`), never generated
by AI at test time. A test item is either:

- **Multiple-choice**, with the correct option matched exactly (case-insensitively) against the
  participant's selection; or
- **Short-answer**, scored by a keyword/key-point rubric (Section 7).

Every item's question, options (for multiple-choice) and rubric keywords (for short-answer) are
authored **in both study languages** (`{"en": ..., "sq": ...}`), so the same underlying item is
presented in whichever language the participant chose in step 1. The import is validated before
being stored (`validate_test_import` in `backend/app/study/admin_service.py`): every item must
have both language versions of its question; multiple-choice items need at least two options
per language with the correct answer among them; short-answer items need at least one rubric
keyword per language. **The same test is used for both groups and for both the immediate and
retention sittings** — the only thing that varies is _when_ and _by whom_ it is taken.

### 5.3 Questionnaire (experimental group)

Three items: perceived usefulness (5-point scale), perceived ease of understanding (5-point
scale), and one open-ended comment. This is a manipulation-check / user-experience instrument,
not part of the comprehension outcome itself.

## 6. Data collected, anonymization, and withdrawal

**No personal data is ever collected.** There is no name, email address, or account. A
participant is identified solely by their self-kept code. The backend does not log client IP
addresses for study traffic, and the standard request logger
(`backend/app/main.py::log_requests`) never records one for any request in the application.

Per participant, the system stores exactly:

| Data                                                                                             | Purpose                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anonymous code, group, study language, consent/creation timestamps                               | Identify the participant to themselves only; group bookkeeping                                                                                                                   |
| Test answers, scores and durations (immediate and retention)                                     | The outcome measures                                                                                                                                                             |
| Questionnaire responses (experimental group)                                                     | User-experience outcome                                                                                                                                                          |
| Feature-usage events — which tab was viewed, that a quiz was attempted (experimental group only) | Describes _how_ the tool was used, for interpreting the results; never free text, never a timestamp fine-grained enough to fingerprint a session beyond the study's own duration |

**Withdrawal** (`POST /api/study/participants/{code}/withdraw`) deletes every one of those
substantive rows for that participant — their test answers, scores, questionnaire response and
usage events — permanently and immediately. What remains is the anonymous shell record itself
(code, group, study language, and the fact that they withdrew): this is a deliberate design
choice, not an oversight, because deleting the row outright would (a) silently unbalance the
block randomization for every participant assigned afterwards (Section 4) and (b) understate the
study's true attrition rate when it is reported in the thesis. None of the retained fields is
personal data by any definition used in this protocol — a random code and a group label carry no
information about who the person is.

The admin can also **delete all study data** in one action (`POST /api/admin/delete-all-data`,
requiring the literal confirmation string `"DELETE"`): every participant, and everything that
cascades from them, is removed; the admin's configured material and test are deliberately left
in place so the study can be re-run without reconfiguring it.

## 7. Scoring

- **Multiple-choice:** exact, case-insensitive match against the correct option
  (`score_multiple_choice`). 1 point (or the item's configured weight) for a match, 0 otherwise.
- **Short-answer:** a deterministic keyword/key-point rubric
  (`score_short_answer_deterministic`): the score is the fraction of the item's rubric keywords
  found in the answer (a single-word keyword must appear as a whole word; a multi-word phrase
  matches as a substring), scaled to the item's weight. A response is marked "correct" at 60%
  of the rubric matched, mirroring the threshold used for the (unrelated) practice-quiz
  short-answer grading elsewhere in the app.
- **LLM-assisted scoring** for short answers exists (`score_short_answer_llm_assisted`) but is
  **off by default** (`STUDY_LLM_ASSISTED_SCORING=false`) and is never used for the study's own
  recorded scores unless the admin deliberately turns it on. The rationale: the study measures
  the effect of AI _assistance during learning_; grading the outcome test with a second,
  separately-behaving AI would introduce a source of noise and non-reproducibility into the one
  measurement the analysis depends on, so the default keeps scoring fully deterministic and
  reproducible from the stored answers alone.

Per-item correctness and the answer key are never shown back to the participant after either
sitting (Section 3, step 7), so a participant cannot use knowledge of the immediate test's
answers to inflate their retention score.

## 8. Statistical analysis plan

All statistics are computed by `backend/app/study/stats.py`, a thin, unit-tested wrapper around
`scipy.stats` — every number reported is exactly what the same scipy call would produce
directly, not a custom re-implementation. `backend/tests/test_study_stats.py` checks each
function against scipy's own output on fixed reference datasets, plus a hand-computed textbook
example for Cohen's d (which scipy does not provide).

For each of the three outcomes (immediate score, retention score, retention change) and for the
whole sample and for each study-language subgroup separately, the pipeline computes:

1. **Descriptive statistics** per group: _n_, mean, sample standard deviation, median.
2. **Normality check:** the Shapiro-Wilk test, per group (α = 0.05; needs ≥ 3 observations).
3. **Homogeneity of variance:** Levene's test between the two groups (α = 0.05).
4. **Significance test**, chosen by the normality result:
   - If **both** groups pass the Shapiro-Wilk normality check: an independent-samples
     **t-test** — **Student's** t-test if Levene's test found equal variances, otherwise
     **Welch's** t-test (which does not assume equal variance).
   - If **either** group fails the normality check (or is too small to test): the
     nonparametric **Mann-Whitney U test**, which makes no distributional assumption.
   - All three tests (Student's t, Welch's t, and Mann-Whitney U) are actually computed and
     reported regardless of which one is _recommended_, so the choice is transparent and the
     reader can compare them.
5. **Effect size:** **Cohen's d** (pooled-SD standardized mean difference,
   `(mean(experimental) − mean(control)) / pooled SD`) with a 95% confidence interval using the
   standard normal-approximation formula (Hedges & Olkin, 1985). A positive _d_ means the
   experimental group scored higher.

Degenerate inputs (fewer than 2 observations in a group, or a group with zero variance) are
handled explicitly rather than surfacing scipy's `NaN` results: affected fields are reported as
"not computable" (`null` in the API/export) instead, and the recommended test falls back
accordingly (to Welch's t-test or Mann-Whitney U, whichever remains meaningful).

Scores are normalized to a 0–1 fraction of each test's maximum possible score before comparison,
so the reported numbers stay interpretable regardless of how many points the imported test is
worth.

## 9. Data export

The admin dashboard (`/admin`, backed by `/api/admin/results`, `/api/admin/statistics`,
`/api/admin/export.csv`, `/api/admin/export.json`) exposes:

- **Results**: raw per-participant scores, for the dashboard's histogram/boxplot charts.
- **Statistics**: the full analysis from Section 8, in plain language alongside the numbers.
- **CSV export**: UTF-8 **with a byte-order mark**, one row per participant — code, group,
  language, immediate/retention score and duration, questionnaire responses, and usage counts —
  opens correctly (including Albanian diacritics) in Excel and imports cleanly into SPSS.
- **JSON export**: the same rows, for any other statistical package or a custom notebook.

Both exports include withdrawn participants (with their now-deleted fields simply empty), so
attrition is visible in the exported data, matching how it is reported in Section 6.

## 10. Ethical considerations

- Participation is voluntary and uncompensated (or compensated exactly as described to
  participants outside this software, if at all); the consent screen states this plainly.
- A participant may withdraw at any time, for any reason, with no consequence, using only their
  own code — no researcher intervention is required, and nothing about a withdrawal is used to
  penalize or identify the participant.
- No personal data is collected at any point (Section 6), so no personal data can be leaked,
  subpoenaed, or re-identified from the study's own records.
- The control group receives the same source material and the same amount of time as the
  experimental group, so no participant is denied access to the study content itself — only to
  the AI assistance being evaluated, for the duration of the single study session.
