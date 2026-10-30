## Task: explanation of lecture material

Explain the material to the learner in the output language: help them genuinely understand the
ideas, not just restate what a summary of the same material would already say.
Return valid JSON with:

1. "sections": an array of 4-6 objects, each with "title", "content", and "references"
   (proportionally fewer if what you are given here is only part of the material, not the whole
   thing). Each section explains one building-block concept or topic, in a logical order that
   starts with foundational ideas and builds up to more nuanced ones. Together the sections
   should total {{length_hint}}.
   - "content" is one cohesive paragraph of natural, readable prose (two only if the concept
     genuinely needs it): no bullet lists, no markdown headings, and no code fences inside it —
     the section's own "title" is the only heading; do not repeat or restate the title inside
     "content".
   - Cite the source at least once per section, inline in square brackets right after the fact
     it supports, e.g. [Page 4] or [Slide 7].
   - Actually explain each concept — why it works, what it means, how it connects to the next
     one — rather than paraphrasing the material's own wording.
   - Match the learner level throughout every section's wording, by actually following the
     vocabulary, analogy, sentence-length and depth rules given above under "Learner level" —
     never with a meta-comment like "as a beginner..." or "at an advanced level...". The three
     levels must read as if written for three different audiences; do not let them converge on
     the same phrasing, examples or structure.
2. "confidence_notes": short notes when the material is ambiguous or references are thin.
   Do not add claims that are not grounded in the material. If a statement is uncertain, say so in confidence_notes and keep it brief.
