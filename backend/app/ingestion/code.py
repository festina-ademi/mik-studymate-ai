"""Chunking and extraction for uploaded source-code files and project archives."""

from __future__ import annotations

import ast
import io
import re
import zipfile
from pathlib import Path
from typing import Any

from app.errors import AppError
from app.ingestion.language import detect_code_language

ALLOWED_EXTENSIONS = {
    ".py",
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".java",
    ".c",
    ".cc",
    ".cpp",
    ".h",
    ".hpp",
    ".cs",
    ".go",
    ".rs",
    ".php",
    ".rb",
    ".kt",
    ".swift",
    ".sql",
    ".html",
    ".css",
    ".sh",
    ".bash",
    ".json",
    ".yaml",
    ".yml",
    ".md",
    ".txt",
    ".ini",
    ".toml",
    ".xml",
    ".csv",
}
IGNORED_DIRS = {"node_modules", ".git", "__pycache__", ".venv", "venv", "dist", "build"}
MAX_ZIP_ENTRIES = 200
MAX_ZIP_TOTAL_BYTES = 25 * 1024 * 1024


def _is_probably_binary(payload: bytes) -> bool:
    """Return true when byte content is likely binary rather than text."""
    if not payload:
        return False
    if b"\x00" in payload[:4096]:
        return True
    sample = payload[:1024]
    printable = sum(1 for byte in sample if byte in b"\n\r\t\x0c " or 32 <= byte < 127)
    return printable / max(len(sample), 1) < 0.75


def _decode_bytes(payload: bytes) -> str:
    """Decode text bytes with UTF-8 first, then a small set of useful fallbacks."""
    for encoding in ("utf-8-sig", "utf-16", "cp1252", "latin-1"):
        try:
            return payload.decode(encoding)
        except UnicodeDecodeError:
            continue
    return payload.decode("utf-8", errors="replace")


def _is_allowed_extension(filename: str) -> bool:
    """Check whether a filename is in the code allow-list."""
    suffix = Path(filename).suffix.lower()
    return suffix in ALLOWED_EXTENSIONS or filename.lower().endswith(".ipynb")


def _safe_zip_member_name(name: str) -> str:
    """Reject zip traversal and unsafe archive members."""
    candidate = name.replace("\\", "/")
    if candidate.startswith("/") or ".." in Path(candidate).parts:
        raise AppError(400, "UNSUPPORTED_TYPE", details={"path": name})
    return candidate


_ZIP_READ_CHUNK_BYTES = 1024 * 1024


def _read_zip_member_bounded(archive: zipfile.ZipFile, info: zipfile.ZipInfo, limit: int) -> bytes:
    """Decompress one archive member, aborting as soon as it exceeds ``limit`` bytes.

    Reads incrementally instead of ``archive.read(info)`` so a single crafted entry whose
    *declared* size is small but whose *decompressed* size is enormous (a zip bomb) cannot
    exhaust memory before a size check ever runs — the check happens after every chunk, not
    only once the whole member has already been inflated.
    """
    chunks: list[bytes] = []
    total = 0
    with archive.open(info) as member:
        while True:
            chunk = member.read(_ZIP_READ_CHUNK_BYTES)
            if not chunk:
                break
            total += len(chunk)
            if total > limit:
                raise AppError(400, "FILE_TOO_LARGE", details={"max_bytes": limit})
            chunks.append(chunk)
    return b"".join(chunks)


def _iter_zip_members(zip_bytes: bytes) -> list[tuple[str, bytes]]:
    """Read project archive members without following zip-slip or binary paths."""
    members: list[tuple[str, bytes]] = []
    total_size = 0
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as archive:
        infos = archive.infolist()
        if len(infos) > MAX_ZIP_ENTRIES:
            raise AppError(400, "UNSUPPORTED_TYPE", details={"entries": len(infos)})
        for info in infos:
            if info.is_dir():
                continue
            name = _safe_zip_member_name(info.filename)
            if any(part in IGNORED_DIRS for part in Path(name).parts[:-1]):
                continue
            if not _is_allowed_extension(name):
                continue
            # Bound the remaining budget, not just this member's own cap, so many
            # moderately-sized entries can't add up past MAX_ZIP_TOTAL_BYTES either.
            remaining_budget = MAX_ZIP_TOTAL_BYTES - total_size
            payload = _read_zip_member_bounded(archive, info, remaining_budget)
            total_size += len(payload)
            if _is_probably_binary(payload):
                continue
            members.append((name, payload))
    return members


