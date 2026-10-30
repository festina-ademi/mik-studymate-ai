import { Award, BookOpen, Compass, Target, Trophy } from 'lucide-react';
import { motion } from 'framer-motion';
import { useState, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge } from '../Badge';
import { Button } from '../Button';
import { MasteryPanel } from '../mastery/MasteryPanel';
import { ReexplainCard } from '../mastery/ReexplainCard';
import { PrintableSection } from '../PrintableSection';
import { ProgressBar } from '../ProgressBar';
import { QuizConfettiCanvas } from './QuizConfettiCanvas';
import { QuizMasteryBarChart } from './QuizMasteryBarChart';
import { QuizScoreDonut } from './QuizScoreDonut';
import { getScoreBand, shouldCelebrate, type ScoreBand } from './scoreBand';
import { Skeleton } from '../Skeleton';
import { Tooltip } from '../Tooltip';
import type {
  ApiLanguage,
  MasteryOverviewEntry,
  QuizResultsResponse,
  WeakTopicEntry,
} from '../../lib/api';
import type { StudyLevel } from '../../hooks/useLevel';
import { usePrefersReducedMotion } from '../../hooks/useReducedMotion';

const BAND_ICON: Record<ScoreBand, ComponentType<{ className?: string }>> = {
  excellent: Trophy,
  great: Award,
  onTrack: Target,
  gettingThere: Compass,
  newMaterial: BookOpen,
};

const BAND_I18N_KEYS: Record<ScoreBand, { title: string; body: string }> = {
  excellent: { title: 'quizBandExcellentTitle', body: 'quizBandExcellentBody' },
  great: { title: 'quizBandGreatTitle', body: 'quizBandGreatBody' },
  onTrack: { title: 'quizBandOnTrackTitle', body: 'quizBandOnTrackBody' },
  gettingThere: { title: 'quizBandGettingThereTitle', body: 'quizBandGettingThereBody' },
  newMaterial: { title: 'quizBandNewMaterialTitle', body: 'quizBandNewMaterialBody' },
};

interface QuizResultsViewProps {
  documentId: string;
  documentName: string;
  level: StudyLevel;
  language: ApiLanguage;
  results: QuizResultsResponse | null;
  isLoading: boolean;
  documentWeakTopics: WeakTopicEntry[];
  masteryEntries: MasteryOverviewEntry[];
  isLoadingMastery: boolean;
  canRetryWrong: boolean;
  onRetryWrong: () => void;
  onNewQuiz: () => void;
  onJumpToReference: (reference: string) => void;
  /** Refetches the document's mastery after a weak-topic retest changed it on the server. */
  onMasteryUpdated: () => void;
}

