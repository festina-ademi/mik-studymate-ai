## Task: explanation of source code, block by block

Explain the code to the learner in the output language at the level of logical BLOCKS, not
individual lines or tokens: the learner wants to see how the pieces fit together, and this mode
must work for code of any length. The source given to you below has each line prefixed with its
real line number in the file (e.g. "12: const regex = /.../;"); always cite the real number you
see there, never an invented or approximate one.

Return valid JSON with:

1. "sections": an array of objects, each with "title", "content", and "references". Produce ONE
   section per function, method, or class the code defines, up to 6 sections; if there are more
   than 6, cover the most significant ones in full and group the remaining minor or helper ones
   into one shared section. Top-level code outside any function (for example a main loop or a
   script body) gets a section of its own. Never pad with an empty or repetitive section.
   - "title": the function/class name plus its line range in parentheses, e.g.
     "validatePassword (lines 5-18)".
   - "content" is Markdown. Split the function into its logical blocks — for example the
     setup/validation at the start, each loop, each branch of the main control flow, and the
     final result — aiming for 3-8 blocks per function regardless of how many lines it has
     (fewer only when the function is genuinely tiny). Every meaningful line belongs to exactly
     one block, in source order, so the blocks together cover the whole function. For each
     block, in this EXACT shape, with a blank line between one block and the next:
     1. The FULL block, quoted verbatim and unmodified, in exactly ONE fenced code block using
        the real language (e.g. ```python ... ```), WITHOUT the "12: " line-number labels that
        only mark lines for you. Never split a block into one fence per line, and never fence a
        single token.
     2. Then ONE short paragraph of two to four sentences saying what this block accomplishes
        and why it is there, in plain prose. Do NOT break the block down token by token: no
        per-token lines, no "`token` - explanation" lists, no bullet lists. An identifier may
        appear as inline `code` inside the sentence when the paragraph names it.
     Do not add "Purpose", "Edge cases" or "Assessment" sub-headings in this mode, and NEVER
     refer to a line by its number inside the prose -- the quoted block identifies it. A
     citation in the prose uses the same form as "references", e.g. [validatePassword:8-14],
     never an invented file name.
   - "references": the exact line ranges of the blocks in "content", e.g.
     ["validatePassword:5-7", "validatePassword:8-14"].
   - Match the learner level in every paragraph — vocabulary, analogies, sentence length and
     technical depth follow the "Learner level" rules given above, without a meta-comment like
     "as a beginner...". A beginner paragraph describes the block's job in everyday words, an
     intermediate one uses standard CS terminology, and an advanced one is dense and precise
     (complexity, invariants, trade-offs) rather than longer.
   - Length: {{length_hint}}.
2. "confidence_notes": short notes when the material is ambiguous or when an interpretation is
   provisional. Never invent code that is not in the file. Quote or paraphrase only what is
   present, citing the real line numbers given to you.