def _extract_python_chunks(source: str, filename: str) -> list[dict[str, Any]]:
    """Chunk Python files by class and function with line ranges."""
    chunks: list[dict[str, Any]] = []
    try:
        tree = ast.parse(source)
    except SyntaxError:
        tree = None

    if tree is None:
        return _fallback_code_chunks(source, filename)

    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            node_source = ast.get_source_segment(source, node)
            if not node_source:
                continue
            chunks.append(
                {
                    "source_name": filename,
                    "text": node_source.strip(),
                    "section_title": node.name,
                    "function_name": node.name,
                    "line_start": getattr(node, "lineno", 1),
                    "line_end": getattr(
                        node,
                        "end_lineno",
                        getattr(node, "lineno", 1),
                    ),
                    "chunk_type": (
                        "function"
                        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
                        else "class"
                    ),
                }
            )

    if not chunks:
        return _fallback_code_chunks(source, filename)
    return chunks


def _fallback_code_chunks(source: str, filename: str) -> list[dict[str, Any]]:
    """Chunk non-Python sources using block structure and overlapping windows."""
    lines = source.splitlines()
    if not lines:
        return []

    blocks: list[dict[str, Any]] = []
    current: list[str] = []
    current_start = 1
    brace_depth = 0
    for index, line in enumerate(lines, start=1):
        current.append(line)
        brace_depth += line.count("{") - line.count("}")
        if line.strip() and (line.strip()[-1] in {";", "}", "{"} or brace_depth <= 0) and current:
            blocks.append(
                {
                    "text": "\n".join(current).strip(),
                    "line_start": current_start,
                    "line_end": index,
                }
            )
            current = []
            current_start = index + 1
            brace_depth = 0
    if current:
        blocks.append(
            {
                "text": "\n".join(current).strip(),
                "line_start": current_start,
                "line_end": len(lines),
            }
        )

    if not blocks:
        blocks = [{"text": source.strip(), "line_start": 1, "line_end": len(lines)}]

    chunks: list[dict[str, Any]] = []
    for block in blocks:
        text = block["text"].strip()
        if not text:
            continue
        chunks.append(
            {
                "source_name": filename,
                "text": text,
                "section_title": Path(filename).stem,
                "function_name": Path(filename).stem,
                "line_start": block["line_start"],
                "line_end": block["line_end"],
                "chunk_type": "block",
            }
        )
    return chunks


# Distinctive syntax markers per programming language, for "Auto-detect" on the pasted-code
# input (Phase 11). Each is one point of evidence; the language with the most hits wins. Order
# matters only as a tie-break (earlier wins), so more common choices for a CS assignment come
# first. This is deliberately a simple heuristic, not a real parser/classifier.
_PROGRAMMING_LANGUAGE_MARKERS: dict[str, tuple[re.Pattern[str], ...]] = {
    "python": (
        re.compile(r"^\s*def\s+\w+\s*\(.*\)\s*:", re.M),
        re.compile(r"^\s*(import|from)\s+\w+", re.M),
        re.compile(r"^\s*elif\b", re.M),
        re.compile(r"\bself\b"),
    ),
    "typescript": (
        re.compile(r":\s*(string|number|boolean|void|any|unknown)\b"),
        re.compile(r"\binterface\s+\w+"),
        re.compile(r"\btype\s+\w+\s*="),
        re.compile(r"<\w+>\s*\("),
    ),
    "javascript": (
        re.compile(r"\bfunction\s*\w*\s*\("),
        re.compile(r"\bconst\s+\w+\s*="),
        re.compile(r"=>"),
        re.compile(r"\bconsole\.log\("),
    ),
    "java": (
        re.compile(r"\bpublic\s+(static\s+)?(final\s+)?class\s+\w+"),
        re.compile(r"\bSystem\.out\.println\("),
        re.compile(r"\bpublic\s+static\s+void\s+main\s*\("),
        re.compile(r"\bimport\s+java\."),
    ),
    "csharp": (
        re.compile(r"\busing\s+System\b"),
        re.compile(r"\bnamespace\s+\w+"),
        re.compile(r"\bConsole\.WriteLine\("),
        re.compile(r"\bpublic\s+class\s+\w+"),
    ),
    "cpp": (
        re.compile(r"#include\s*[<\"]"),
        re.compile(r"\bstd::"),
        re.compile(r"\bcout\s*<<"),
        re.compile(r"\bint\s+main\s*\("),
    ),
    "php": (
        re.compile(r"<\?php"),
        re.compile(r"\$\w+\s*="),
        re.compile(r"->\w+\("),
    ),
    "sql": (
        re.compile(r"\bSELECT\b.+\bFROM\b", re.I | re.S),
        re.compile(r"\bCREATE\s+TABLE\b", re.I),
        re.compile(r"\bINSERT\s+INTO\b", re.I),
        re.compile(r"\bWHERE\b", re.I),
    ),
    "html": (
        re.compile(r"<!DOCTYPE\s+html", re.I),
        re.compile(r"</?html[ >]", re.I),
        re.compile(r"</?div[ >]", re.I),
        re.compile(r"</?body[ >]", re.I),
    ),
    "css": (
        re.compile(r"[.#]?[\w-]+\s*\{[^{}]*:[^{}]*;[^{}]*\}"),
        re.compile(r"@media\b"),
    ),
    "go": (
        re.compile(r"\bpackage\s+main\b"),
        re.compile(r"\bfunc\s+main\s*\(\s*\)"),
        re.compile(r"\bfmt\.Println\("),
        re.compile(r":=\s"),
    ),
    "rust": (
        re.compile(r"\bfn\s+main\s*\(\s*\)"),
        re.compile(r"\blet\s+mut\b"),
        re.compile(r"println!\("),
        re.compile(r"->\s*\w+\s*\{"),
    ),
    "kotlin": (
        re.compile(r"\bfun\s+main\s*\("),
        re.compile(r"\bval\s+\w+\s*[:=]"),
        re.compile(r"\bprintln\("),
        re.compile(r"\bvar\s+\w+\s*:"),
    ),
    "swift": (
        re.compile(r"\bfunc\s+\w+\s*\("),
        re.compile(r"\bvar\s+\w+\s*:\s*\w+"),
        re.compile(r"\blet\s+\w+\s*="),
        re.compile(r"\bimport\s+(Foundation|SwiftUI|UIKit)\b"),
    ),
}


