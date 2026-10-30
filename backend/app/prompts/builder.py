"""Assemble system and user prompts from template files."""

import secrets
from dataclasses import dataclass

from app.domain import ContentType, ExplanationDepth, Language, Level, Task
from app.ingestion.language import detect_language
from app.prompts.store import TemplateStore
from app.prompts.version import PROMPT_VERSION

_DELIMITER_PREFIX = "<<<DOCUMENT"

# Below this confidence, a question is too ambiguous to trust a detected language over the
# interface language (matches the threshold `detect_code_language` uses for the same reason). A
# blind guess with no real signal (`detect_language`'s own last-resort fallback) scores 0.3,
# just under this, so it never overrides the interface language on its own.
QUESTION_LANGUAGE_CONFIDENCE_THRESHOLD = 0.35

# Below this many non-whitespace characters, even a *confident* detection is not trustworthy: a
# one- or two-word reply like "ok", "yes" or "po" is genuine EN/SQ vocabulary in both languages,
# and language detectors score these short, near-ambiguous tokens with deceptively high
# confidence in essentially random directions (measured: "ok" -> sq at 0.70, "yes" -> sq at
# 0.58, "po" -> en at 0.57 — every one of those is either the wrong language or not actually
# distinguishable). Real questions are almost always longer than this in practice, so the
# occasional short-but-genuine question (e.g. "Si?") falling back to the interface language
# costs little, in exchange for not flipping the answer language on a trivial acknowledgement.
QUESTION_LANGUAGE_MIN_CHARS = 4


def resolve_question_language(question: str, *, interface_language: Language) -> Language:
    """The language a question-driven answer (the tutor/chat) must be written in.

    Per the language rules, the tutor always answers in the language the learner *just asked
    in*, even when that differs from the interface language they picked at onboarding or from
    the study material's own language — unlike Summary/Explanation/Quiz/re-explanation, which
    intentionally follow the interface language on purpose (see ``PROJECT_SPEC.md`` section 5).
    Falls back to ``interface_language`` when the question is too short or linguistically
    ambiguous for a confident detection, rather than guessing.
    """
    if len("".join(question.split())) < QUESTION_LANGUAGE_MIN_CHARS:
        return interface_language
    _code, confidence = detect_language(question)
    if confidence < QUESTION_LANGUAGE_CONFIDENCE_THRESHOLD:
        return interface_language
    try:
        return Language(_code)
    except ValueError:  # pragma: no cover - detect_language only returns "en"/"sq"
        return interface_language


# Explanation word-count target by level: a concrete, level-varying number the model can check
# itself against, so the three levels cannot quietly converge on the same length (part of the
# Phase 10 fix: the old template hardcoded one shared word count for every level).
_EXPLANATION_LENGTH_HINTS: dict[Level, str] = {
    Level.BEGINNER: (
        "roughly 350-450 words in total — on the shorter side, since each idea is covered "
        "simply rather than at length"
    ),
    Level.INTERMEDIATE: "roughly 400-500 words in total",
    Level.ADVANCED: (
        "roughly 450-600 words in total — on the longer side, since nuance, trade-offs and "
        "edge cases take more words to cover properly"
    ),
}

_SUMMARY_LENGTH_HINTS: dict[Level, str] = {
    Level.BEGINNER: "roughly 150-220 words in total — on the shorter side",
    Level.INTERMEDIATE: "roughly 200-300 words in total",
    Level.ADVANCED: "roughly 250-350 words in total — on the longer side",
}

_LENGTH_HINTS_BY_TASK: dict[Task, dict[Level, str]] = {
    Task.EXPLANATION: _EXPLANATION_LENGTH_HINTS,
    Task.SUMMARY: _SUMMARY_LENGTH_HINTS,
}

# Code gets its own length targets (Phase 12): a line-by-line, per-function explanation needs
# far more room than a lecture's flowing prose, while a code summary is now deliberately short
# (the Explanation tab owns the depth) -- so these cannot share the lecture dicts above without
# changing lecture behavior too, which is explicitly out of scope. The line-by-line hints are
# coverage-first (Phase 15): a fixed per-function word budget made the model stop after two code
# groups and skip the rest of the function to stay within it.
_CODE_EXPLANATION_LENGTH_HINTS: dict[Level, str] = {
    Level.BEGINNER: (
        "as long as it takes to cover every meaningful line; keep each token paragraph simple, "
        "and keep Purpose, Edge cases and Assessment to a few short sentences"
    ),
    Level.INTERMEDIATE: (
        "as long as it takes to cover every meaningful line; keep Purpose, Edge cases and "
        "Assessment to a few sentences each"
    ),
    Level.ADVANCED: (
        "as long as it takes to cover every meaningful line, with the shortest token paragraphs "
        "of the three levels; Edge cases and Assessment carry the extra depth"
    ),
}

