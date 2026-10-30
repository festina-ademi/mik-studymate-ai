"""Group-comparison statistics for the Study Mode results (PROJECT_SPEC.md section 9).

Every function here is a thin, well-tested wrapper around ``scipy.stats`` (plus the handful of
things scipy does not ship, such as Cohen's d and its confidence interval), so the numbers
reported on the admin dashboard and used in the thesis are exactly what a statistician would
get running the same tests in R, SPSS or scipy directly. Each function is unit-tested against
known reference values (see ``tests/test_study_stats.py``).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal

import numpy as np
from scipy import stats as scipy_stats

from app.domain import Language
from app.study.models import StudyGroup

MIN_SHAPIRO_N = 3
MIN_TEST_N = 2
NORMALITY_ALPHA = 0.05
LEVENE_ALPHA = 0.05

RecommendedTest = Literal["student_t", "welch_t", "mann_whitney", "insufficient_data"]


def _finite_or_none(value: float) -> float | None:
    """A scipy result as a plain float, or ``None`` if it is NaN/infinite.

    scipy returns NaN (not an error) for several of these tests when a sample has zero
    variance (every value identical) — plausible with a small or very early study. NaN is not
    valid JSON, so every scipy statistic passes through here before it reaches a response.
    """
    value = float(value)
    return value if math.isfinite(value) else None


@dataclass(frozen=True)
class DescriptiveStats:
    """N, mean, sample standard deviation (``ddof=1``) and median of one sample."""

    n: int
    mean: float | None
    sd: float | None
    median: float | None


def describe(values: list[float]) -> DescriptiveStats:
    """Descriptive statistics for one sample; ``n=0`` gives all-``None`` (nothing to report)."""
    if not values:
        return DescriptiveStats(n=0, mean=None, sd=None, median=None)
    array = np.asarray(values, dtype=float)
    return DescriptiveStats(
        n=len(array),
        mean=float(np.mean(array)),
        sd=float(np.std(array, ddof=1)) if len(array) > 1 else 0.0,
        median=float(np.median(array)),
    )


@dataclass(frozen=True)
class NormalityResult:
    """Shapiro-Wilk test for normality. ``None`` fields mean the sample was too small (< 3)."""

    n: int
    statistic: float | None
    p_value: float | None
    is_normal: bool | None


def shapiro_wilk(values: list[float]) -> NormalityResult:
    """Shapiro-Wilk normality test for one sample (scipy requires at least 3 observations)."""
    n = len(values)
    if n < MIN_SHAPIRO_N:
        return NormalityResult(n=n, statistic=None, p_value=None, is_normal=None)
    statistic, p_value = scipy_stats.shapiro(values)
    p = _finite_or_none(p_value)
    return NormalityResult(
        n=n,
        statistic=_finite_or_none(statistic),
        p_value=p,
        is_normal=None if p is None else bool(p > NORMALITY_ALPHA),
    )


@dataclass(frozen=True)
class LeveneResult:
    """Levene's test for equality of variances between the two groups."""

    statistic: float | None
    p_value: float | None
    equal_variances: bool | None


def levene_test(group_a: list[float], group_b: list[float]) -> LeveneResult:
    """Levene's test; ``None`` fields when either group has fewer than 2 observations."""
    if len(group_a) < MIN_TEST_N or len(group_b) < MIN_TEST_N:
        return LeveneResult(statistic=None, p_value=None, equal_variances=None)
    statistic, p_value = scipy_stats.levene(group_a, group_b)
    p = _finite_or_none(p_value)
    return LeveneResult(
        statistic=_finite_or_none(statistic),
        p_value=p,
        equal_variances=None if p is None else bool(p > LEVENE_ALPHA),
    )


@dataclass(frozen=True)
class TTestResult:
    """One independent-samples t-test, Student's (equal variance) or Welch's (unequal)."""

    variant: Literal["student", "welch"]
    statistic: float | None
    p_value: float | None
    degrees_of_freedom: float | None


