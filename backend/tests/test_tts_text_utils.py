"""Tests for stripping citation markers out of text before speech synthesis."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.tts.text_utils import strip_citations_for_tts
from tests.test_tts import FakeTtsProvider, make_client


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Hello [Page 5] world.", "Hello world."),
        ("Code [pasted_code_2026-10-13.py:17] runs.", "Code runs."),
        ("See [line 12-15] for details.", "See for details."),
        ("No citations here.", "No citations here."),
        ("Multi [Page 1] cite [Faqja 3] test [line 5-7].", "Multi cite test."),
        ("", ""),
        # The exact narration from the bug report.
        (
            "Then, the code counts how many of those three rules were met "
            "[pasted_code_2026-10-13.py:17].",
            "Then, the code counts how many of those three rules were met.",
        ),
        (
            "Kodi kontrollon gjatësinë [Rreshti 4] e fjalëkalimit.",
            "Kodi kontrollon gjatësinë e fjalëkalimit.",
        ),
        ("Shiko [Slajdi 3] dhe [Slide 4].", "Shiko dhe."),
        ("Range [file.py:45-60], then more.", "Range, then more."),
        ("A bare ref [12] here.", "A bare ref here."),
        ("[Page 3] Starts with a citation.", "Starts with a citation."),
        ("Back to back [Page 1][Page 2].", "Back to back."),
        ("Case [LINE 7] and [lines 3-5] too.", "Case and too."),
    ],
)
def test_strip_citations_for_tts(text: str, expected: str) -> None:
    assert strip_citations_for_tts(text) == expected


@pytest.mark.parametrize(
    "text",
    [
        "We compare [linear search] with binary search.",  # "line" only as a prefix
        "The first item is arr[0] in the list.",  # indexing, not a citation
        "Slicing items[a:5] copies part of it.",
        "Pick [3 apples] from the basket.",
        "Gjatësia e fjalëkalimit[Page 3] mbetet.",  # glued to a non-ASCII letter: same as above
    ],
)
def test_strip_citations_for_tts_keeps_brackets_that_are_not_citations(text: str) -> None:
    assert strip_citations_for_tts(text) == text


def test_synthesize_endpoint_sends_the_provider_text_without_citations(tmp_path: Path) -> None:
    client = make_client(tts_cache_dir=tmp_path)
    provider = FakeTtsProvider()
    client.app.state.tts_provider = provider

    response = client.post("/api/tts/synthesize", json={"text": "Hello [Page 1]", "language": "en"})

    assert response.status_code == 200
    assert provider.calls == [("Hello", "en")]


def test_synthesize_endpoint_rejects_text_that_is_only_a_citation(tmp_path: Path) -> None:
    client = make_client(tts_cache_dir=tmp_path)
    provider = FakeTtsProvider()
    client.app.state.tts_provider = provider

    response = client.post("/api/tts/synthesize", json={"text": " [Faqja 5] ", "language": "sq"})

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "EMPTY_DOCUMENT"
    assert provider.calls == []
