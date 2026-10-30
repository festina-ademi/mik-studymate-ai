"""Phase 15: line-by-line vs blocks code explanations, and the per-token fence repair.

The prompt tests pin the instructions each depth gives the model; the service tests check the
plumbing a real provider relies on (template choice, cache separation, output budget, no lossy
"reduce" pass, and the deterministic :func:`fix_token_format` repair of the model's output).
How many code groups a real model then writes is a property of that model, verified in the
browser against a real provider (see the Phase 15 report), not something a mock can show.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.config import Settings
from app.db.models import Chunk, Document, SourceFormat
from app.db.session import SessionFactory
from app.domain import ContentType, ExplanationDepth, Language, Level, Task
from app.llm.base import DEFAULT_MAX_TOKENS
from app.llm.mock import MockProvider
from app.main import create_app
from app.prompts import PromptBuilder
from app.rag.embeddings import HashingEmbeddingProvider
from app.rag.indexer import index_document
from app.rag.store import ChromaVectorStore
from app.services.cache import ContentCache
from app.services.explanation import fix_token_format
from app.services.summary import LINE_BY_LINE_MAX_TOKENS, generate_explanation
from app.services.tutor import generate_tutor_answer

# The 24-line snippet from the Phase 15 browser verification.
PASSWORD_SNIPPET = '''
import re


def check_password_strength(password):
    """Return a strength label and the problems found in a password."""
    problems = []
    if len(password) < 8:
        problems.append("too short")
    if not re.search(r"[A-Z]", password):
        problems.append("no uppercase letter")
    if not re.search(r"[a-z]", password):
        problems.append("no lowercase letter")
    if not re.search(r"[0-9]", password):
        problems.append("no digit")
    if not re.search(r"[^A-Za-z0-9]", password):
        problems.append("no symbol")
    score = 5 - len(problems)
    if score >= 5:
        label = "strong"
    elif score >= 3:
        label = "medium"
    else:
        label = "weak"
    return label, problems
'''.strip()

_FENCE = re.compile(r"```[\w+#.-]*\n(.*?)```", re.DOTALL)


def _fences(text: str) -> list[str]:
    return [body.strip() for body in _FENCE.findall(text)]


def _system(depth: ExplanationDepth, level: Level = Level.INTERMEDIATE) -> str:
    return (
        PromptBuilder()
        .build(
            task=Task.EXPLANATION,
            content_type=ContentType.CODE,
            level=level,
            language=Language.SQ,
            document_text="1: x = 1",
            delimiter_id="fixed",
            depth=depth,
        )
        .system
    )


def _document(
    *, document_id: str, content_type: ContentType = ContentType.CODE, chunk_count: int = 1
) -> Document:
    is_code = content_type == ContentType.CODE
    return Document(
        id=document_id,
        filename="password.py" if is_code else "lecture.pdf",
        content_hash=f"{document_id}-hash",
        content_type=content_type,
        source_format=SourceFormat.CODE if is_code else SourceFormat.PDF,
        detected_language=Language.EN,
        size_bytes=len(PASSWORD_SNIPPET),
        page_count=None if is_code else chunk_count,
        chunks=[
            Chunk(
                document_id=document_id,
                ordinal=ordinal,
                text=PASSWORD_SNIPPET if is_code else "Binary search halves the range.",
                heading="check_password_strength" if is_code else f"Page {ordinal}",
                source_name="password.py" if is_code else None,
                line_start=1 if is_code else None,
                line_end=24 if is_code else None,
                page_start=None if is_code else ordinal,
                page_end=None if is_code else ordinal,
            )
            for ordinal in range(1, chunk_count + 1)
        ],
    )


def _draft(content: str) -> str:
    section = {"title": "check_password_strength (lines 4-24)", "content": content}
    return json.dumps({"sections": [section], "confidence_notes": []})


# --- fix_token_format ----------------------------------------------------------------------


def test_validator_turns_three_fenced_tokens_into_inline_code_lines() -> None:
    broken = (
        "```python\ndef check_password_strength(password):\n```\n\n"
        "```text\n  def\n```\n  - Fjalë kyçe që deklaron një funksion.\n\n"
        "```text\ncheck_password_strength\n```\n- Emri i funksionit.\n\n"
        "```python\n(\n```\n * - Hap listën e parametrave.\n\n"
        "**Kjo bëhet për të deklaruar funksionin.**"
    )

    fixed = fix_token_format(broken)

    assert "`def` - Fjalë kyçe që deklaron një funksion." in fixed
    assert "`check_password_strength` - Emri i funksionit." in fixed
    assert "`(` - Hap listën e parametrave." in fixed
    # Only the full code line keeps its fence (and its "Kopjo kodin" button).
    assert _fences(fixed) == ["def check_password_strength(password):"]
    assert "**Kjo bëhet për të deklaruar funksionin.**" in fixed


@pytest.mark.parametrize(
    "line",
    [
        "def check_password_strength(password):",
        "function validate(input) {",
        "else:",
        "try{",
        "return label, problems",
        "score = 5 - len(problems)",
    ],
)
def test_validator_keeps_full_code_lines_fenced(line: str) -> None:
    text = f"```python\n{line}\n```\n- Explanation of the whole line."

    assert fix_token_format(text) == text


def test_validator_converts_lone_structural_tokens() -> None:
    for token in (":", "{", "==", "len", "re.search"):
        fixed = fix_token_format(f"```text\n{token}\n```\n- explanation")
        assert fixed == f"`{token}` - explanation"


def test_validator_leaves_fences_without_a_hyphen_explanation_alone() -> None:
    text = "```python\nlen\n```\n\nSome prose that is not a token explanation."

    assert fix_token_format(text) == text


def test_validator_is_idempotent_on_well_formed_output() -> None:
    good = "```python\nproblems = []\n```\n\n`problems` - a list.\n\n`=` - assignment."

    assert fix_token_format(good) == good
    assert fix_token_format(fix_token_format(good)) == good


def test_validator_puts_each_token_line_and_summary_in_its_own_paragraph() -> None:
    """Seen live: token lines separated by single newlines rendered as one run-on paragraph."""
    merged = (
        "```python\ndef f(x):\n```\n\n"
        "`def` - Deklaron funksionin.\n`f` - Emri.\n`(` - Hap kllapat.\n"
        "**Kjo bëhet për të deklaruar funksionin.**"
    )

    fixed = fix_token_format(merged)

    assert fixed == (
        "```python\ndef f(x):\n```\n\n"
        "`def` - Deklaron funksionin.\n\n`f` - Emri.\n\n`(` - Hap kllapat.\n\n"
        "**Kjo bëhet për të deklaruar funksionin.**"
    )
    assert fix_token_format(fixed) == fixed


def test_validator_never_respaces_lines_inside_a_fenced_block() -> None:
    quoted = "```python\ndef f(\n    *args,\n**kwargs):\n```\n\n`f` - Emri."

    assert fix_token_format(quoted) == quoted


def test_validator_strips_line_number_labels_copied_into_a_quoted_block() -> None:
    """Seen live in blocks mode: the model quoted the "4: " labels it was shown."""
    copied = "```python\n4: def f(x):\n5:     problems = []\n\n6:     return problems\n```\nText."

    assert fix_token_format(copied) == (
        "```python\ndef f(x):\n    problems = []\n\n    return problems\n```\nText."
    )


def test_validator_keeps_real_code_that_starts_with_numbers() -> None:
    dict_body = '```python\n1: "one",\n2: "two",\n7: "seven",\n```'

    assert fix_token_format(dict_body) == dict_body


def test_validator_escapes_a_token_that_contains_a_backtick() -> None:
    assert fix_token_format("```text\na`b\n```\n- odd token") == "`` a`b `` - odd token"


# --- prompt templates ----------------------------------------------------------------------


def test_depth_selects_the_matching_code_template() -> None:
    line_by_line = _system(ExplanationDepth.LINE_BY_LINE)
    blocks = _system(ExplanationDepth.BLOCKS)

    assert "## Task: explanation of source code, line by line" in line_by_line
    assert "## Task: explanation of source code, block by block" in blocks
    assert "block by block" not in line_by_line
    assert "line by line" not in blocks


def test_line_by_line_template_requires_covering_every_meaningful_line() -> None:
    system = _system(ExplanationDepth.LINE_BY_LINE)

    assert "You MUST produce code groups covering every meaningful line until the" in system
    assert "Do NOT stop after 2 groups" in system
    assert "20-line function, you are doing it WRONG" in system
    assert "a 20-line function at least 5" in system
    assert "never skip lines" in system


def test_blocks_template_targets_fewer_groups_than_line_by_line() -> None:
    """Blocks caps a function at 3-8 groups whatever its length, while line-by-line asks for
    one group per meaningful line (or two-three closely related lines) -- so for the same
    24-line function, blocks asks for at most 8 groups and line-by-line for well over 5."""
    blocks = _system(ExplanationDepth.BLOCKS)
    line_by_line = _system(ExplanationDepth.LINE_BY_LINE)

    assert "aiming for 3-8 blocks per function regardless of how many lines it has" in blocks
    assert "For each meaningful line, or a short group of two or three closely" in line_by_line
    assert "a 25-line\n       function needs about 6-8 code groups" in line_by_line


def test_blocks_template_has_no_per_token_breakdown() -> None:
    system = _system(ExplanationDepth.BLOCKS)

    assert "The FULL block, quoted verbatim" in system
    assert "ONE short paragraph of two to four sentences" in system
    assert "Do NOT break the block down token by token" in system
    assert 'no "`token` - explanation" lists' in system
    # None of the line-by-line token machinery leaks into blocks mode.
    assert "one paragraph per real syntax element" not in system
    assert "Kjo bëhet për të [qëllimi]" not in system


def test_blocks_length_target_is_per_block_and_grows_with_level() -> None:
    assert "roughly 40-60 words per block summary" in _system(
        ExplanationDepth.BLOCKS, Level.BEGINNER
    )
    assert "roughly 50-70 words per block summary" in _system(
        ExplanationDepth.BLOCKS, Level.INTERMEDIATE
    )
    assert "roughly 60-80 words per block summary" in _system(
        ExplanationDepth.BLOCKS, Level.ADVANCED
    )


def test_lecture_explanation_ignores_depth() -> None:
    def lecture(depth: ExplanationDepth) -> str:
        return (
            PromptBuilder()
            .build(
                task=Task.EXPLANATION,
                content_type=ContentType.LECTURE,
                level=Level.INTERMEDIATE,
                language=Language.EN,
                document_text="[Page 1]\nx",
                delimiter_id="fixed",
                depth=depth,
            )
            .system
        )

    assert lecture(ExplanationDepth.BLOCKS) == lecture(ExplanationDepth.LINE_BY_LINE)


# --- explanation service -------------------------------------------------------------------


@pytest.mark.anyio
async def test_line_by_line_sends_the_whole_function_in_one_call_with_a_larger_budget(
    session_factory: SessionFactory,
) -> None:
    provider = MockProvider([_draft("### Qëllimi\nKontrollon fjalëkalimin.")])

    await generate_explanation(
        document=_document(document_id="lbl"),
        provider=provider,
        cache=ContentCache(session_factory),
        level=Level.BEGINNER,
        language=Language.SQ,
        depth=ExplanationDepth.LINE_BY_LINE,
    )

    # One call, no lossy "reduce" pass over the already-written explanation.
    assert len(provider.calls) == 1
    request = provider.calls[0]
    assert "line by line" in (request.system or "")
    assert request.max_tokens == LINE_BY_LINE_MAX_TOKENS
    # Every line of the 24-line function reaches the model, numbered, in that single request.
    for number, line in enumerate(PASSWORD_SNIPPET.splitlines(), start=1):
        if line.strip():
            assert f"{number}: {line}" in request.prompt


@pytest.mark.anyio
async def test_blocks_uses_its_own_template_and_the_default_budget(
    session_factory: SessionFactory,
) -> None:
    provider = MockProvider([_draft("```python\nproblems = []\n```\n\nCollects problems.")])

    result = await generate_explanation(
        document=_document(document_id="blk"),
        provider=provider,
        cache=ContentCache(session_factory),
        level=Level.BEGINNER,
        language=Language.SQ,
        depth=ExplanationDepth.BLOCKS,
    )

    assert len(provider.calls) == 1
    assert "block by block" in (provider.calls[0].system or "")
    assert provider.calls[0].max_tokens == DEFAULT_MAX_TOKENS
    assert result.metadata.depth == "blocks"


@pytest.mark.anyio
async def test_code_explanation_keeps_every_chunk_groups_sections_without_reducing(
    session_factory: SessionFactory,
) -> None:
    # Five chunks -> two map groups (four chunks per group); each group's sections survive.
    provider = MockProvider([_draft("first group"), _draft("second group")])

    result = await generate_explanation(
        document=_document(document_id="multi", chunk_count=5),
        provider=provider,
        cache=ContentCache(session_factory),
        level=Level.INTERMEDIATE,
        language=Language.EN,
    )

    assert len(provider.calls) == 2
    assert [section.content for section in result.sections] == ["first group", "second group"]


@pytest.mark.anyio
async def test_depths_are_cached_separately_for_code(session_factory: SessionFactory) -> None:
    provider = MockProvider([_draft("line by line answer"), _draft("blocks answer")])
    cache = ContentCache(session_factory)
    document = _document(document_id="cache")

    async def explain(depth: ExplanationDepth) -> str:
        result = await generate_explanation(
            document=document,
            provider=provider,
            cache=cache,
            level=Level.INTERMEDIATE,
            language=Language.EN,
            depth=depth,
        )
        return result.sections[0].content

    assert await explain(ExplanationDepth.LINE_BY_LINE) == "line by line answer"
    assert await explain(ExplanationDepth.BLOCKS) == "blocks answer"
    # Both are now cached: switching back and forth makes no further model calls.
    assert await explain(ExplanationDepth.LINE_BY_LINE) == "line by line answer"
    assert await explain(ExplanationDepth.BLOCKS) == "blocks answer"
    assert len(provider.calls) == 2


@pytest.mark.anyio
async def test_lecture_explanation_shares_one_cache_entry_across_depths(
    session_factory: SessionFactory,
) -> None:
    lecture_draft = json.dumps(
        {"sections": [{"title": "Search", "content": "```\nx\n```\n- y"}], "confidence_notes": []}
    )
    provider = MockProvider([lecture_draft, lecture_draft])
    cache = ContentCache(session_factory)
    document = _document(document_id="lecture", content_type=ContentType.LECTURE)

    first = await generate_explanation(
        document=document,
        provider=provider,
        cache=cache,
        level=Level.INTERMEDIATE,
        language=Language.EN,
        depth=ExplanationDepth.LINE_BY_LINE,
    )
    second = await generate_explanation(
        document=document,
        provider=provider,
        cache=cache,
        level=Level.INTERMEDIATE,
        language=Language.EN,
        depth=ExplanationDepth.BLOCKS,
    )

    assert second.metadata.cached
    assert first.metadata.depth is None
    # Lecture content is never run through the code-token repair.
    assert second.sections[0].content == "```\nx\n```\n- y"


@pytest.mark.anyio
async def test_explanation_output_is_repaired_before_reaching_the_frontend(
    session_factory: SessionFactory,
) -> None:
    broken = (
        "```python\nproblems = []\n```\n\n"
        "```text\nproblems\n```\n- Emri i listës.\n\n"
        "```text\n=\n```\n- Operatori i caktimit.\n\n"
        "**Kjo bëhet për të mbledhur problemet.**"
    )
    provider = MockProvider([_draft(broken)])

    result = await generate_explanation(
        document=_document(document_id="repair"),
        provider=provider,
        cache=ContentCache(session_factory),
        level=Level.BEGINNER,
        language=Language.SQ,
    )

    content = result.sections[0].content
    assert _fences(content) == ["problems = []"]
    assert "`problems` - Emri i listës." in content
    assert "`=` - Operatori i caktimit." in content


def test_explanation_endpoint_accepts_depth_and_rejects_unknown_values() -> None:
    # "hash" embeddings keep the upload's indexing step off the real (downloaded) model.
    settings = Settings(
        _env_file=None, database_url="sqlite://", llm_provider="mock", embedding_provider="hash"
    )
    client = TestClient(create_app(settings))
    upload = client.post(
        "/api/documents",
        files={"files": ("password.py", PASSWORD_SNIPPET.encode(), "text/x-python")},
    )
    assert upload.status_code == 201, upload.text
    document_id = upload.json()["document"]["id"]

    ok = client.post(
        f"/api/documents/{document_id}/explanation",
        json={"level": "beginner", "language": "sq", "depth": "blocks"},
    )
    bad = client.post(
        f"/api/documents/{document_id}/explanation",
        json={"level": "beginner", "language": "sq", "depth": "sideways"},
    )

    assert ok.status_code == 200, ok.text
    assert ok.json()["metadata"]["depth"] == "blocks"
    assert bad.status_code == 422


# --- tutor ---------------------------------------------------------------------------------


@pytest.mark.anyio
async def test_tutor_answer_about_code_is_repaired(
    session_factory: SessionFactory, tmp_path: Path
) -> None:
    store = ChromaVectorStore(tmp_path / "chroma")
    embeddings = HashingEmbeddingProvider()
    answer = "```python\nscore = 5 - len(problems)\n```\n\n```text\nscore\n```\n- Pikët."
    with session_factory() as session:
        document = _persisted(session, _document(document_id="tutor-code"))
        index_document(document, store=store, embedding_provider=embeddings)
        provider = MockProvider([json.dumps({"answer": answer, "follow_up_questions": []})])

        result = await generate_tutor_answer(
            document=document,
            provider=provider,
            store=store,
            embedding_provider=embeddings,
            message="Si llogaritet score në këtë funksion?",
            level="beginner",
            language="sq",
            session=session,
        )

    assert _fences(result.answer) == ["score = 5 - len(problems)"]
    assert "`score` - Pikët." in result.answer


def _persisted(session: Session, document: Document) -> Document:
    session.add(document)
    session.commit()
    session.refresh(document)
    return document
