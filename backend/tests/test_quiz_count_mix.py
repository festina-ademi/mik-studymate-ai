"""A quiz delivers the requested number of questions, with short-answer ones in the mix.

Two regressions: quizzes came back short (4 requested, 2 delivered) and short-answer questions
vanished. Most candidates were being discarded by the grounding heuristic (natural-language or
Albanian answers rarely repeat two words of source code), and a loose "roughly 60/40" type mix
let the model skip short-answer questions altogether. Both types are now split evenly.
"""

from collections import Counter

from fastapi.testclient import TestClient

from app.db.models import Chunk, Document, SourceFormat
from app.domain import ContentType, Language, Level
from app.services.quiz import QuizQuestionInput, _is_grounded, _validate_and_normalize
from tests.test_quiz import draft, make_client, mc_question, seed_document

# Distinct, grounded stems (each shares words with the seeded sorting/searching chunks).
_MC_STEMS = [
    ("Which operation arranges values in order?", "Sort"),
    ("What does binary search require of the data?", "Sorted data"),
    ("Why does sorting values make a later lookup faster?", "Order"),
    ("In what time does binary search work on sorted data?", "Logarithmic"),
    ("Which property must data have before a binary search?", "Sorted"),
    ("What do sorted values allow for a faster lookup?", "Searching"),
]
_SA_STEMS = [
    "Why must data be sorted before binary search works?",
    "Explain how sorting values in order speeds up a later lookup.",
    "Describe why binary search runs in logarithmic time on sorted data.",
    "How does putting values in order help when searching them?",
]


def mc(n: int) -> dict:
    question, correct = _MC_STEMS[n]
    return mc_question(question=question, correct=correct)


def sa(n: int) -> dict:
    return {
        "kind": "short_answer",
        "topic": "Searching",
        "difficulty": "medium",
        "question": _SA_STEMS[n],
        "options": [],
        "correct_answer": "Binary search halves a sorted range at each step.",
        "explanation": "Binary search requires sorted data and works in logarithmic time.",
        "source_reference": "Page 2",
        "rubric": "Mentions sorted data and halving.",
        "key_points": ["sorted data", "halves the range"],
    }


def _quiz(client: TestClient, num: int, **extra: object) -> dict:
    response = client.post(
        "/api/documents/doc-quiz/quiz",
        json={"level": "beginner", "language": "en", "num_questions": num, **extra},
    )
    assert response.status_code == 200
    return response.json()


def _kinds(quiz: dict) -> Counter:
    return Counter(question["kind"] for question in quiz["questions"])


def test_four_requested_gives_exactly_four_with_short_answers() -> None:
    client = make_client(draft(mc(0), mc(1), sa(0), sa(1)))
    seed_document(client)

    quiz = _quiz(client, 4)

    assert len(quiz["questions"]) == 4
    assert _kinds(quiz) == {"multiple_choice": 2, "short_answer": 2}
    (call,) = client.app.state.llm_provider.calls
    assert "exactly 2 multiple-choice and 2 short-answer questions" in (call.system or "")


def test_eight_requested_gives_exactly_eight() -> None:
    client = make_client(draft(*(mc(n) for n in range(4)), *(sa(n) for n in range(4))))
    seed_document(client)

    quiz = _quiz(client, 8)

    assert len(quiz["questions"]) == 8
    assert _kinds(quiz) == {"multiple_choice": 4, "short_answer": 4}


def test_a_repair_round_asks_only_for_the_missing_short_answers() -> None:
    # Round 1 returns only multiple-choice questions; round 2 is asked for the short answers.
    client = make_client(draft(mc(0), mc(1), mc(2), mc(3)), draft(sa(0), sa(1)))
    seed_document(client)

    quiz = _quiz(client, 4)

    assert _kinds(quiz) == {"multiple_choice": 2, "short_answer": 2}
    first, second = client.app.state.llm_provider.calls
    assert "exactly 2 multiple-choice and 2 short-answer questions" in (first.system or "")
    assert "short-answer questions only" in (second.system or "")
    assert "EXACTLY 2 questions" in (second.system or "")


