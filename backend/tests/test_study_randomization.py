"""Tests for block randomization and participant code generation."""

from __future__ import annotations

import random

import pytest

from app.study.models import StudyGroup
from app.study.randomization import assign_group, generate_participant_code


def _simulate(n: int, *, block_size: int = 4, seed: int = 0) -> list[StudyGroup]:
    rng = random.Random(seed)
    assigned: list[StudyGroup] = []
    for _ in range(n):
        assigned.append(assign_group(assigned, block_size=block_size, rng=rng))
    return assigned


def test_every_completed_block_is_exactly_balanced() -> None:
    assigned = _simulate(40, block_size=4, seed=1)

    for block_start in range(0, len(assigned), 4):
        block = assigned[block_start : block_start + 4]
        assert block.count(StudyGroup.EXPERIMENTAL) == 2
        assert block.count(StudyGroup.CONTROL) == 2


def test_group_counts_never_drift_more_than_half_a_block_apart() -> None:
    assigned = _simulate(101, block_size=4, seed=2)

    running_experimental = 0
    running_control = 0
    for group in assigned:
        if group == StudyGroup.EXPERIMENTAL:
            running_experimental += 1
        else:
            running_control += 1
        assert abs(running_experimental - running_control) <= 2


def test_an_incomplete_final_block_is_never_more_unbalanced_than_the_block_size_allows() -> None:
    # 41 participants: 10 complete blocks of 4, plus 1 into a new block.
    assigned = _simulate(41, block_size=4, seed=3)
    last_block = assigned[40:]
    assert len(last_block) == 1


def test_assignment_is_randomized_across_runs_not_a_fixed_sequence() -> None:
    first = _simulate(40, block_size=4, seed=10)
    second = _simulate(40, block_size=4, seed=11)
    assert first != second


def test_many_simulated_participants_converge_close_to_an_even_split() -> None:
    assigned = _simulate(500, block_size=4, seed=42)
    experimental = assigned.count(StudyGroup.EXPERIMENTAL)
    control = assigned.count(StudyGroup.CONTROL)
    assert experimental == control == 250


def test_withdrawn_participants_must_still_be_included_to_keep_blocks_balanced() -> None:
    # Simulate 3 real assignments then a withdrawal is recorded as still consuming its slot;
    # the block only balances correctly if the caller passes every assignment, not just active
    # participants (documented in assign_group's docstring).
    rng = random.Random(7)
    assigned = [
        assign_group([], block_size=4, rng=rng),
        assign_group([StudyGroup.EXPERIMENTAL], block_size=4, rng=rng),
    ]
    # Regardless of what happened to the first two participants afterwards (e.g. withdrawal),
    # the 3rd and 4th assignment must still complete that same block to exactly 2/2.
    third = assign_group(assigned, block_size=4, rng=rng)
    fourth = assign_group([*assigned, third], block_size=4, rng=rng)
    full_block = [*assigned, third, fourth]
    assert full_block.count(StudyGroup.EXPERIMENTAL) == 2
    assert full_block.count(StudyGroup.CONTROL) == 2


@pytest.mark.parametrize("block_size", [0, 1, 3, -2])
def test_rejects_an_invalid_block_size(block_size: int) -> None:
    with pytest.raises(ValueError, match="block_size"):
        assign_group([], block_size=block_size)


def test_participant_code_matches_the_expected_shape() -> None:
    code = generate_participant_code(random.Random(5))
    assert code.startswith("P-")
    assert len(code) == 6
    suffix = code[2:]
    assert suffix.isalnum()
    assert suffix == suffix.upper()


def test_participant_codes_avoid_ambiguous_characters() -> None:
    codes = {generate_participant_code(random.Random(seed)) for seed in range(500)}
    ambiguous = set("0O1I")
    for code in codes:
        assert not (ambiguous & set(code))


def test_participant_codes_are_not_all_identical() -> None:
    codes = {generate_participant_code(random.Random(seed)) for seed in range(50)}
    assert len(codes) > 1
