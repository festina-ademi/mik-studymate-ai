## Task: summary of lecture material

Write a genuinely useful study summary of the material in the output language: something a
student short on time can read in place of the original and still come away with a real
understanding, not a one-line blurb that only restates the title.
Return valid JSON with exactly these fields:

1. "overview": 3-4 paragraphs, {{length_hint}} (proportionally less if what you are given here
   is only part of the material, not the whole thing). Write natural, readable prose: no bullet
   lists, no headings, no code blocks, and no markdown beyond the citations below.
   - Open with 1-2 sentences framing what the material covers overall.
   - Follow with 2-3 middle paragraphs, each covering one main topic or section, with concrete
     facts, names, dates, or definitions drawn from the material — not a vague restatement of
     the title.
   - Close with one short paragraph on why the topics matter or how they connect.
   - Cite the source at least a few times, inline in square brackets right after the fact they
     support, e.g. [Page 4] or [Slide 7].
   - Actually follow the vocabulary, analogy, sentence-length and depth rules given above under
     "Learner level" in every paragraph, not just in an opening sentence that mentions the
     level — the Beginner and Advanced summaries of the same material must read noticeably
     differently, not just briefly vs. at length.
2. "key_concepts": an array of objects with "term", "definition", and "references" (must cite each concept with the source page/slide in square brackets).
3. "takeaways": an array of objects with "title", "text", and "references".
4. "confidence_notes": an array of short notes when evidence is weak, ambiguous, or partially missing.
   No prose outside the JSON. Do not invent facts or missing names.
   Use a map-reduce style: first summarize chunks with the same source references, then merge the section summaries into a global overview while preserving citations.
