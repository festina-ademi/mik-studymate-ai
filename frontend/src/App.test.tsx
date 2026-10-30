import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderApp, stubFetch } from './test/utils';

describe('language toggle', () => {
  it('switches a visible text between English and Albanian and remembers the choice', async () => {
    stubFetch({ status: 'ok', version: '0.1.0' });
    const user = userEvent.setup();
    renderApp();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Learn faster from your lectures.',
    );

    await user.click(screen.getByRole('button', { name: 'Shqip (SQ)' }));

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Mëso më shpejt nga ligjëratat e tua.',
    );
    expect(screen.getByRole('button', { name: 'Shqip (SQ)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(document.documentElement.lang).toBe('sq');
    expect(window.localStorage.getItem('studymate.language')).toBe('sq');

    await user.click(screen.getByRole('button', { name: 'English (EN)' }));

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Learn faster from your lectures.',
    );
  });
});

describe('theme toggle', () => {
  it('applies and remembers the chosen theme', async () => {
    stubFetch({ status: 'ok', version: '0.1.0' });
    const user = userEvent.setup();
    renderApp();

    expect(document.documentElement.dataset.theme).toBe('light');

    await user.click(screen.getByRole('button', { name: 'Dark' }));

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem('studymate.theme')).toBe('dark');
  });
});

describe('routing', () => {
  it('shows a translated not-found page for unknown URLs', () => {
    stubFetch({ status: 'ok', version: '0.1.0' });
    renderApp('/does-not-exist');

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Page not found');
  });
});
