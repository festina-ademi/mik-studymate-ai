## Task: generate a quiz from source code

Create a grounded self-test quiz for the learner in the output language, matching their declared level.
Return valid JSON with exactly these fields:

1. "questions": an array of question objects.
2. "weak_topics": a short list of topics from the code the learner is likely to need to revisit, based on which parts are trickiest.

Generate EXACTLY {{num_questions}} questions in total — not more, not fewer — using {{type_mix}}.

Each question object has:
- "kind": "multiple_choice" or "short_answer".
- "topic": a short topic tag (2-4 words) grouping related questions.
- "difficulty": "easy", "medium", or "hard", matching the learner's level ({{level}}).
- "question": the question text, grounded only in the uploaded code.
- "options": for multiple_choice, exactly 4 plausible options; leave empty for short_answer.
- "correct_option_indices": for multiple_choice, a list containing exactly one 0-based index (into "options") of the single correct option; leave empty for short_answer.
- "correct_answer": for multiple_choice, the exact text of the correct option; for short_answer, a concise model answer.
- "explanation": a brief explanation of why the correct answer is correct.
- "source_reference": one location marker such as [src/app.py:45-60] taken from the code, that the learner could check to verify the answer.
- "rubric": for short_answer only, one or two sentences describing what a correct answer must contain.
- "key_points": for short_answer only, a short list of key points a correct answer should mention.

Rules:
- Every multiple_choice question has EXACTLY ONE correct option. Never design a question where more than one option could be considered correct.
- When the correct answer (or a distractor) is a literal value taken from the source code -- a string, number, variable name, or keyword -- present it VERBATIM exactly as it appears in the code. Never translate a code literal into the output language; source code is never translated (see the grounding rules above).
- If the options are code literals (so they will not visibly match the output language of the question), say so plainly inside the question text itself, in the output language, so the mismatch never reads as a mistake. For example, in Albanian: "Cila nga këto vlera (string literal nga kodi) kthehet nga funksioni X?" or append a short parenthetical note such as "(Opsionet më poshtë janë string literals nga kodi, në gjuhën origjinale.)"; in English: "Which of these literal values (taken directly from the code) does function X return?"
- Alternatively, when the meaning matters more than the exact string, you may phrase the option naturally in the output language with the literal kept in parentheses for verification, e.g. Albanian "Mesazhi për fjalëkalim të shkurtër ('Password must be at least 8 characters')". The option is still graded against the literal text, so always include it somewhere in the option.
- You never run the code, and neither does the learner: every question must be answerable by reading the cited lines, never by executing unknown code.
- Prefer question styles such as: what a function returns for a specific input, finding a bug or edge case the code does not handle, identifying the time or space complexity of a loop or algorithm, explaining what a block of code does, spotting the correct fix for a described problem, recognizing a naming or readability issue, or picking the most realistic real-world use case for this code.
- For multiple_choice, write 4 options total: the one correct option and three plausible, mutually exclusive distractors (for example a common off-by-one mistake, a wrong complexity class, or a plausible but incorrect return value). Never mark all 4 options correct — at least one real distractor must remain.
- Keep explanations brief and focused on why the answer is correct, referencing the code.
- In each explanation, quote the exact identifiers, expressions or literal values from the code that the answer relies on (for example `len(password) < 8`).
- When the type mix asks for both kinds, both are REQUIRED: write every requested short-answer question, never replace one with an extra multiple-choice question. A short-answer question about a concept a multiple-choice question also touches is not a repeat: it tests the idea in a different way.
- Do not invent code that is not present; only ask about elements clearly visible in the cited lines.
- Avoid duplicate or near-duplicate questions; cover distinct functions or concepts.
- Generate DIVERSE questions. Each question must cover a DIFFERENT concept or aspect of the material. Avoid asking two questions about the same specific sentence, variable, or fact.
- Once the main topics are covered, write questions that test deeper reasoning (why, how, compare, what happens if) rather than only recall.
- If the material is short, generate fewer questions rather than repeating ideas.

{{avoid_questions}}
