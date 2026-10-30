## Task: generate a quiz from lecture material

Create a grounded self-test quiz for the learner in the output language, matching their declared level.
Return valid JSON with exactly these fields:

1. "questions": an array of question objects.
2. "weak_topics": a short list of topics from the material the learner is likely to need to revisit, based on which ideas are hardest.

Generate EXACTLY {{num_questions}} questions in total — not more, not fewer — using {{type_mix}}.

Each question object has:
- "kind": "multiple_choice" or "short_answer".
- "topic": a short topic tag (2-4 words) grouping related questions.
- "difficulty": "easy", "medium", or "hard", matching the learner's level ({{level}}).
- "question": the question text, grounded only in the uploaded material.
- "options": for multiple_choice, exactly 4 plausible options; leave empty for short_answer.
- "correct_option_indices": for multiple_choice, a list containing exactly one 0-based index (into "options") of the single correct option; leave empty for short_answer.
- "correct_answer": for multiple_choice, the exact text of the correct option; for short_answer, a concise model answer.
- "explanation": a brief explanation of why the correct answer is correct.
- "source_reference": one location marker such as [Page 12] or [Slide 7] taken from the material, that the learner could check to verify the answer.
- "rubric": for short_answer only, one or two sentences describing what a correct answer must contain.
- "key_points": for short_answer only, a short list of key points a correct answer should mention.

Rules:
- Every multiple_choice question has EXACTLY ONE correct option. Never design a question where more than one option could be considered correct.
- Every question must be answerable using only the cited passage; do not invent facts, numbers, names or locations.
- For multiple_choice, write 4 options total: the one correct option and three plausible, mutually exclusive distractors, drawn from the same topic area, similar in length and style to the correct option. Never mark all 4 options correct — at least one real distractor must remain.
- Keep explanations brief and focused on why the answer is correct, referencing the material.
- In each explanation, quote the key term or phrase from the material that the answer relies on.
- When the type mix asks for both kinds, both are REQUIRED: write every requested short-answer question, never replace one with an extra multiple-choice question. A short-answer question about a concept a multiple-choice question also touches is not a repeat: it tests the idea in a different way.
- Prefer concrete concepts, definitions and process steps from the uploaded material.
- Avoid duplicate or near-duplicate questions; cover distinct ideas and, where possible, distinct sections.
- Generate DIVERSE questions. Each question must cover a DIFFERENT concept or aspect of the material. Avoid asking two questions about the same specific sentence, variable, or fact.
- Once the main topics are covered, write questions that test deeper reasoning (why, how, compare, what happens if) rather than only recall.
- If the material is short, generate fewer questions rather than repeating ideas.

{{avoid_questions}}
