"""Balanced block randomization for Study Mode group assignment.

Uses random permuted blocks: within each block of ``block_size`` participants (default 4, so
the two arms never drift more than 2 apart and converge on an even split, e.g. 20/20 for a
40-person study), a fair coin decides between the two groups except that a group already full
for the current block is never chosen again until the next block starts. This is the standard
technique for keeping a two-arm study balanced without either arm's next assignment being
predictable from a fixed, guessable sequence.
"""

from __future__ import annotations

import random
from collections.abc import Sequence

from app.study.models import StudyGroup

DEFAULT_BLOCK_SIZE = 4


def assign_group(
    assigned_so_far: Sequence[StudyGroup],
    *,
    block_size: int = DEFAULT_BLOCK_SIZE,
    rng: random.Random | None = None,
) -> StudyGroup:
    """Return the group for the next participant, given every prior assignment in order.

    ``assigned_so_far`` must include withdrawn participants too: they already consumed a slot
    in their block, and leaving them out would let a later block drift out of balance.
    """
    if block_size < 2 or block_size % 2 != 0:
        raise ValueError("block_size must be a positive even number")
    rng = rng or random.Random()

    block_start = (len(assigned_so_far) // block_size) * block_size
    current_block = list(assigned_so_far[block_start:])
    slots_per_group = block_size // 2
    experimental_available = current_block.count(StudyGroup.EXPERIMENTAL) < slots_per_group
    control_available = current_block.count(StudyGroup.CONTROL) < slots_per_group

    if experimental_available and control_available:
        return rng.choice([StudyGroup.EXPERIMENTAL, StudyGroup.CONTROL])
    if experimental_available:
        return StudyGroup.EXPERIMENTAL
    return StudyGroup.CONTROL


_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"  # no 0/O or 1/I: unambiguous when read aloud
_CODE_SUFFIX_LENGTH = 4


def generate_participant_code(rng: random.Random | None = None) -> str:
    """A random, human-readable, memorable participant code, e.g. ``P-7K2M``.

    Not guaranteed unique by itself: the caller must retry on a rare collision (see
    ``app.study.service.create_participant``).
    """
    rng = rng or random.Random()
    suffix = "".join(rng.choice(_CODE_ALPHABET) for _ in range(_CODE_SUFFIX_LENGTH))
    return f"P-{suffix}"
