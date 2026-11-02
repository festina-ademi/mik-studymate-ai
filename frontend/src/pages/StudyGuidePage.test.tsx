import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderApp, stubFetch } from '../test/utils';

describe('Study Mode guide', () => {
  it('shows the four steps and the study tips at /study', async () => {
    stubFetch({});
    renderApp('/study');

    // The hero fades in on mount, so on a slow machine (CI) it can still be at opacity 0 when it
    // is first found: wait for the animation to finish instead of checking once.
    const title = await screen.findByRole('heading', { level: 1, name: 'Study Mode' });
    await waitFor(() => {
      expect(title).toBeVisible();
      expect(screen.getByText('Learn the most effective way with MIK')).toBeVisible();
    });

    const steps = screen.getByRole('heading', {
      name: 'How to study with MIK in 4 steps',
    }).parentElement;
    if (!steps) throw new Error('the steps heading has no section around it');
    expect(within(steps).getAllByRole('listitem')).toHaveLength(4);
    for (const title of [
      'Upload your material',
      'Listen and read',
      'Ask questions',
      'Test yourself',
    ]) {
      // Present, not "visible": the cards fade in on scroll, which jsdom never triggers.
      expect(within(steps).getByRole('heading', { name: new RegExp(title) })).toBeInTheDocument();
    }

    const tips = screen.getByRole('heading', { name: 'Tips for effective studying' }).parentElement;
    if (!tips) throw new Error('the tips heading has no section around it');
    expect(within(tips).getAllByRole('listitem')).toHaveLength(5);
  });

  it('keeps the navigation entry pointing at the guide', async () => {
    stubFetch({});
    renderApp('/study');

    const nav = await screen.findByRole('navigation', { name: 'Main navigation' });
    expect(within(nav).getByRole('link', { name: 'Study Mode' })).toHaveAttribute('href', '/study');
  });

  it('sends the learner to the workspace from the call to action', async () => {
    stubFetch({});
    const user = userEvent.setup();
    renderApp('/study');

    await user.click(await screen.findByRole('button', { name: 'Start studying now' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'No document selected' }),
    ).toBeVisible();
  });
});
