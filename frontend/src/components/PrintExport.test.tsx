import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import printCss from '../styles/print.css?raw';
import { PrettyMarkdown } from './PrettyMarkdown';
import { PrintableSection } from './PrintableSection';

// A line-by-line code explanation in the shape the Explanation tab prints: code blocks, inline
// code tokens with their meaning, and bold "what this achieves" summaries.
const EXPLANATION = [
  '```python',
  'def check_password_strength(password):',
  '```',
  '',
  '- `def` - keyword that starts a function definition',
  '- `password` - the parameter holding the text to check',
  '',
  '**This is done to give the check a reusable name.**',
].join('\n');

/** The `@media print` rules, unwrapped so jsdom (which always matches `screen`) applies them. */
function printRules(css: string): string {
  const start = css.indexOf('@media print {');
  const body = css.slice(start + '@media print {'.length, css.lastIndexOf('}'));
  return body.replace(/@page\s*{[^}]*}/, '');
}

let style: HTMLStyleElement;

beforeEach(() => {
  style = document.createElement('style');
  style.textContent = printRules(printCss);
  document.head.append(style);
});

afterEach(() => {
  style.remove();
});

function renderWorkspaceLike(): void {
  render(
    <>
      <header data-testid="app-header">MIK header</header>
      <div data-testid="layout" className="grid">
        <aside data-testid="viewer">Original material viewer</aside>
        <section data-testid="card" style={{ overflow: 'hidden', minHeight: '40rem' }}>
          <nav data-testid="tabs">Summary · Explanation · Quiz</nav>
          <div data-testid="scroller" style={{ overflow: 'auto', maxHeight: '30rem' }}>
            <PrintableSection title="Explanation" documentName="password.py" language="en">
              <PrettyMarkdown value={EXPLANATION} />
            </PrintableSection>
          </div>
        </section>
      </div>
    </>,
  );
}

describe('PDF export print styles', () => {
  it('removes the app chrome from the layout entirely, not just visually', () => {
    renderWorkspaceLike();

    for (const id of ['app-header', 'viewer', 'tabs']) {
      expect(getComputedStyle(screen.getByTestId(id)).display).toBe('none');
    }
    const printButton = screen.getByText('Download PDF').closest('button') as HTMLElement;
    expect(getComputedStyle(printButton).display).toBe('none');
  });

  it('lifts every scroll box and height limit around the printed section', () => {
    renderWorkspaceLike();

    for (const id of ['layout', 'card', 'scroller']) {
      const computed = getComputedStyle(screen.getByTestId(id));
      expect(computed.display).toBe('block');
      expect(computed.overflow).toBe('visible');
      expect(computed.maxHeight).toBe('none');
      expect(computed.position).toBe('static');
    }
  });

  it('keeps all explanation content visible in black ink', () => {
    renderWorkspaceLike();

    const content = [
      // The highlighter splits the code line into token spans: check the block itself.
      screen.getByText((_, element) => element?.tagName === 'PRE'),
      screen.getByText('def', { selector: 'li code' }),
      screen.getByText('password', { selector: 'li code' }),
      screen.getByText(/keyword that starts a function definition/),
      screen.getByText('This is done to give the check a reusable name.'),
    ];
    for (const element of content) {
      const computed = getComputedStyle(element);
      expect(computed.display).not.toBe('none');
      expect(computed.visibility).not.toBe('hidden');
      expect(computed.color).toBe('rgb(0, 0, 0)');
    }
  });

  it('shows the print-only header with the document, date and level', () => {
    renderWorkspaceLike();

    const header = screen.getByText('Explanation — password.py').closest('.print-only');
    if (!header) throw new Error('the print-only header was not rendered');
    expect(getComputedStyle(header).display).toBe('block');
    expect(screen.getByText(/Generated on .* · Level: Intermediate/)).toBeInTheDocument();
  });
});
