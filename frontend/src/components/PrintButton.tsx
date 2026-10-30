import { Printer } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from './Button';

/**
 * Triggers the browser's native print dialog, which on every desktop OS (including Windows,
 * with no extra software) offers "Save as PDF" as a print destination. Paired with the
 * `.print-area`/`.print-hide` rules in `styles/print.css`, only the nearest `.print-area`
 * ancestor's content is included on the printed/saved page — see that file for the mechanism.
 */
export function PrintButton() {
  const { t } = useTranslation();
  return (
    <Button
      variant="secondary"
      size="sm"
      className="print-hide"
      onClick={() => {
        window.print();
      }}
    >
      <Printer aria-hidden className="size-4" />
      {t('workspace.downloadPdf')}
    </Button>
  );
}
