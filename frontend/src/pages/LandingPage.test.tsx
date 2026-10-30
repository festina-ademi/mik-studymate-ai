import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import i18n from '../i18n';
import { renderApp, stubFetch } from '../test/utils';

const PROFILE = {
  firstName: 'Festina',
  lastName: 'Ademi',
  birthYear: 2000,
  role: 'student',
  language: 'en',
  level: 'beginner',
  completedAt: '2026-01-01T00:00:00.000Z',
};

describe('landing page', () => {
  it('renders every section in order with a single h1', () => {
    stubFetch({ status: 'ok', version: '0.1.0' });
    const { container } = renderApp('/');

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);

    const sections = ['problem', 'features', 'how-it-works', 'teacher', 'audience'].map((id) =>
      container.querySelector(`main section#${id}`),
    );
    sections.forEach((section) => {
      expect(section).not.toBeNull();
    });

    const headings = screen
      .getAllByRole('heading', { level: 2 })
      .map((heading) => heading.textContent);
    expect(headings).toEqual([
      "Studying shouldn't feel like this",
      'Everything you need to study one document, end to end',
      'From upload to understanding in three steps',
      'Your virtual teacher',
      'Built for people who learn from dense material',
      'Ready to study smarter?',
    ]);

    // Hero comes first, then the sections, then the footer.
    const order = Array.from(
      container.querySelectorAll('main section, main footer'),
      (node) => node.id || node.tagName.toLowerCase(),
    );
    expect(order).toEqual([
      'section',
      'problem',
      'features',
      'how-it-works',
      'teacher',
      'audience',
      'section',
      'footer',
    ]);
  });

  it('shows five feature cards and three steps', () => {
    stubFetch({ status: 'ok', version: '0.1.0' });
    const { container } = renderApp('/');

    expect(container.querySelectorAll('#features article')).toHaveLength(5);
    expect(container.querySelectorAll('#how-it-works ol > li')).toHaveLength(3);
    expect(screen.getByText('Chat with your material')).toBeInTheDocument();
    expect(screen.getByText('A virtual teacher that speaks')).toBeInTheDocument();
  });

  it('shows the virtual teacher section with its avatar, bubble, four bullets and a working CTA', () => {
    stubFetch({ status: 'ok', version: '0.1.0' });
    const { container } = renderApp('/');

    const section = container.querySelector('#teacher');
    expect(section).not.toBeNull();
    const teacher = within(section as HTMLElement);

    expect(
      teacher.getByRole('img', {
        name: 'A friendly virtual learning companion, currently speaking',
      }),
    ).toBeInTheDocument();
    expect(teacher.getByText("Let's learn together!")).toBeInTheDocument();
    expect(teacher.getByText('Reads materials aloud')).toBeInTheDocument();
    expect(teacher.getByText('Pauses when you ask questions')).toBeInTheDocument();
    expect(teacher.getByText('Adapts explanations to your level')).toBeInTheDocument();
    expect(teacher.getByText('Speaks Albanian and English naturally')).toBeInTheDocument();
    expect(teacher.getByRole('link', { name: 'Try the avatar' })).toHaveAttribute(
      'href',
      '/welcome',
    );
  });

  it('scrolls the "Teacher" nav link to the new section, on desktop and in the mobile menu', async () => {
    stubFetch({ status: 'ok', version: '0.1.0' });
    const user = userEvent.setup();
    renderApp('/');

    expect(screen.getByRole('link', { name: 'Teacher' })).toHaveAttribute('href', '/#teacher');

    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    const mobileMenuLinks = screen.getAllByRole('link', { name: 'Teacher' });
    expect(mobileMenuLinks).toHaveLength(2);
  });

  it('gives the hero and audience photos meaningful alt text, sized to avoid layout shift', () => {
    stubFetch({ status: 'ok', version: '0.1.0' });
    renderApp('/');

    const hero = screen.getByRole('img', {
      name: 'A student taking notes from their study material next to a laptop',
    });
    expect(hero).toHaveAttribute('src', '/images/hero-study.jpg');
    expect(hero).toHaveAttribute('width', '600');
    expect(hero).toHaveAttribute('height', '400');

    const audience = screen.getByRole('img', {
      name: 'A student at a desk with a laptop and colorful sticky notes',
    });
    expect(audience).toHaveAttribute('src', '/images/audience-student.jpg');
    expect(audience).toHaveAttribute('width', '600');
    expect(audience).toHaveAttribute('height', '862');
    expect(audience).toHaveAttribute('loading', 'lazy');
  });

  it('marks the orbiting feature pills as decorative, repeating each label once per language', () => {
    stubFetch({ status: 'ok', version: '0.1.0' });
    renderApp('/');

    // The photo's alt text is the hero visual's only accessible content; the four pills repeat
    // what the Features section below already describes in full, so they sit under aria-hidden.
    for (const label of ['Summary', 'Quiz', 'Explanation', 'Chat']) {
      const pill = screen.getByText(label);
      expect(pill.closest('[aria-hidden="true"]')).not.toBeNull();
    }
  });

  it('routes the hero and closing calls-to-action to onboarding without a profile', () => {
    stubFetch({ status: 'ok', version: '0.1.0' });
    renderApp('/');

    expect(screen.getByRole('link', { name: 'Start for free' })).toHaveAttribute(
      'href',
      '/welcome',
    );
    const closing = screen.getByRole('region', { name: 'Ready to study smarter?' });
    expect(within(closing).getByRole('link', { name: 'Get started' })).toHaveAttribute(
      'href',
      '/welcome',
    );
  });

  it('routes the calls-to-action to the workspace when a profile exists', () => {
    stubFetch({ status: 'ok', version: '0.1.0' });
    window.localStorage.setItem('userProfile', JSON.stringify(PROFILE));
    renderApp('/');

    expect(screen.getByRole('link', { name: 'Start for free' })).toHaveAttribute(
      'href',
      '/workspace',
    );
  });

  it('points the secondary hero action at the how-it-works section', () => {
    stubFetch({ status: 'ok', version: '0.1.0' });
    renderApp('/');

    expect(screen.getByRole('link', { name: 'See how it works' })).toHaveAttribute(
      'href',
      '/#how-it-works',
    );
  });

  it('has no untranslated keys or connection indicator in either language', async () => {
    stubFetch({ status: 'ok', version: '0.1.0' });
    const user = userEvent.setup();
    const { container } = renderApp('/');

    for (const language of ['en', 'sq']) {
      await i18n.changeLanguage(language);
      const text = container.textContent;
      expect(text).not.toMatch(/\b(landing|header)\.[a-zA-Z]+/);
      expect(text).not.toMatch(/Serveri është i lidhur|Backend connected/);
    }
    expect(screen.getByText('Gati të mësosh më zgjuar?')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Fillo falas' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'English (EN)' }));
    expect(screen.getByRole('link', { name: 'Start for free' })).toBeInTheDocument();
  });

  it('has a footer with only the credit line', () => {
    stubFetch({ status: 'ok', version: '0.1.0' });
    const { container } = renderApp('/');

    const footer = container.querySelector('main footer');
    expect(footer?.textContent).toBe('Festina Ademi · 2026');
    expect(footer?.querySelectorAll('a, button, img, nav, input')).toHaveLength(0);
    expect(footer?.querySelector('p')).toHaveClass('text-center', 'text-sm', 'text-fg-muted');
  });

  it('is branded MIK with the new logo in both languages', async () => {
    stubFetch({ status: 'ok', version: '0.1.0' });
    const { container } = renderApp('/');

    for (const language of ['en', 'sq']) {
      await i18n.changeLanguage(language);
      expect(container.textContent).not.toMatch(/StudyMate/);
      const logo = within(screen.getByRole('banner')).getByRole('img', { name: 'MIK' });
      expect(logo).toHaveAttribute('src', '/images/logo-cropped.png');
    }
  });
});
