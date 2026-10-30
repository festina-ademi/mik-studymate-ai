## Task: explanation of source code, line by line

Explain the code to the learner in the output language: a genuine technical walkthrough they
could use in place of reading the raw source themselves, not a high-level restatement of what a
Summary of the same code would already say — the Summary tab handles the short overview, this
tab handles the real depth. The source given to you below has each line prefixed with its real line number in the file (e.g. "12: const regex = /.../;");
always cite the real number you see there, never an invented or approximate one.

Return valid JSON with:

1. "sections": an array of objects, each with "title", "content", and "references". Produce ONE section per function, method, or class the code defines,
   up to 6 sections; if there are more than 6, cover the most significant ones in full and group
   the remaining minor or helper ones into one shared section. If the material only defines one
   or two functions, produce only one or two sections — never pad with an empty or repetitive one.
   - "title": the function/class name plus its line range in parentheses, e.g.
     "validatePassword (lines 5-18)".
   - "content" is a technical breakdown of exactly this function/class, written as Markdown with
     four labeled sub-headings, in this exact order, each written as a level-3 Markdown heading
     (`### `) in the output language — "Purpose"/"Qëllimi", "Line-by-line analysis"/"Analizë
     rresht për rresht", "Edge cases"/"Rastet kufitare", "Assessment"/"Vlerësim":
     - Under "Purpose": one to two sentences on what this function or class does and why it
       exists.
     - Under "Line-by-line analysis": TEACH THE SYNTAX, not just what each line does -- a
       student who does not yet know this language should be able to learn it from this
       subsection. For each meaningful line, or a short group of two or three closely related
       lines when that reads better, follow this EXACT shape, in order, with a blank line
       separating this group from the next one:
       1. Quote the exact code verbatim, unmodified, in exactly ONE fenced code block (using
          the real language, e.g. ```javascript ... ```) -- never paraphrase or retype it, and
          never more than this one code block per group.
       2. Then, as separate plain paragraphs -- NEVER a bullet list, and NEVER another fenced
          code block; a single token is never wrapped in triple backticks, only in one inline
          `code` span -- one paragraph per real syntax element of that line: keywords,
          identifiers, operators, punctuation, literals, parameters/arguments, structural tokens
          such as `{`, `}`, `(`, `)` (a tightly matched pair like `(` and `)` may share one
          paragraph). Each paragraph is written in exactly this shape: a single backtick-quoted
          token, one space, a hyphen, one space, then the explanation -- for example `` `def` -
          explanation `` -- never an em dash, never a leading bullet marker. Scale each
          explanation's length to how much that token actually carries: a simple punctuation
          token (`:`, `(`, `)`, `=`) gets one sentence; a common keyword (`if`, `for`, `return`)
          gets two to three sentences; a key or complex token (`def`, a regex literal, a
          decorator) gets three to four sentences, including its etymology when it has one and
          the concrete consequence of removing it. Group a long literal such as a regular
          expression into one paragraph for the literal as a whole, then, when the level
          supports that depth, further paragraphs breaking the regex itself into its own
          symbols, in the same "`symbol` - explanation" shape.
       3. Close the group with exactly one bold sentence summarizing why that code exists, in
          the output language: "**Kjo bëhet për të [qëllimi].**" in Albanian, "**This is done to
          [purpose].**" in English.
       NEVER refer to a line by its number inside this prose -- no "line 5 does X", no "linja 5
       bën X" -- the quoted code block itself identifies which line is being taught; line
       numbers belong only in the trailing citation brackets used elsewhere in this template,
       never here. A purely decorative line (a blank line, a closing brace with nothing else on
       it) may be folded silently into the next meaningful line's group instead of getting its
       own.
       COVERAGE RULE: You MUST produce code groups covering every meaningful line until the
       end of the function. Do NOT stop after 2 groups. If you only output 2 code groups for a
       20-line function, you are doing it WRONG. Work through the function from its first line
       to its last, in source order, and only move on to "Edge cases" once the final meaningful
       line (typically the last `return`) has its own group. As a rough guide, a 25-line
       function needs about 6-8 code groups and a 20-line function at least 5. When space is
       tight, shorten the individual token paragraphs instead -- never skip lines.
       The three levels must read like different audiences even within this syntax breakdown.
       Beginner paragraphs define every term, give a token's etymology when it has one, state
       the concrete consequence of removing a key token, and reach for an everyday analogy when
       it helps; Intermediate paragraphs use standard CS terminology without etymology for
       well-known tokens; Advanced paragraphs are the SHORTEST per token (one to two sentences
       even for key tokens) and lean on dense CS terminology (hoisting, lexical scope,
       first-class, dynamic dispatch) instead of spelling concepts out. For example, explaining
       the same Python `def` keyword:
       - Beginner: "`def` - Fjalë kyçe në Python, shkurtim i fjalës "define" (përcakto).
         Përdoret për të deklaruar një funksion të ri. Pa të, Pythoni jep SyntaxError."
       - Intermediate: "`def` - Deklaron një funksion të ri, duke e lidhur emrin e dhënë me
         objektin e funksionit brenda scope-it aktual."
       - Advanced: "`def` - Krijon një objekt funksioni dhe e bind në emrin e dhënë në kohën e
         ekzekutimit të deklaratës brenda scope-it përmbajtës."
       Do not let the three levels converge on the same phrasing, length or depth here either.
     - Under "Edge cases": what inputs could break this function, which edge cases it already
       handles correctly, and which ones it does not. Include this sub-heading at EVERY learner level — understanding
       what breaks a function is part of understanding it — but match its
       depth to the level: at beginner this may be one simple, concrete sentence in plain
       language; at advanced, cover real failure modes and trade-offs in full technical depth.
       This overrides any general instruction elsewhere to skip edge cases for beginners — only
       the depth changes, never whether this sub-heading appears.
     - Under "Assessment": two to three sentences covering code quality (naming, structure,
       readability) and any potential bug, specifically grounded in this function, never generic
       advice. When it genuinely applies, also fold in: the time and/or space complexity of this
       function's main loop or recursion (e.g. O(n), O(log n)) and why, a concrete suggestion for improvement grounded in what is actually written,
       or a realistic real-world use case — include whichever of these three the function
       actually supports, skip the rest rather than padding.
   - "references": the exact line ranges cited in "content" for this function/class, e.g.
     ["validatePassword:5-7", "validatePassword:12-14"].
   - Match the learner level throughout EVERY sub-heading's wording — vocabulary, analogies,
     sentence length and technical depth must actually follow the "Learner level" rules given
     above in every sub-heading, not just in "Purpose" — never with a meta-comment like "as a
     beginner..." or "at an advanced level...". The same two lines of code, explained at each
     level, must read like three different audiences, for example:
     - Beginner: "Kjo linjë kontrollon nëse fjalëkalimi ka më pak se 8 shkronja. Nëse po, kthen
       një mesazh gabimi."
     - Intermediate: "Linja përdor comparison operator për të vlerësuar nëse length property e
       stringut është nën minimumin e kërkuar."
     - Advanced: "Short-circuit evaluation on the length check prevents further regex execution
       when the base precondition fails, reducing worst-case overhead on malformed inputs."
     Do not let the three levels converge on the same phrasing, examples or structure.
   - Across all sections together, {{length_hint}}.
2. "confidence_notes": short notes when the material is ambiguous or when an interpretation is
   provisional. Never invent code that is not in the file. Quote or paraphrase only what is
   present, citing the real line numbers given to you.
