"""Tests for the study statistics service, checked against known reference values.

Where scipy itself provides the number (Shapiro-Wilk, Levene, the t-tests, Mann-Whitney), the
reference values are computed directly from scipy's documented behavior on fixed, hand-picked
datasets so that a regression in how this module extracts/derives values from scipy's results
(not just "does scipy work") is what these tests catch. Cohen's d has no scipy equivalent, so
it is checked against a textbook hand-computation instead.
"""

from __future__ import annotations

import math

import pytest
from scipy import stats as scipy_stats

from app.domain import Language
from app.study.models import StudyGroup
from app.study.stats import (
    ParticipantScoreRow,
    build_statistics_report,
    cohens_d,
    compare_groups,
    describe,
    levene_test,
    mann_whitney_u,
    shapiro_wilk,
    t_test,
)

# A fixed, hand-picked dataset (not random) so every expected value below is reproducible.
GROUP_A = [72.0, 75.0, 78.0, 74.0, 80.0, 76.0, 79.0, 73.0, 77.0, 81.0]
GROUP_B = [65.0, 68.0, 70.0, 64.0, 72.0, 66.0, 69.0, 63.0, 71.0, 67.0]


# --- descriptive statistics -----------------------------------------------------------------


def test_describe_matches_hand_computed_mean_sd_median() -> None:
    result = describe([2.0, 4.0, 4.0, 4.0, 5.0, 5.0, 7.0, 9.0])

    assert result.n == 8
    assert result.mean == pytest.approx(5.0)
    assert result.sd == pytest.approx(2.13809, abs=1e-4)  # textbook example, sample sd
    assert result.median == pytest.approx(4.5)


def test_describe_of_a_single_value_has_zero_sd() -> None:
    result = describe([42.0])
    assert result.n == 1
    assert result.mean == 42.0
    assert result.sd == 0.0
    assert result.median == 42.0


def test_describe_of_an_empty_sample_is_all_none() -> None:
    result = describe([])
    assert result.n == 0
    assert result.mean is None
    assert result.sd is None
    assert result.median is None


# --- normality (Shapiro-Wilk) ----------------------------------------------------------------


def test_shapiro_wilk_matches_scipy_directly() -> None:
    expected_statistic, expected_p = scipy_stats.shapiro(GROUP_A)

    result = shapiro_wilk(GROUP_A)

    assert result.n == 10
    assert result.statistic == pytest.approx(float(expected_statistic))
    assert result.p_value == pytest.approx(float(expected_p))
    assert result.is_normal == (expected_p > 0.05)


def test_shapiro_wilk_refuses_fewer_than_three_observations() -> None:
    result = shapiro_wilk([1.0, 2.0])
    assert result.n == 2
    assert result.statistic is None
    assert result.p_value is None
    assert result.is_normal is None


# --- Levene's test ------------------------------------------------------------------------------


def test_levene_matches_scipy_directly() -> None:
    expected_statistic, expected_p = scipy_stats.levene(GROUP_A, GROUP_B)

    result = levene_test(GROUP_A, GROUP_B)

    assert result.statistic == pytest.approx(float(expected_statistic))
    assert result.p_value == pytest.approx(float(expected_p))
    assert result.equal_variances == (expected_p > 0.05)


def test_levene_refuses_a_group_with_fewer_than_two_observations() -> None:
    result = levene_test([1.0], [1.0, 2.0, 3.0])
    assert result.statistic is None
    assert result.p_value is None
    assert result.equal_variances is None


# --- t-tests -------------------------------------------------------------------------------------


def test_student_t_matches_scipy_directly() -> None:
    expected = scipy_stats.ttest_ind(GROUP_A, GROUP_B, equal_var=True)

    result = t_test(GROUP_A, GROUP_B, equal_var=True)

    assert result.variant == "student"
    assert result.statistic == pytest.approx(float(expected.statistic))
    assert result.p_value == pytest.approx(float(expected.pvalue))
    assert result.degrees_of_freedom == pytest.approx(float(expected.df))
    assert result.degrees_of_freedom == pytest.approx(18.0)  # n1 + n2 - 2


def test_welch_t_matches_scipy_directly() -> None:
    expected = scipy_stats.ttest_ind(GROUP_A, GROUP_B, equal_var=False)

    result = t_test(GROUP_A, GROUP_B, equal_var=False)

    assert result.variant == "welch"
    assert result.statistic == pytest.approx(float(expected.statistic))
    assert result.p_value == pytest.approx(float(expected.pvalue))
    assert result.degrees_of_freedom == pytest.approx(float(expected.df))


def test_a_textbook_significant_difference_is_detected_by_the_t_test() -> None:
    # Group A is centered ~10 points above group B with similar spread: a large, easily
    # significant difference, the clearest possible sanity check on the wiring.
    result = t_test(GROUP_A, GROUP_B, equal_var=True)
    assert result.p_value < 0.001
    assert result.statistic > 0  # group A (the first argument) scored higher


# --- Mann-Whitney U -------------------------------------------------------------------------------


def test_mann_whitney_matches_scipy_directly() -> None:
    expected = scipy_stats.mannwhitneyu(GROUP_A, GROUP_B, alternative="two-sided")

    result = mann_whitney_u(GROUP_A, GROUP_B)

    assert result.statistic == pytest.approx(float(expected.statistic))
    assert result.p_value == pytest.approx(float(expected.pvalue))


def test_mann_whitney_detects_the_same_clear_difference() -> None:
    result = mann_whitney_u(GROUP_A, GROUP_B)
    assert result.p_value < 0.001


# --- Cohen's d (no scipy equivalent; checked against a hand computation) -------------------------


