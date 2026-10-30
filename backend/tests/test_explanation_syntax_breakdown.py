"""Phase 13/14: the code Explanation must teach the SYNTAX -- quoted code line, then one plain
paragraph per token in the "`token` - explanation" shape, then a bold purpose summary -- never a
bare "line N: this line does X" restatement, and never a token wrapped in its own fenced block."""

from __future__ import annotations

import json
import re

import pytest

from app.db.models import Chunk, Document, SourceFormat
from app.db.session import SessionFactory
from app.domain import ContentType, Language, Level
from app.llm.mock import MockProvider
from app.services.cache import ContentCache
from app.services.summary import generate_explanation

# The exact kind of snippet the tickets' screenshots showed: several small validation functions.
JS_SNIPPET = """
function validateEmail(email) {
    const regex = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
    return regex.test(email);
}

function validatePassword(password) {
    return password.length >= 8;
}
""".strip()

# A bare "line N: it does X" restatement -- the exact anti-pattern Phase 13 reports.
_BARE_LINE_REFERENCE = re.compile(r"\bline \d+\s*:", re.IGNORECASE)
_BARE_LINJA_REFERENCE = re.compile(r"\blinja \d+\s*:", re.IGNORECASE)
_BRACKETED_LINE_COLON = re.compile(r"\[line \d+\]\s*:", re.IGNORECASE)

# One plain paragraph per token, in the Phase 14 shape: a backtick-quoted token, a hyphen, the
# explanation -- never a leading bullet marker, never an em dash.
_TOKEN_PARAGRAPH = re.compile(r"(?m)^`[^`]+`\s-\s\S")
_BOLD_PURPOSE_SUMMARY = re.compile(r"\*\*(Kjo bëhet për të|This is done to)[^*]+\.\*\*")


def _fenced_code_blocks(content: str) -> list[str]:
    return re.findall(r"```[a-zA-Z]*\n(.*?)```", content, re.DOTALL)


def _code_document(document_id: str = "syntax-doc") -> Document:
    return Document(
        id=document_id,
        filename="validators.js",
        content_hash=f"{document_id}-hash",
        content_type=ContentType.CODE,
        source_format=SourceFormat.CODE,
        detected_language=Language.EN,
        size_bytes=128,
        page_count=None,
        chunks=[
            Chunk(
                document_id=document_id,
                ordinal=1,
                text=JS_SNIPPET,
                heading="validateEmail",
                source_name="validators.js",
                line_start=1,
                line_end=8,
            )
        ],
    )


def _well_formed_section(title: str) -> dict:
    """A section shaped exactly the way Phase 14 asks for: one fenced code block per line,
    one plain hyphen-separated paragraph per token, then a bold purpose summary -- no bullet
    markers, no em dash, and no token ever wrapped in its own fenced block."""
    content = (
        "### Purpose\nChecks that an email address has the shape of a real address.\n\n"
        "### Line-by-line analysis\n"
        "```javascript\nfunction validateEmail(email) {\n```\n\n"
        "`function` - keyword that declares a named, reusable block of code.\n\n"
        "`validateEmail` - the identifier the function is called by elsewhere.\n\n"
        "`(email)` - the parameter the function expects when called.\n\n"
        "`{` - opens the function body that follows.\n\n"
        "**This is done to check whether the given text looks like a real email address.**\n\n"
        "### Edge cases\nAn empty string fails the regex and returns false.\n\n"
        "### Assessment\nThe name and single responsibility make this function easy to read."
    )
    return {"title": title, "content": content, "references": ["validateEmail:1-4"]}


@pytest.mark.anyio
async def test_explanation_quotes_code_then_one_paragraph_per_token_then_bold_summary(
    session_factory: SessionFactory,
) -> None:
    document = _code_document()
    section = _well_formed_section("validateEmail (lines 1-4)")
    map_draft = {"sections": [section], "confidence_notes": []}
    final_draft = {"sections": [section], "confidence_notes": []}
    provider = MockProvider([json.dumps(map_draft), json.dumps(final_draft)])
    cache = ContentCache(session_factory)

    result = await generate_explanation(
        document=document,
        provider=provider,
        cache=cache,
        level=Level.BEGINNER,
        language=Language.EN,
    )

    assert len(result.sections) == 1
    content = result.sections[0].content
    assert not _BARE_LINE_REFERENCE.search(content)
    assert not _BARE_LINJA_REFERENCE.search(content)
    assert not _BRACKETED_LINE_COLON.search(content)
    # Exactly one fenced block, holding the full code line -- never one per token.
    blocks = _fenced_code_blocks(content)
    assert len(blocks) == 1
    assert "function validateEmail(email)" in blocks[0]
    assert "```text" not in content
    # A plain, hyphen-separated paragraph per token (not a bullet, not an em dash).
    assert _TOKEN_PARAGRAPH.search(content)
    assert "— " not in content
    # A bold purpose sentence closes the group.
    assert _BOLD_PURPOSE_SUMMARY.search(content)


