"""Post-processing for code explanations (Explanation tab and tutor answers).

Models keep wrapping single syntax tokens in their own fenced code block, even when the prompt
forbids it (see ``tasks/explanation_code_linebyline``), which the frontend renders as one
"copy code" box per token. :func:`fix_token_format` repairs that shape deterministically, so the
fix no longer depends on the model obeying the prompt.
"""

from __future__ import annotations

import re

# Longest fenced "token" that is still treated as one token rather than a line of code.
MAX_TOKEN_CHARS = 40

# A fence holding exactly one non-blank line, immediately followed (optionally after one blank
# line) by a "- explanation" line, also tolerating a " * - " bullet prefix and en/em dashes.
_FENCED_TOKEN = re.compile(
    r"(?P<indent>^[ \t]*)```[\w+#.-]*[ \t]*\n"
    r"[ \t]*(?P<token>[^\n]+?)[ \t]*\n"
    r"[ \t]*```[ \t]*\n"
    r"(?:[ \t]*\n)?"
    r"[ \t]*(?:[*+][ \t]+)?[-–—][ \t]+",
    re.MULTILINE,
)

# A whole fenced block, opening line to closing fence.
_FENCED_BLOCK = re.compile(r"(^[ \t]*```[^\n]*\n.*?^[ \t]*```[ \t]*$)", re.MULTILINE | re.DOTALL)

# The "12: " label ``numbered_code_lines`` puts before each source line for the model.
_LINE_NUMBER_PREFIX = re.compile(r"^ *(\d+): ")

# A "`token` - explanation" line or a bold purpose summary that directly follows another line:
# Markdown would merge the two into one paragraph, so each gets a blank line before it.
_UNSEPARATED_LINE = re.compile(r"(?<=[^\n])\n(?=[ \t]*(?:`[^`\n]+`|`` [^\n]+ ``) - |[ \t]*\*\*)")

# Markers of a whole code line rather than a single token: these stay fenced.
_CODE_LINE_MARKERS = ("def ", "function ", "class ", "return ", "import ")


def _is_single_token(token: str) -> bool:
    """Whether fenced text is one token (``def``, ``(``, ``len``) rather than a code line."""
    if len(token) > MAX_TOKEN_CHARS or any(char.isspace() for char in token):
        return False
    if any(marker in token for marker in _CODE_LINE_MARKERS):
        return False
    # "else:" or "try{" is a whole (short) line; a lone ":" or "{" is a token.
    return not (len(token) > 1 and token.endswith((":", "{")))


def _inline_code(token: str) -> str:
    """``token`` as a Markdown inline code span, safe even if it contains backticks."""
    if "`" not in token:
        return f"`{token}`"
    return f"`` {token} ``"


def fix_token_format(text: str) -> str:
    """Turn per-token fenced blocks followed by ``- explanation`` into inline ``code`` lines.

    For example a fence holding only ``def`` and then ``- Keyword`` becomes
    ``"`def` - Keyword"``. Fences that hold a real line of code (several tokens, a
    ``def``/``function`` line, or a line ending in ``:``/``{``) are left untouched, as are fences
    not followed by a hyphen explanation. Each token line and bold summary is then given its own
    paragraph, so they render one per line instead of running together, and line-number labels
    copied into a quoted block are removed. Idempotent.
    """

    def replace(match: re.Match[str]) -> str:
        token = match.group("token")
        if not _is_single_token(token):
            return match.group(0)
        return f"{match.group('indent')}{_inline_code(token)} - "

    # Odd-numbered parts are fenced blocks (kept by the capturing split): quoted code is never
    # re-spaced, even a line that happens to start with "**" such as ``**kwargs``.
    parts = _FENCED_BLOCK.split(_FENCED_TOKEN.sub(replace, text))
    return "".join(
        _strip_line_number_prefixes(part) if index % 2 else _UNSEPARATED_LINE.sub("\n\n", part)
        for index, part in enumerate(parts)
    )


def _strip_line_number_prefixes(fence: str) -> str:
    """Remove the ``"12: "`` labels the model was shown (``numbered_code_lines``) from a quote.

    Only when every non-empty code line carries one and the numbers are consecutive, so real code
    that merely starts with a number (e.g. a dict with integer keys) is never altered.
    """
    opening, _, rest = fence.partition("\n")
    body, _, closing = rest.rpartition("\n")
    lines = body.split("\n")
    matches = [_LINE_NUMBER_PREFIX.match(line) for line in lines if line.strip()]
    if not matches or not all(matches):
        return fence
    numbers = [int(match.group(1)) for match in matches if match]
    if numbers != list(range(numbers[0], numbers[0] + len(numbers))):
        return fence
    stripped = [_LINE_NUMBER_PREFIX.sub("", line, count=1) for line in lines]
    return "\n".join([opening, *stripped, closing])
