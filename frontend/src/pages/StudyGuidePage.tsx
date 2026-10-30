import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Reveal } from '../components/landing/Reveal';

const STEPS = [
  { key: 'upload', icon: '📄' },
  { key: 'listen', icon: '🎧' },
  { key: 'ask', icon: '💬' },
  { key: 'test', icon: '✅' },
] as const;

const TIPS = [
  { key: 'pomodoro', icon: '⏱️' },
  { key: 'level', icon: '🎯' },
  { key: 'review', icon: '🔁' },
  { key: 'notes', icon: '📝' },
  { key: 'rest', icon: '💤' },
] as const;

/**
 * Study Mode's public page: a short guide to studying effectively with MIK. The thesis
 * experiment itself lives at `/study/participate` (and `/study/return`), reached through the link
 * the researcher gives participants, so the guide can take the navigation entry.
 */
export function StudyGuidePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className="mx-auto max-w-4xl space-y-14 py-4">
      <motion.header
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="space-y-3 text-center"
      >
        <h1 className="text-4xl font-semibold tracking-tight text-fg sm:text-5xl">
          {t('studyGuide.title')}
        </h1>
        <p className="text-lg text-fg-muted">{t('studyGuide.subtitle')}</p>
      </motion.header>

      <section aria-labelledby="study-guide-steps" className="space-y-6">
        <h2 id="study-guide-steps" className="text-2xl font-semibold text-fg">
          {t('studyGuide.stepsTitle')}
        </h2>
        <ol className="grid gap-4 sm:grid-cols-2">
          {STEPS.map((step, index) => (
            <li key={step.key}>
              <Reveal delay={index * 0.06} className="h-full">
                <Card className="flex h-full gap-4 p-5 transition-transform duration-200 hover:-translate-y-0.5">
                  <span
                    aria-hidden
                    className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-2xl"
                  >
                    {step.icon}
                  </span>
                  <div className="space-y-1.5">
                    <h3 className="font-semibold text-fg">
                      <span className="mr-1.5 text-fg-muted">{index + 1}.</span>
                      {t(`studyGuide.steps.${step.key}.title`)}
                    </h3>
                    <p className="text-sm leading-6 text-fg-muted">
                      {t(`studyGuide.steps.${step.key}.body`)}
                    </p>
                  </div>
                </Card>
              </Reveal>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="study-guide-tips" className="space-y-6">
        <h2 id="study-guide-tips" className="text-2xl font-semibold text-fg">
          {t('studyGuide.tipsTitle')}
        </h2>
        <Reveal>
          <Card className="p-2 sm:p-4">
            <ul className="divide-y divide-border">
              {TIPS.map((tip) => (
                <li key={tip.key} className="flex items-start gap-4 px-3 py-4">
                  <span aria-hidden className="text-xl leading-7">
                    {tip.icon}
                  </span>
                  <p className="leading-7 text-fg">
                    <span className="font-semibold">{t(`studyGuide.tips.${tip.key}.title`)}</span>
                    <span className="text-fg-muted"> — {t(`studyGuide.tips.${tip.key}.body`)}</span>
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        </Reveal>
      </section>

      <Reveal className="flex justify-center pb-4">
        <Button
          size="lg"
          className="h-14 px-8 text-lg"
          onClick={() => {
            void navigate('/workspace');
          }}
        >
          {t('studyGuide.cta')}
          <ArrowRight aria-hidden className="size-5" />
        </Button>
      </Reveal>
    </div>
  );
}
