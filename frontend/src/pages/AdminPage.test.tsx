import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { renderApp } from '../test/utils';

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

type FetchMock = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const OVERVIEW = {
  total_participants: 2,
  groups: [
    {
      group: 'experimental',
      total: 1,
      withdrawn: 0,
      immediate_completed: 1,
      questionnaire_completed: 1,
      retention_completed: 0,
    },
    {
      group: 'control',
      total: 1,
      withdrawn: 0,
      immediate_completed: 1,
      questionnaire_completed: 0,
      retention_completed: 0,
    },
  ],
  active_material: 'Week 1',
  active_test: 'Sample Test',
};

function stubAdminFetch(options: { signedInInitially?: boolean } = {}): void {
  let signedIn = options.signedInInitially ?? false;

  const fetchMock = vi.fn<FetchMock>((input, init) => {
    const url = requestUrl(input);
    const method = init?.method ?? 'GET';

    if (url.endsWith('/api/health')) {
      return Promise.resolve(Response.json({ status: 'ok', version: '0.1.0' }));
    }
    if (url.endsWith('/api/admin/me')) {
      return Promise.resolve(Response.json({ signed_in: signedIn }));
    }
    if (url.endsWith('/api/admin/login') && method === 'POST') {
      const body =
        typeof init?.body === 'string' ? (JSON.parse(init.body) as { password: string }) : null;
      if (body?.password === 'correct-password') {
        signedIn = true;
        return Promise.resolve(Response.json({ signed_in: true }));
      }
      return Promise.resolve(
        Response.json(
          {
            error: {
              code: 'invalid_admin_password',
              message_key: 'errors.invalid_admin_password',
              details: {},
            },
          },
          { status: 401 },
        ),
      );
    }
    if (url.endsWith('/api/admin/overview')) {
      return Promise.resolve(Response.json(OVERVIEW));
    }
    if (url.endsWith('/api/admin/materials')) {
      return Promise.resolve(Response.json([]));
    }
    if (url.endsWith('/api/admin/tests')) {
      return Promise.resolve(Response.json([]));
    }
    if (url.endsWith('/api/admin/results')) {
      return Promise.resolve(Response.json([]));
    }
    if (url.endsWith('/api/admin/statistics')) {
      const insufficient = {
        outcome: 'x',
        descriptive_experimental: { n: 0, mean: null, sd: null, median: null },
        descriptive_control: { n: 0, mean: null, sd: null, median: null },
        normality_experimental: { n: 0, statistic: null, p_value: null, is_normal: null },
        normality_control: { n: 0, statistic: null, p_value: null, is_normal: null },
        levene: { statistic: null, p_value: null, equal_variances: null },
        student_t: null,
        welch_t: null,
        mann_whitney: null,
        cohens_d: null,
        recommended_test: 'insufficient_data',
      };
      return Promise.resolve(
        Response.json({
          participant_count: 0,
          group_counts: { experimental: 0, control: 0 },
          language_counts: { en: 0, sq: 0 },
          immediate_score: insufficient,
          retention_score: insufficient,
          retention_change: insufficient,
          by_language: { en: {}, sq: {} },
        }),
      );
    }
    return Promise.resolve(
      Response.json(
        { error: { code: 'not_found', message_key: 'errors.not_found', details: {} } },
        { status: 404 },
      ),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
}

// AdminPage is a lazy route chunk that pulls in recharts; transforming it cold can take many
// seconds on a busy machine, so load it once up front instead of inside the first test's timeout.
beforeAll(async () => {
  await import('./AdminPage');
}, 90_000);

describe('admin login', () => {
  it('shows the login form when not signed in', async () => {
    stubAdminFetch();
    renderApp('/admin');

    // AdminPage is a lazily-loaded route chunk (see App.tsx); a generous timeout keeps this
    // assertion reliable when the test suite runs many files in parallel.
    expect(await screen.findByText('Admin sign in', {}, { timeout: 10_000 })).toBeInTheDocument();
  });

  it('shows an error for a wrong password and keeps the login form', async () => {
    stubAdminFetch();
    const user = userEvent.setup();
    renderApp('/admin');

    await screen.findByText('Admin sign in', {}, { timeout: 10_000 });
    await user.type(screen.getByLabelText('Password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('That password is not correct.')).toBeInTheDocument();
    expect(screen.getByText('Admin sign in')).toBeInTheDocument();
  });

  it('reaches the dashboard with the correct password', async () => {
    stubAdminFetch();
    const user = userEvent.setup();
    renderApp('/admin');

    await screen.findByText('Admin sign in', {}, { timeout: 10_000 });
    await user.type(screen.getByLabelText('Password'), 'correct-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Study Mode admin')).toBeInTheDocument();
    expect(await screen.findByText('Week 1')).toBeInTheDocument();
    expect(screen.getByText('Sample Test')).toBeInTheDocument();
  });

  it('restores an existing session without showing the login form', async () => {
    stubAdminFetch({ signedInInitially: true });
    renderApp('/admin');

    expect(
      await screen.findByText('Study Mode admin', {}, { timeout: 10_000 }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Admin sign in')).not.toBeInTheDocument();
  });
});