def t_test(group_a: list[float], group_b: list[float], *, equal_var: bool) -> TTestResult:
    """Independent-samples t-test; ``equal_var=False`` runs Welch's version.

    Degrees of freedom come straight from scipy's result (``n1 + n2 - 2`` for Student's, the
    Welch-Satterthwaite approximation for Welch's), rather than a hand-rolled formula. Fields
    are ``None`` when the samples are degenerate (e.g. every value identical in both groups),
    where scipy itself returns NaN.
    """
    result = scipy_stats.ttest_ind(group_a, group_b, equal_var=equal_var)
    return TTestResult(
        variant="welch" if not equal_var else "student",
        statistic=_finite_or_none(result.statistic),
        p_value=_finite_or_none(result.pvalue),
        degrees_of_freedom=_finite_or_none(result.df),
    )


@dataclass(frozen=True)
class MannWhitneyResult:
    """The Mann-Whitney U test, the nonparametric alternative to the t-test."""

    statistic: float | None
    p_value: float | None


def mann_whitney_u(group_a: list[float], group_b: list[float]) -> MannWhitneyResult:
    """The Mann-Whitney U test (two-sided), the nonparametric alternative to the t-test."""
    statistic, p_value = scipy_stats.mannwhitneyu(group_a, group_b, alternative="two-sided")
    return MannWhitneyResult(statistic=_finite_or_none(statistic), p_value=_finite_or_none(p_value))


@dataclass(frozen=True)
class CohensD:
    """Cohen's d (pooled-SD standardized mean difference) with a confidence interval."""

    value: float
    ci_low: float
    ci_high: float


def cohens_d(
    group_a: list[float], group_b: list[float], *, confidence: float = 0.95
) -> CohensD | None:
    """Cohen's d with a normal-approximation CI (Hedges & Olkin 1985).

    ``None`` when either group has fewer than 2 observations (no variance to pool). The
    convention here is ``(mean(group_a) - mean(group_b)) / pooled_sd``, so a positive value
    means group A scored higher.
    """
    n1, n2 = len(group_a), len(group_b)
    if n1 < MIN_TEST_N or n2 < MIN_TEST_N:
        return None
    mean1, mean2 = float(np.mean(group_a)), float(np.mean(group_b))
    var1, var2 = float(np.var(group_a, ddof=1)), float(np.var(group_b, ddof=1))
    pooled_sd = math.sqrt(((n1 - 1) * var1 + (n2 - 1) * var2) / (n1 + n2 - 2))
    if pooled_sd == 0:
        return CohensD(value=0.0, ci_low=0.0, ci_high=0.0)
    d = (mean1 - mean2) / pooled_sd
    standard_error = math.sqrt((n1 + n2) / (n1 * n2) + d**2 / (2 * (n1 + n2 - 2)))
    z = float(scipy_stats.norm.ppf(1 - (1 - confidence) / 2))
    return CohensD(value=d, ci_low=d - z * standard_error, ci_high=d + z * standard_error)


@dataclass(frozen=True)
class GroupComparison:
    """A full comparison of two groups on one outcome (e.g. immediate test score)."""

    outcome: str
    descriptive_experimental: DescriptiveStats
    descriptive_control: DescriptiveStats
    normality_experimental: NormalityResult
    normality_control: NormalityResult
    levene: LeveneResult
    student_t: TTestResult | None
    welch_t: TTestResult | None
    mann_whitney: MannWhitneyResult | None
    cohens_d: CohensD | None
    recommended_test: RecommendedTest