def test_cohens_d_matches_a_textbook_hand_computation() -> None:
    # Two groups with means 10 and 12 and a pooled SD of 4 give the textbook "medium-to-large"
    # effect size d = (10 - 12) / 4 = -0.5 (Cohen 1988's own convention example).
    group_a = [6.0, 10.0, 14.0]  # mean 10, sd 4
    group_b = [8.0, 12.0, 16.0]  # mean 12, sd 4

    result = cohens_d(group_a, group_b)

    assert result is not None
    assert result.value == pytest.approx(-0.5, abs=1e-9)
    assert result.ci_low < result.value < result.ci_high


def test_cohens_d_confidence_interval_narrows_with_a_larger_sample() -> None:
    small = cohens_d([1.0, 2.0, 3.0], [2.0, 3.0, 4.0])
    large = cohens_d(list(range(1, 51)), list(range(2, 52)))

    assert small is not None
    assert large is not None
    assert (large.ci_high - large.ci_low) < (small.ci_high - small.ci_low)


def test_cohens_d_is_zero_when_both_groups_are_identical() -> None:
    result = cohens_d([5.0, 5.0, 5.0], [5.0, 5.0, 5.0])
    assert result is not None
    assert result.value == 0.0


def test_cohens_d_requires_at_least_two_observations_per_group() -> None:
    assert cohens_d([1.0], [1.0, 2.0]) is None
    assert cohens_d([1.0, 2.0], [1.0]) is None


# --- compare_groups: choosing the right test -----------------------------------------------------


def test_degenerate_identical_valued_samples_never_produce_nan_and_stay_json_safe() -> None:
    # scipy returns NaN (not an error) for Shapiro-Wilk, Levene and both t-tests when every
    # value in a sample is identical; every field here must come back as a plain, JSON-safe
    # `None` instead, never a NaN float (which json.dumps rejects outright).
    constant_a = [1.0, 1.0, 1.0, 1.0]
    constant_b = [1.0, 1.0, 1.0, 1.0]

    normality = shapiro_wilk(constant_a)
    assert normality.statistic is None
    assert normality.p_value is None
    assert normality.is_normal is None

    levene = levene_test(constant_a, constant_b)
    assert levene.statistic is None
    assert levene.equal_variances is None

    student = t_test(constant_a, constant_b, equal_var=True)
    assert student.statistic is None
    assert student.p_value is None

    result = compare_groups(constant_a, constant_b, outcome="score")
    for value in (
        result.student_t.statistic,
        result.student_t.p_value,
        result.welch_t.statistic,
        result.mann_whitney.p_value,
    ):
        assert value is None or not math.isnan(value)
    assert result.recommended_test in {"welch_t", "mann_whitney"}  # never crashes either way


def test_compare_groups_recommends_students_t_for_two_normal_equal_variance_samples() -> None:
    result = compare_groups(GROUP_A, GROUP_B, outcome="score")
    assert result.normality_experimental.is_normal is True
    assert result.normality_control.is_normal is True
    assert result.levene.equal_variances is True
    assert result.recommended_test == "student_t"
    assert result.student_t is not None
    assert result.welch_t is not None
    assert result.mann_whitney is not None
    assert result.cohens_d is not None


def test_compare_groups_recommends_mann_whitney_for_a_clearly_non_normal_sample() -> None:
    # A heavily right-skewed sample (one huge outlier) reliably fails Shapiro-Wilk.
    skewed = [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 500.0]
    normal_ish = list(GROUP_B)

    result = compare_groups(skewed, normal_ish, outcome="score")

    assert result.normality_experimental.is_normal is False
    assert result.recommended_test == "mann_whitney"


def test_compare_groups_with_too_few_observations_reports_insufficient_data() -> None:
    result = compare_groups([1.0], [1.0, 2.0, 3.0], outcome="score")
    assert result.recommended_test == "insufficient_data"
    assert result.student_t is None
    assert result.welch_t is None
    assert result.mann_whitney is None
    assert result.cohens_d is None


# --- the full report ------------------------------------------------------------------------------


def _row(
    code: str,
    group: StudyGroup,
    language: Language,
    immediate: float | None,
    retention: float | None,
) -> ParticipantScoreRow:
    return ParticipantScoreRow(
        code=code,
        group=group,
        language=language,
        immediate_score=immediate,
        retention_score=retention,
    )


def test_retention_change_is_the_difference_between_retention_and_immediate() -> None:
    row = _row("P-0001", StudyGroup.EXPERIMENTAL, Language.EN, immediate=0.6, retention=0.8)
    assert row.retention_change == pytest.approx(0.2)


def test_retention_change_is_none_when_either_score_is_missing() -> None:
    assert _row("P-0001", StudyGroup.EXPERIMENTAL, Language.EN, None, 0.8).retention_change is None
    assert _row("P-0001", StudyGroup.EXPERIMENTAL, Language.EN, 0.8, None).retention_change is None


def test_build_statistics_report_counts_participants_by_group_and_language() -> None:
    rows = [
        _row("P-0001", StudyGroup.EXPERIMENTAL, Language.EN, 0.8, 0.7),
        _row("P-0002", StudyGroup.EXPERIMENTAL, Language.SQ, 0.6, 0.5),
        _row("P-0003", StudyGroup.CONTROL, Language.EN, 0.4, 0.3),
    ]

    report = build_statistics_report(rows)

    assert report.participant_count == 3
    assert report.group_counts == {"experimental": 2, "control": 1}
    assert report.language_counts == {"en": 2, "sq": 1}
    assert set(report.by_language) == {"en", "sq"}
    assert set(report.by_language["en"]) == {
        "immediate_score",
        "retention_score",
        "retention_change",
    }


def test_build_statistics_report_handles_no_participants() -> None:
    report = build_statistics_report([])
    assert report.participant_count == 0
    assert report.immediate_score.recommended_test == "insufficient_data"
