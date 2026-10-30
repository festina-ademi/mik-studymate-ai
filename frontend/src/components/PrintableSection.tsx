import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { ApiLanguage } from '../lib/api';
import { useLevel } from '../hooks/useLevel';
import { PrintButton } from './PrintButton';

interface PrintableSectionProps {
  /** Heading shown only on the printed page, e.g. "Summary" / "Quiz results". */
  title: string;
  documentName: string;
  language: ApiLanguage;
  children: ReactNode;
}

/**
 * Wraps generated content (summary, explanation, quiz results) so it can be downloaded as a
 * clean, on-brand PDF via the browser's print dialog. See `styles/print.css` for the
 * `.print-area`/`.print-hide`/`.print-only` mechanism this relies on.
 */
export function PrintableSection({
  title,
  documentName,
  language,
  children,
}: PrintableSectionProps) {
  const { t } = useTranslation();
  const { level } = useLevel();
  const generatedOn = new Intl.DateTimeFormat(language === 'sq' ? 'sq-AL' : 'en-US', {
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(new Date());

  return (
    <div className="print-area space-y-4">
      <div className="flex justify-end">
        <PrintButton />
      </div>
      <div className="print-only space-y-1 border-b border-black pb-3">
        <p className="text-lg font-semibold">{t('app.name')}</p>
        <p className="text-base font-medium">
          {title} — {documentName}
        </p>
        <p className="text-xs">
          {t('workspace.printGeneratedOn', { date: generatedOn })} · {t('header.levelLabel')}:{' '}
          {t(`level.${level}`)}
        </p>
      </div>
      {children}
    </div>
  );
}
