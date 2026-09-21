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
      'Learn any lecture faster.',
    );

    await user.click(screen.getByRole('button', { name: 'Shqip (SQ)' }));

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Mëso çdo leksion më shpejt.',
    );
    expect(screen.getByRole('button', { name: 'Shqip (SQ)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(document.documentElement.lang).toBe('sq');
    expect(window.localStorage.getItem('studymate.language')).toBe('sq');

    await user.click(screen.getByRole('button', { name: 'English (EN)' }));

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Learn any lecture faster.',
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

describe('backend status', () => {
  it('shows that the backend is connected', async () => {
    stubFetch({ status: 'ok', version: '0.1.0' });
    renderApp();

    expect(await screen.findByText('Backend connected')).toBeInTheDocument();
  });

  it('shows that the backend is unavailable when the API returns an error', async () => {
    stubFetch(
      { error: { code: 'internal_error', message_key: 'errors.internal_error', details: {} } },
      500,
    );
    renderApp();

    const status = await screen.findByText('Backend unavailable');
    expect(status).toHaveAttribute(
      'title',
      'A server error occurred. Please try again in a moment.',
    );
  });
});

describe('routing', () => {
  it('shows a translated not-found page for unknown URLs', () => {
    stubFetch({ status: 'ok', version: '0.1.0' });
    renderApp('/does-not-exist');

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Page not found');
  });
});