_CODE_SUMMARY_LENGTH_HINTS: dict[Level, str] = {
    Level.BEGINNER: "two to three short sentences in total — just what it does and why",
    Level.INTERMEDIATE: "three to four sentences in total",
    Level.ADVANCED: (
        "four to five sentences in total — still a high-level overview, never a line-by-line "
        "walkthrough"
    ),
}

_CODE_LENGTH_HINTS_BY_TASK: dict[Task, dict[Level, str]] = {
    Task.EXPLANATION: _CODE_EXPLANATION_LENGTH_HINTS,
    Task.SUMMARY: _CODE_SUMMARY_LENGTH_HINTS,
}

# Blocks mode (Phase 15) replaces the per-function word budget above with a per-block one: each
# block gets one short paragraph, however long the code is, so the total scales with the block
# count instead of with every token on every line.
_CODE_BLOCKS_LENGTH_HINTS: dict[Level, str] = {
    Level.BEGINNER: "roughly 40-60 words per block summary, in short and simple sentences",
    Level.INTERMEDIATE: "roughly 50-70 words per block summary",
    Level.ADVANCED: (
        "roughly 60-80 words per block summary — dense, precise terminology rather than more "
        "sentences"
    ),
}

# Which code-explanation template each depth loads (``tasks/explanation_code_<suffix>``).
_EXPLANATION_DEPTH_TEMPLATES: dict[ExplanationDepth, str] = {
    ExplanationDepth.LINE_BY_LINE: "linebyline",
    ExplanationDepth.BLOCKS: "blocks",
}

# Default values for task-template placeholders beyond ``{{level}}``, used whenever a caller
# does not supply ``task_params`` explicitly (e.g. the prompt test suite, which builds every
# (task, content_type, level, language) combination without knowing about quiz-specific knobs).
_DEFAULT_TASK_PARAMS: dict[Task, dict[str, str]] = {
    Task.QUIZ: {
        "num_questions": "8",
        "type_mix": "a mix of multiple-choice and short-answer questions",
        # Filled with ``tasks/quiz_avoid_previous`` when the document already has quiz history.
        "avoid_questions": "",
    },
    Task.REEXPLAIN: {"topic": "the topic"},
    Task.EXPLAINER: {
        "scope": "an overview of the whole document",
        "duration_hint": "one to two minutes",
        "transition_instruction": "Start with a short, warm welcome.",
        "simplify_instruction": "",
    },
}


@dataclass(frozen=True)
class Prompt:
    """A ready-to-send prompt pair."""

    system: str
    user: str
    version: str


