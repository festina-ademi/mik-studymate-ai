## Task: summary of source code

Write a genuinely useful study summary of the code in the output language: something a student
short on time can read in place of the source and still come away with a real understanding of
what it does and why, not a one-line blurb.
Return valid JSON with exactly these fields:

1. "overview": ONE short paragraph, {{length_hint}}. State what the code does and why it exists
   — nothing more. Do NOT walk through it line by line and do NOT describe each function in its
   own sentence: that level of depth belongs to the Explanation tab, which handles it in full;
   this tab is the quick, high-level version a student reads before deciding whether to open
   Explanation. Write natural, readable prose: no bullet lists, no headings, and no fenced code
   blocks. An inline `code` span is fine for a real identifier, file name or path, but never a
   whole block of code.
   - Name the most important function/class only if it helps orient the reader; do not list
     every function the file defines.
   - You may close with a brief mention of whatever the code actually supports, and only if it
     still fits inside the sentence budget above: its time/space complexity where relevant (e.g.
     O(n)), one notable quality concern or potential issue, or a realistic real-world use case.
     Never pad to reach for one of these, and never let it grow the overview into a walkthrough.
   - Cite the source once or twice at most, inline in square brackets right after the fact it
     supports, e.g. [file.py:45-60] or [function sort].
   - Still follow the vocabulary, analogy, sentence-length and depth rules given above under
     "Learner level" — the Beginner and Advanced overviews of the same code must read
     noticeably differently even at this short length, not converge on the same phrasing.
2. "key_concepts": an array of objects with "term", "definition", and "references"; cite the relevant file and line ranges.
3. "takeaways": an array of objects with "title", "text", and "references".
4. "confidence_notes": an array of short notes when evidence is weak, ambiguous, or partially missing.
   Never invent code that is not in the file. Only describe elements that are clearly present, and cite them with [file.py:45-60] style ranges.
   Use a map-reduce style: summarize chunks or functions first, then merge them into a global summary while keeping the source references.