export function QuizResultsView({
  documentId,
  documentName,
  level,
  language,
  results,
  isLoading,
  documentWeakTopics,
  masteryEntries,
  isLoadingMastery,
  canRetryWrong,
  onRetryWrong,
  onNewQuiz,
  onJumpToReference,
  onMasteryUpdated,
}: QuizResultsViewProps) {
  const { t } = useTranslation();
  const prefersReducedMotion = usePrefersReducedMotion();
  // Explicit reveals (from the "Explain my weak topics" button); the weakest topic is shown
  // automatically on top of these, derived below as `visibleWeakTopics` without needing an effect.
  const [revealedWeakTopics, setRevealedWeakTopics] = useState<string[]>([]);

  const weakestFirst = [...masteryEntries]
    .filter((entry) => entry.level === 'weak')
    .sort((a, b) => a.mastery - b.mastery);
  const autoRevealedTopic = weakestFirst[0]?.topic;
  const visibleWeakTopics =
    autoRevealedTopic && !revealedWeakTopics.includes(autoRevealedTopic)
      ? [autoRevealedTopic, ...revealedWeakTopics]
      : revealedWeakTopics;

  const nextWeakTopic = weakestFirst.find((entry) => !visibleWeakTopics.includes(entry.topic));

  if (isLoading || !results) {
    return <Skeleton lines={6} />;
  }

  const percentage = Math.round(results.score * 100);
  const band = getScoreBand(percentage);
  const BandIcon = BAND_ICON[band];
  const celebrate = shouldCelebrate(percentage, prefersReducedMotion);

  return (
    <PrintableSection
      title={t('workspace.printQuizResultsTitle')}
      documentName={documentName}
      language={language}
    >
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-5"
      >
        <div className="relative overflow-hidden rounded-2xl border border-primary/30 bg-primary-soft p-5">
          <QuizConfettiCanvas active={celebrate} />
          <div className="relative space-y-1 text-center">
            <p className="text-sm font-medium uppercase tracking-[0.08em] text-primary-soft-fg">
              {t('workspace.quizResults')}
            </p>
            <QuizScoreDonut percentage={percentage} />
            <p className="text-sm text-primary-soft-fg">
              {results.correct_count}/{results.total_questions} &middot;{' '}
              {t('workspace.quizScoreLabel')}: {percentage}%
            </p>
          </div>

          <div className="relative mt-4 flex items-start justify-center gap-3 text-center">
            <BandIcon className="mt-0.5 size-6 shrink-0 text-primary-soft-fg" />
            <div>
              <h3 className="text-xl font-semibold text-fg">
                {t(`workspace.${BAND_I18N_KEYS[band].title}`)}
              </h3>
              <p className="text-sm text-fg-muted">{t(`workspace.${BAND_I18N_KEYS[band].body}`)}</p>
            </div>
          </div>

          {results.peeked ? (
            <p className="relative mt-3 text-center text-xs text-fg-muted">
              {t('workspace.quizPeekedDisclosure')}
            </p>
          ) : null}
        </div>

        <QuizMasteryBarChart entries={masteryEntries} />

        <div className="space-y-3">
          <p className="text-sm font-medium text-fg-muted">{t('workspace.quizTopicBreakdown')}</p>
          {results.topic_breakdown.map((topic) => (
            <div
              key={topic.topic}
              className="rounded-2xl border border-border bg-surface-muted p-3"
            >
              <div className="mb-2 flex items-center justify-between gap-2 text-sm text-fg">
                <span>{topic.topic}</span>
                <span className="font-medium">
                  {topic.correct}/{topic.total}
                </span>
              </div>
              <ProgressBar
                value={topic.average_score * 100}
                label={`${String(Math.round(topic.average_score * 100))}%`}
              />
            </div>
          ))}
        </div>

        <MasteryPanel entries={masteryEntries} isLoading={isLoadingMastery} />

        {documentWeakTopics.length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm font-medium text-fg-muted">
              {t('workspace.quizWeakTopicsOverall')}
            </p>
            <div className="flex flex-wrap gap-2">
              {documentWeakTopics.map((entry) => (
                <Badge key={entry.topic}>{entry.topic}</Badge>
              ))}
            </div>
          </div>
        ) : null}

        {visibleWeakTopics.map((topic) => {
          const entry = masteryEntries.find((item) => item.topic === topic);
          return (
            <ReexplainCard
              key={topic}
              documentId={documentId}
              topic={topic}
              mastery={entry?.mastery ?? 0}
              level={level}
              language={language}
              onJumpToReference={onJumpToReference}
              onMasteryUpdated={(updatedTopic) => {
                // Keep this card (and its retest outcome) on screen even if the refreshed
                // mastery no longer classifies the topic as weak.
                setRevealedWeakTopics((previous) =>
                  previous.includes(updatedTopic) ? previous : [...previous, updatedTopic],
                );
                onMasteryUpdated();
              }}
            />
          );
        })}

        <div className="grid gap-3 print-hide md:grid-cols-3">
          <Button variant="secondary" onClick={onRetryWrong} disabled={!canRetryWrong}>
            {t('workspace.quizRetryWrong')}
          </Button>
          <Button variant="secondary" onClick={onNewQuiz}>
            {t('workspace.quizNewQuiz')}
          </Button>
          {nextWeakTopic ? (
            <Button
              variant="secondary"
              onClick={() => {
                setRevealedWeakTopics((previous) => [...previous, nextWeakTopic.topic]);
              }}
            >
              {t('workspace.quizExplainWeakTopics')}
            </Button>
          ) : (
            <Tooltip
              content={
                weakestFirst.length === 0
                  ? t('workspace.quizExplainWeakTooltipNone')
                  : t('workspace.quizExplainWeakTooltipAllShown')
              }
            >
              <Button variant="secondary" disabled className="w-full">
                {t('workspace.quizExplainWeakTopics')}
              </Button>
            </Tooltip>
          )}
        </div>
      </motion.div>
    </PrintableSection>
  );
}
