"""Assemble system and user prompts from template files."""

import secrets
from dataclasses import dataclass

from app.domain import ContentType, Language, Level, Task
from app.prompts.store import TemplateStore
from app.prompts.version import PROMPT_VERSION

_DELIMITER_PREFIX = "<<<DOCUMENT"


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
    ) -> Prompt:
        """Build the system and user prompts.

        Args:
            task: What to generate.
            content_type: Lecture material or source code.
            level: Learner level.
            language: Output language.
            document_text: The material, ideally with location markers such as ``[Page 3]``.
            delimiter_id: Id used in the delimiter lines; random unless fixed (tests).
        """
        delimiter_id = delimiter_id or secrets.token_hex(8)
        return Prompt(
            system=self.build_system_prompt(
                task=task,
                content_type=content_type,
                level=level,
                language=language,
                delimiter_id=delimiter_id,
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
    ) -> str:
        """Compose the system prompt."""
        start, end = _delimiters(delimiter_id)
        sections = [
            self._templates.get("system/role"),
            self._templates.get(f"system/language_{language.value}"),
            self._templates.get(f"system/level_{level.value}"),
            self._templates.get(f"system/content_{content_type.value}"),
            self._templates.get("system/grounding"),
            self._templates.render(
                "system/injection_defense", document_start=start, document_end=end
            ),
            self._templates.get(f"tasks/{task.value}_{content_type.value}"),
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


def _delimiters(delimiter_id: str) -> tuple[str, str]:
    return (
        f"{_DELIMITER_PREFIX}_{delimiter_id}_START>>>",
        f"{_DELIMITER_PREFIX}_{delimiter_id}_END>>>",
    )
