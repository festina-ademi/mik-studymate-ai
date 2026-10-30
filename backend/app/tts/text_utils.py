"""Text pre-processing for speech synthesis.

Citation markers ("[Page 5]", "[Faqja 5]", "[file.py:45-60]") are visual aids for a reader: the
avatar's on-screen script keeps them, but read aloud they come out as noise like "pasted
underscore code ... pikë py dy pika shtatëmbëdhjetë". Only the text sent to a TTS engine is
cleaned; the frontend mirrors this in ``src/lib/stripCitations.ts`` for its browser-voice path.
"""

from __future__ import annotations

import re

# A bracketed source reference, with any whitespace before it:
# - named refs: [Page 5], [Faqja 5], [Slide 2], [Slajdi 2], [line 12], [lines 3-5], [Rreshti 4]
#   (the label must be a whole word, so "[linear search]" is kept)
# - file refs: [file.py:17], [file.py:17-25], [pasted_code_2026-10-13.py:17]
# - bare numeric refs: [12], [3-5]
# The bracket must not directly follow a word character, so code like "arr[0]" or
# "items[a:5]" in a tutor answer is left alone.
CITATION_RE = re.compile(
    r"\s*(?<!\w)\[\s*(?:"
    r"(?:Pages?|Faqja|Faqet|Slides?|Slajdi|Slajdet|Slajd|Lines?|Rreshti|Rreshtat)\b[^\]]*"
    r"|[A-Za-z_][\w\-.]*\s*:\s*\d+(?:\s*-\s*\d+)?[^\]]*"
    r"|\d+(?:\s*-\s*\d+)?\s*"
    r")\]",
    re.IGNORECASE,
)
_REPEATED_SPACES_RE = re.compile(r"[ \t]{2,}")
_SPACE_BEFORE_PUNCTUATION_RE = re.compile(r"\s+([.,;:!?])")


def strip_citations_for_tts(text: str) -> str:
    """Remove citation markers so a TTS engine does not read them aloud.

    Removes references like ``[Page 5]``, ``[Faqja 5]``, ``[line 17]``, ``[file.py:17-25]`` or
    ``[pasted_code_2026-10-13.py:17]`` together with the whitespace before them, then tidies the
    spacing left behind ("met [file.py:17]." becomes "met.").
    """
    cleaned = CITATION_RE.sub("", text)
    cleaned = _REPEATED_SPACES_RE.sub(" ", cleaned)
    cleaned = _SPACE_BEFORE_PUNCTUATION_RE.sub(r"\1", cleaned)
    return cleaned.strip()
