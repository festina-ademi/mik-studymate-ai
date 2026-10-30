import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderApp, stubFetch } from '../test/utils';

describe('Study Mode guide', () => {
  it('shows the four steps and the study tips at /study', async () => {
    stubFetch({});
    renderApp('/study');

    expect(await screen.findByRole('heading', { level: 1, name: 'Study Mode' })).toBeVisible();
    expect(screen.getByText('Learn the most effective way with MIK')).toBeVisible();

    const steps = screen.getByRole('heading', { name: 'How to study with MIK in 4 steps' })
      .parentElement as HTMLElement;
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

    const tips = screen.getByRole('heading', { name: 'Tips for effective studying' })
      .parentElement as HTMLElement;
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