class PromptBuilder:
    """Builds prompts for a ``(task, content type, level, language)`` combination.

    The system prompt is composed of: role, output-language rules, learner-level rules,
    material-type rules, grounding rules, the prompt-injection defense and the task template.
    The document goes into the user prompt between random-id delimiter lines and is declared
    to be data in the system prompt.
    """

    def __init__(self, templates: TemplateStore | None = None) -> None:
        """Use ``templates`` (the bundled template folder by default)."""
        self._templates = templates or TemplateStore()

    def build(
        self,
        *,
        task: Task,
        content_type: ContentType,
        level: Level,
        language: Language,
        document_text: str,
        delimiter_id: str | None = None,
        task_params: dict[str, str] | None = None,
        depth: ExplanationDepth = ExplanationDepth.LINE_BY_LINE,
    ) -> Prompt:
        """Build the system and user prompts.

        Args:
            task: What to generate.
            content_type: Lecture material or source code.
            level: Learner level.
            language: Output language.
            document_text: The material, ideally with location markers such as ``[Page 3]``.
            delimiter_id: Id used in the delimiter lines; random unless fixed (tests).
            task_params: Extra placeholder values for the task template beyond ``{{level}}``
                (for example the quiz template's ``{{num_questions}}`` and ``{{type_mix}}``).
                Tasks that do not need them may omit this; defaults fill any missing value.
            depth: Line-by-line or block-level breakdown; only read for a code explanation.
        """
        delimiter_id = delimiter_id or secrets.token_hex(8)
        return Prompt(
            system=self.build_system_prompt(
                task=task,
                content_type=content_type,
                level=level,
                language=language,
                delimiter_id=delimiter_id,
                task_params=task_params,
                depth=depth,
            ),
            user=self.build_user_prompt(document_text, delimiter_id),
            version=PROMPT_VERSION,
        )

    def build_system_prompt(
        self,
        *,
        task: Task,
        content_type: ContentType,
        level: Level,
        language: Language,
        delimiter_id: str,
        task_params: dict[str, str] | None = None,
        depth: ExplanationDepth = ExplanationDepth.LINE_BY_LINE,
    ) -> str:
        """Compose the system prompt."""
        start, end = _delimiters(delimiter_id)
        is_code = content_type == ContentType.CODE
        hints_by_task = _CODE_LENGTH_HINTS_BY_TASK if is_code else _LENGTH_HINTS_BY_TASK
        length_hints = hints_by_task.get(task)
        task_template = f"tasks/{task.value}_{content_type.value}"
        if is_code and task == Task.EXPLANATION:
            task_template = f"{task_template}_{_EXPLANATION_DEPTH_TEMPLATES[depth]}"
            if depth == ExplanationDepth.BLOCKS:
                length_hints = _CODE_BLOCKS_LENGTH_HINTS
        level_defaults = {"length_hint": length_hints[level]} if length_hints else {}
        params = {
            "level": level.value,
            **_DEFAULT_TASK_PARAMS.get(task, {}),
            **level_defaults,
            **(task_params or {}),
        }
        sections = [
            self._templates.get("system/role"),
            self._templates.get(f"system/language_{language.value}"),
            self._templates.get(f"system/level_{level.value}"),
            self._templates.get(f"system/content_{content_type.value}"),
            self._templates.get("system/grounding"),
            self._templates.render(
                "system/injection_defense", document_start=start, document_end=end
            ),
            self._templates.render(task_template, **params),
        ]
        return "\n\n".join(sections)

    def build_user_prompt(self, document_text: str, delimiter_id: str) -> str:
        """Wrap the document in delimiter lines."""
        start, end = _delimiters(delimiter_id)
        # The id is random and unguessable; neutralizing the prefix as well means even a
        # document that quotes our delimiter format cannot imitate it.
        safe_text = document_text.replace(_DELIMITER_PREFIX, "<<< DOCUMENT")
        return self._templates.render(
            "user/document_request",
            document_start=start,
            document_end=end,
            document_text=safe_text,
        )

    def build_grading_prompt(
        self,
        *,
        language: Language,
        question: str,
        rubric: str,
        key_points: list[str],
        student_answer: str,
        delimiter_id: str | None = None,
    ) -> Prompt:
        """Build the system/user prompts for grading one short-answer quiz response.

        Unlike :meth:`build`, this is not indexed by ``(task, content_type)``: grading a rubric
        needs no learner-level or material-type framing, only the language and injection
        defense sections plus the grading instructions.
        """
        delimiter_id = delimiter_id or secrets.token_hex(8)
        start, end = _delimiters(delimiter_id)
        system = "\n\n".join(
            [
                self._templates.get("system/role"),
                self._templates.get(f"system/language_{language.value}"),
                self._templates.render(
                    "system/injection_defense", document_start=start, document_end=end
                ),
                self._templates.get("tasks/quiz_grading"),
            ]
        )
        key_points_text = (
            "\n".join(f"- {point}" for point in key_points) if key_points else "(none given)"
        )
        user = self._templates.render(
            "user/quiz_grading_request",
            document_start=start,
            document_end=end,
            question=question,
            rubric=rubric or "(no rubric given; judge on general correctness and completeness)",
            key_points=key_points_text,
            student_answer=student_answer,
        )
        return Prompt(system=system, user=user, version=PROMPT_VERSION)


def _delimiters(delimiter_id: str) -> tuple[str, str]:
    return (
        f"{_DELIMITER_PREFIX}_{delimiter_id}_START>>>",
        f"{_DELIMITER_PREFIX}_{delimiter_id}_END>>>",
    )