def detect_programming_language(code: str) -> str | None:
    """Best-effort guess of the programming language from syntax, for pasted-code "Auto-detect".

    Scores each candidate language by how many of its own distinctive markers appear in
    ``code`` and returns the highest scorer, or ``None`` when nothing scores at all (too
    ambiguous to guess -- the caller falls back to plain text, per the Phase 11 spec).
    """
    scores = {
        language: sum(1 for pattern in patterns if pattern.search(code))
        for language, patterns in _PROGRAMMING_LANGUAGE_MARKERS.items()
    }
    best_language, best_score = max(scores.items(), key=lambda item: item[1])
    return best_language if best_score > 0 else None


def extract_code_bundle(
    files: list[dict[str, Any]] | None = None,
    *,
    zip_bytes: bytes | None = None,
) -> dict[str, Any]:
    """Extract and chunk text from many code files or a zipped project bundle."""
    files = files or []
    collected: list[dict[str, Any]] = []
    code_files: list[dict[str, Any]] = []

    if zip_bytes:
        for name, payload in _iter_zip_members(zip_bytes):
            code_files.append({"name": name, "content": payload})
    elif files:
        for file_info in files:
            name = str(file_info.get("name") or file_info.get("filename") or "upload")
            if not name:
                continue
            if not _is_allowed_extension(name):
                continue
            content = file_info.get("content")
            if isinstance(content, str):
                payload = content.encode("utf-8")
            elif isinstance(content, (bytes, bytearray)):
                payload = bytes(content)
            else:
                continue
            if _is_probably_binary(payload):
                continue
            code_files.append({"name": name, "content": payload})

    if not code_files:
        raise AppError(400, "EMPTY_DOCUMENT")

    for file_info in code_files:
        name = file_info["name"]
        payload = file_info["content"]
        text = _decode_bytes(payload)
        source_name = Path(name).name
        if source_name.lower().endswith(".py"):
            chunks = _extract_python_chunks(text, source_name)
        else:
            chunks = _fallback_code_chunks(text, source_name)
        if not chunks:
            continue
        for chunk in chunks:
            chunk["source_name"] = source_name
            chunk["language"] = "en"
            if comment_text := detect_code_language(text, extension=Path(source_name).suffix):
                chunk["language"], chunk["language_confidence"] = comment_text
            else:
                chunk["language_confidence"] = 0.0
            collected.append(chunk)

    if not collected:
        raise AppError(400, "EMPTY_DOCUMENT")

    return {"files": code_files, "chunks": collected, "language": "en"}
