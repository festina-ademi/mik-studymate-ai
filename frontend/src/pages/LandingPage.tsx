import { motion } from 'framer-motion';
import { FileText, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** Placeholder landing page; the upload workspace arrives in a later phase. */
export function LandingPage() {
  const { t } = useTranslation();

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="mx-auto flex max-w-2xl flex-col items-center gap-8 text-center"
    >
      <span className="inline-flex items-center gap-2 rounded-full bg-primary-soft px-3 py-1 text-sm font-medium text-primary-soft-fg">
        <Sparkles aria-hidden className="size-4" />
        {t('landing.badge')}
      </span>
      <div className="flex flex-col gap-4">
        <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          {t('landing.title')}
        </h1>
        <p className="text-lg text-fg-muted text-pretty">{t('landing.subtitle')}</p>
      </div>
      <div className="flex w-full flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-surface p-8 shadow-soft">
        <FileText aria-hidden className="size-8 text-primary" />
        <h2 className="text-lg font-semibold">{t('landing.placeholderTitle')}</h2>
        <p className="text-fg-muted">{t('landing.placeholderText')}</p>
      </div>
    </motion.section>
  );
}