def compare_groups(
    experimental: list[float], control: list[float], *, outcome: str
) -> GroupComparison:
    """Compare the experimental and control samples on one outcome.

    Chooses the appropriate significance test from the normality result (Shapiro-Wilk on each
    group): a parametric t-test (Student's if Levene finds equal variances, otherwise Welch's)
    when both groups look normal, or the nonparametric Mann-Whitney U test when either does not.
    """
    descriptive_experimental = describe(experimental)
    descriptive_control = describe(control)
    normality_experimental = shapiro_wilk(experimental)
    normality_control = shapiro_wilk(control)
    levene = levene_test(experimental, control)

    if len(experimental) < MIN_TEST_N or len(control) < MIN_TEST_N:
        return GroupComparison(
            outcome=outcome,
            descriptive_experimental=descriptive_experimental,
            descriptive_control=descriptive_control,
            normality_experimental=normality_experimental,
            normality_control=normality_control,
            levene=levene,
            student_t=None,
            welch_t=None,
            mann_whitney=None,
            cohens_d=None,
            recommended_test="insufficient_data",
        )

    student = t_test(experimental, control, equal_var=True)
    welch = t_test(experimental, control, equal_var=False)
    mann_whitney = mann_whitney_u(experimental, control)
    effect = cohens_d(experimental, control)

    both_normal = bool(normality_experimental.is_normal) and bool(normality_control.is_normal)
    recommended: RecommendedTest
    if both_normal:
        recommended = "student_t" if levene.equal_variances else "welch_t"
    else:
        recommended = "mann_whitney"

    return GroupComparison(
        outcome=outcome,
        descriptive_experimental=descriptive_experimental,
        descriptive_control=descriptive_control,
        normality_experimental=normality_experimental,
        normality_control=normality_control,
        levene=levene,
        student_t=student,
        welch_t=welch,
        mann_whitney=mann_whitney,
        cohens_d=effect,
        recommended_test=recommended,
    )


@dataclass(frozen=True)
class ParticipantScoreRow:
    """One participant's scores, the input to :func:`build_statistics_report`."""

    code: str
    group: StudyGroup
    language: Language
    immediate_score: float | None
    retention_score: float | None

    @property
    def retention_change(self) -> float | None:
        """``retention_score - immediate_score``, or ``None`` unless both are present."""
        if self.immediate_score is None or self.retention_score is None:
            return None
        return self.retention_score - self.immediate_score


@dataclass(frozen=True)
class StudyStatisticsReport:
    """The full statistics report for the admin dashboard."""

    participant_count: int
    group_counts: dict[str, int]
    language_counts: dict[str, int]
    immediate_score: GroupComparison
    retention_score: GroupComparison
    retention_change: GroupComparison
    by_language: dict[str, dict[str, GroupComparison]]


def _values(rows: list[ParticipantScoreRow], group: StudyGroup, field: str) -> list[float]:
    return [
        value for row in rows if row.group == group and (value := getattr(row, field)) is not None
    ]


def _compare(rows: list[ParticipantScoreRow], field: str) -> GroupComparison:
    experimental = _values(rows, StudyGroup.EXPERIMENTAL, field)
    control = _values(rows, StudyGroup.CONTROL, field)
    return compare_groups(experimental, control, outcome=field)


def build_statistics_report(rows: list[ParticipantScoreRow]) -> StudyStatisticsReport:
    """Build the full report: overall comparisons plus a breakdown by study language."""
    group_counts = {
        group.value: sum(1 for row in rows if row.group == group) for group in StudyGroup
    }
    language_counts = {
        language.value: sum(1 for row in rows if row.language == language) for language in Language
    }

    by_language = {
        language.value: {
            "immediate_score": _compare(
                [row for row in rows if row.language == language], "immediate_score"
            ),
            "retention_score": _compare(
                [row for row in rows if row.language == language], "retention_score"
            ),
            "retention_change": _compare(
                [row for row in rows if row.language == language], "retention_change"
            ),
        }
        for language in Language
    }

    return StudyStatisticsReport(
        participant_count=len(rows),
        group_counts=group_counts,
        language_counts=language_counts,
        immediate_score=_compare(rows, "immediate_score"),
        retention_score=_compare(rows, "retention_score"),
        retention_change=_compare(rows, "retention_change"),
        by_language=by_language,
    )