@pytest.mark.anyio
async def test_explanation_rejects_the_old_bare_line_reference_pattern_if_present() -> None:
    """Sanity check for the detector itself: the OLD, now-banned style must actually trip it,
    so a pass on the test above means the new format, not a blind spot in the regex."""
    old_style = "- Line 5 [line 5]: This line checks the password length."

    assert _BRACKETED_LINE_COLON.search(old_style)


def test_a_token_wrapped_in_its_own_fenced_block_is_detected_as_a_violation() -> None:
    """Sanity check for the detector itself: the exact Phase 14 regression (a single token
    given its own fenced code block, instead of only the full code line) must be distinguishable
    from a well-formed block, so a pass on the test above means the new format was actually
    produced, not a blind spot in this check."""
    bad_content = "```javascript\ndef\n```\n\n`def` - explanation."
    good_content = (
        "```javascript\ndef check_password_strength(password):\n```\n\n`def` - explanation."
    )

    bad_blocks = _fenced_code_blocks(bad_content)
    good_blocks = _fenced_code_blocks(good_content)
    assert bad_blocks[0].strip() == "def"
    assert good_blocks[0].strip() != "def"


@pytest.mark.anyio
async def test_explanation_differs_meaningfully_between_beginner_and_advanced(
    session_factory: SessionFactory,
) -> None:
    beginner_section = {
        "title": "validateEmail (lines 1-4)",
        "content": (
            "### Purpose\nChecks if an email looks right.\n\n"
            "### Line-by-line analysis\n```javascript\nfunction validateEmail(email) {\n```\n\n"
            "`function` - A simple word that starts a new block of reusable code you can run "
            "again later whenever you need it, like a recipe card you keep in a drawer.\n\n"
            "**This is done to let us reuse the same check wherever we need it.**\n\n"
            "### Edge cases\nAn empty email fails.\n\n"
            "### Assessment\nEasy to read."
        ),
        "references": ["validateEmail:1-4"],
    }
    advanced_section = {
        "title": "validateEmail (lines 1-4)",
        "content": (
            "### Purpose\nEnforces a structural invariant on credential-adjacent input via "
            "regex pattern matching prior to downstream persistence.\n\n"
            "### Line-by-line analysis\n```javascript\nfunction validateEmail(email) {\n```\n\n"
            "`function` - First-class, hoisted declaration.\n\n"
            "**This is done to bind a reusable check into the enclosing scope.**\n\n"
            "### Edge cases\nNon-string arguments throw a TypeError on property access; "
            "Unicode domain labels are not normalized before matching.\n\n"
            "### Assessment\nO(n) regex evaluation; no input-type guard at the boundary."
        ),
        "references": ["validateEmail:1-4"],
    }

    beginner_provider = MockProvider(
        [json.dumps({"sections": [beginner_section], "confidence_notes": []})] * 2
    )
    advanced_provider = MockProvider(
        [json.dumps({"sections": [advanced_section], "confidence_notes": []})] * 2
    )

    cache_beginner = ContentCache(session_factory)
    cache_advanced = ContentCache(session_factory)

    beginner_result = await generate_explanation(
        document=_code_document("syntax-doc-b"),
        provider=beginner_provider,
        cache=cache_beginner,
        level=Level.BEGINNER,
        language=Language.EN,
    )
    advanced_result = await generate_explanation(
        document=_code_document("syntax-doc-a"),
        provider=advanced_provider,
        cache=cache_advanced,
        level=Level.ADVANCED,
        language=Language.EN,
    )

    beginner_text = beginner_result.sections[0].content
    advanced_text = advanced_result.sections[0].content
    assert beginner_text != advanced_text
    assert "TypeError" in advanced_text
    assert "TypeError" not in beginner_text
    assert "hoisted" in advanced_text
    assert "hoisted" not in beginner_text

    def _token_paragraph_word_count(content: str) -> int:
        match = _TOKEN_PARAGRAPH.search(content)
        assert match is not None
        line_end = content.index("\n", match.start())
        return len(content[match.start() : line_end].split())

    # The same `function` token explained in far fewer words at the advanced level.
    assert _token_paragraph_word_count(advanced_text) < _token_paragraph_word_count(beginner_text)
