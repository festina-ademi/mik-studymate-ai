"""Version of the prompt templates.

Part of every cache key, so changing a template without bumping this value would keep serving
stale cached answers. ``tests/test_prompts.py`` fails when the templates change, as a reminder.
"""

PROMPT_VERSION = "24"
