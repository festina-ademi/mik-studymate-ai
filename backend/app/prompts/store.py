"""Loading and filling prompt template files."""

import hashlib
import re
from functools import cache
from pathlib import Path

TEMPLATES_DIR = Path(__file__).resolve().parent / "templates"
_PLACEHOLDER = re.compile(r"\{\{\s*(\w+)\s*\}\}")


class TemplateStore:
    """Reads ``*.md`` templates from a folder. Names are paths without the extension."""

    def __init__(self, root: Path = TEMPLATES_DIR) -> None:
        """Use templates from ``root``."""
        self._root = root
        self._read = cache(self._read_file)

    def _read_file(self, name: str) -> str:
        path = self._root / f"{name}.md"
        if not path.is_file():
            raise FileNotFoundError(f"Prompt template not found: {name}")
        return path.read_text(encoding="utf-8").strip()

    def get(self, name: str) -> str:
        """Return the raw text of template ``name`` (e.g. ``"system/grounding"``)."""
        return self._read(name)

    def render(self, name: str, /, **values: str) -> str:
        """Fill ``{{placeholders}}`` of template ``name``.

        ``name`` is positional-only so that a placeholder can itself be called ``name``.

        Substitution is a single pass, so a value that itself contains ``{{...}}`` (for example
        a document) is inserted literally and never interpreted.

        Raises:
            KeyError: The template uses a placeholder for which no value was given.
        """

        def substitute(match: re.Match[str]) -> str:
            key = match.group(1)
            if key not in values:
                raise KeyError(f"Template {name!r} needs a value for {{{{{key}}}}}")
            return values[key]

        return _PLACEHOLDER.sub(substitute, self.get(name))

    def fingerprint(self) -> str:
        """SHA-256 over all template names and contents (line endings normalized)."""
        digest = hashlib.sha256()
        for path in sorted(self._root.rglob("*.md")):
            digest.update(path.relative_to(self._root).as_posix().encode())
            digest.update(path.read_bytes().replace(b"\r\n", b"\n"))
        return digest.hexdigest()