def test_the_count_is_kept_even_if_the_model_never_writes_short_answers() -> None:
    mc_only = draft(*(mc(n) for n in range(6)))
    client = make_client(mc_only, mc_only, mc_only)
    seed_document(client)

    quiz = _quiz(client, 4)

    # Better four multiple-choice questions than a two-question quiz.
    assert len(quiz["questions"]) == 4


def test_a_round_without_the_avoid_list_fills_a_quiz_that_is_still_short() -> None:
    first_quiz = draft(mc(0), mc(1))
    repeats_only = draft(mc(0), mc(1))  # the model keeps re-asking the earlier questions
    fresh = draft(mc(2), mc(3))
    client = make_client(first_quiz, repeats_only, repeats_only, repeats_only, fresh)
    seed_document(client)
    body = {"types": ["multiple_choice"]}

    _quiz(client, 2, **body)
    quiz = _quiz(client, 2, variation_seed=1, **body)

    assert [q["question"] for q in quiz["questions"]] == [_MC_STEMS[2][0], _MC_STEMS[3][0]]
    calls = client.app.state.llm_provider.calls
    assert len(calls) == 5  # first quiz, three rounds with the avoid-list, one without
    assert all("already seen" in (call.system or "") for call in calls[1:4])
    assert "already seen" not in (calls[4].system or "")


# --- grounding ----------------------------------------------------------------------------

_PASSWORD_CODE = """def check_password_strength(password):
    if len(password) < 8:
        return "E dobët: shumë e shkurtër"
    has_upper = False
    for char in password:
        if char.isupper():
            has_upper = True
    return "E fortë" if has_upper else "Mesatare"
"""


def _code_document() -> Document:
    document = Document(
        filename="password.py",
        content_hash="p" * 64,
        content_type=ContentType.CODE,
        source_format=SourceFormat.CODE,
        detected_language=Language.EN,
        size_bytes=len(_PASSWORD_CODE),
    )
    document.chunks = [
        Chunk(ordinal=0, text=_PASSWORD_CODE, heading="password.py", line_start=1, line_end=8)
    ]
    return document


def test_an_albanian_short_answer_about_code_is_kept() -> None:
    question = "Pse kontrollohet gjatësia e fjalëkalimit në fillim të funksionit?"
    answer = "Që funksioni të kthehet menjëherë kur fjalëkalimi është i shkurtër."
    candidate = QuizQuestionInput(
        kind="short_answer",
        topic="Kontrolli i gjatësisë",
        difficulty="medium",
        question=question,
        correct_answer=answer,
        explanation="Kushti `if len(password) < 8` kthen 'E dobët: shumë e shkurtër' para ciklit.",
        source_reference="[password.py:2-3]",
        rubric="Përmend kthimin e hershëm.",
        key_points=["len(password) < 8", "kthim i hershëm"],
    )
    document = _code_document()

    kept = _validate_and_normalize(
        [candidate], document=document, level=Level.INTERMEDIATE, allowed_kinds={"short_answer"}
    )

    # The question and answer alone share almost no words with the code ...
    assert _is_grounded(f"{question} {answer}", list(document.chunks)) is False
    # ... but the explanation and key points tie it to the exact lines, so it is kept.
    assert len(kept) == 1


def test_a_fabricated_question_about_code_is_still_rejected() -> None:
    candidate = QuizQuestionInput(
        kind="short_answer",
        topic="History",
        difficulty="medium",
        question="Who designed the Eiffel Tower?",
        correct_answer="Gustave Eiffel's engineering company.",
        explanation="The tower was completed in 1889 for the World's Fair in Paris.",
        source_reference="[password.py:1]",
        rubric="Names the designer.",
        key_points=["Gustave Eiffel", "1889"],
    )

    kept = _validate_and_normalize(
        [candidate],
        document=_code_document(),
        level=Level.INTERMEDIATE,
        allowed_kinds={"short_answer"},
    )

    assert kept == []
