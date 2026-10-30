import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderApp, stubFetch } from '../test/utils';

type FetchMock = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

/** Health + the profile-menu's own endpoints, so the delete flow can be exercised end to end. */
function stubUserDataFetch(deleteStatus = 200): void {
  const fetchMock = vi.fn<FetchMock>((input, init) => {
    const url = requestUrl(input);
    if (url.endsWith('/api/health')) {
      return Promise.resolve(Response.json({ status: 'ok', version: '0.1.0' }));
    }
    if (url.endsWith('/api/user/all-data') && init?.method === 'DELETE') {
      if (deleteStatus !== 200) {
        return Promise.resolve(
          Response.json(
            { error: { code: 'http_error', message_key: 'errors.unknown' } },
            { status: deleteStatus },
          ),
        );
      }
      return Promise.resolve(Response.json({ deleted_documents: 1 }));
    }
    return Promise.resolve(Response.json({}, { status: 404 }));
  });
  vi.stubGlobal('fetch', fetchMock);
}

function banner(): HTMLElement {
  return screen.getByRole('banner');
}

const PROFILE = {
  firstName: 'Festina',
  lastName: 'Ademi',
  birthYear: 2000,
  role: 'student',
  language: 'en',
  level: 'beginner',
  completedAt: '2026-01-01T00:00:00.000Z',
};

describe('header', () => {
  it('renders the brand, nav links, controls and call-to-action', () => {
    stubFetch({ status: 'ok', version: '0.1.0' });
    renderApp('/');

    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(within(nav).getByRole('link', { name: 'Features' })).toHaveAttribute(
      'href',
      '/#features',
    );
    expect(within(nav).getByRole('link', { name: 'How it works' })).toHaveAttribute(
      'href',
      '/#how-it-works',
    );
    expect(within(nav).getByRole('link', { name: "Who it's for" })).toHaveAttribute(
      'href',
      '/#audience',
    );
    expect(within(nav).getByRole('link', { name: 'Study Mode' })).toHaveAttribute('href', '/study');
    expect(within(banner()).getByRole('link', { name: 'MIK home' })).toHaveAttribute('href', '/');
    // The level toggle only affects the workspace's Explanation tab, so it lives there instead.
    expect(screen.queryByRole('group', { name: 'Level' })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Language' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Theme' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument();
  });

  it('sends the call-to-action to onboarding, then to the workspace once a profile exists', () => {
    stubFetch({ status: 'ok', version: '0.1.0' });
    const header = renderApp('/');
    expect(
      within(banner()).getByRole('link', { name: 'Get started', hidden: true }),
    ).toHaveAttribute('href', '/welcome');
    header.unmount();

    window.localStorage.setItem('userProfile', JSON.stringify(PROFILE));
    renderApp('/');
    expect(
      within(banner()).getByRole('link', { name: 'Get started', hidden: true }),
    ).toHaveAttribute('href', '/workspace');
  });

  it('offers no profile reset anywhere, in the bar or the mobile menu, in either language', async () => {
    stubFetch({ status: 'ok', version: '0.1.0' });
    window.localStorage.setItem('userProfile', JSON.stringify(PROFILE));
    const user = userEvent.setup();
    renderApp('/');

    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(screen.queryByRole('button', { name: 'Reset profile' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument();

    // The bar and the open mobile menu each have a language toggle; either one switches.
    const [albanian] = within(banner()).getAllByRole('button', { name: 'Shqip (SQ)' });
    if (!albanian) throw new Error('no Albanian language button');
    await user.click(albanian);
    expect(banner()).not.toHaveTextContent('Rivendos profilin');
    expect(banner()).not.toHaveTextContent('Reset profile');
  });

  it('lines the logo up with the landing hero by sharing its container width and padding', () => {
    stubFetch({ status: 'ok', version: '0.1.0' });
    renderApp('/');

    const brandGroup = screen.getByRole('navigation', { name: 'Main navigation' }).parentElement;
    if (!brandGroup) throw new Error('the navigation has no brand group around it');
    const heroContainer = screen.getByRole('heading', { level: 1 }).closest('.max-w-7xl');
    const container = ['mx-auto', 'max-w-7xl', 'px-4', 'sm:px-6'];
    expect(brandGroup.parentElement).toHaveClass(...container);
    expect(heroContainer).toHaveClass(...container);
    expect(within(brandGroup).getByRole('link', { name: 'MIK home' })).toBeInTheDocument();
    // Narrower screens keep the menu button rather than squeezing the links in.
    expect(screen.getByRole('button', { name: 'Open menu' }).parentElement).toHaveClass(
      'nav:hidden',
    );
  });

  it('opens and closes the mobile menu, including with Escape', async () => {
    stubFetch({ status: 'ok', version: '0.1.0' });
    const user = userEvent.setup();
    renderApp('/');

    const toggle = screen.getByRole('button', { name: 'Open menu' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);

    expect(screen.getByRole('button', { name: 'Close menu' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getAllByRole('link', { name: 'Features' })).toHaveLength(2);

    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Open menu' })).toHaveFocus();
    await waitFor(() => {
      expect(screen.getAllByRole('link', { name: 'Features' })).toHaveLength(1);
    });
  });

  it('never shows a backend connection indicator', () => {
    stubFetch({ status: 'ok', version: '0.1.0' });
    renderApp('/');

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('profile avatar menu', () => {
  it('shows a generic icon linking to onboarding when there is no profile', () => {
    stubFetch({ status: 'ok', version: '0.1.0' });
    renderApp('/');

    expect(within(banner()).getByRole('link', { name: 'Create a profile' })).toHaveAttribute(
      'href',
      '/welcome',
    );
    expect(screen.queryByRole('button', { name: 'Open profile menu' })).not.toBeInTheDocument();
  });

  it('is hidden on the /welcome onboarding page', () => {
    stubFetch({ status: 'ok', version: '0.1.0' });
    renderApp('/welcome');

    expect(within(banner()).queryByRole('link', { name: 'Create a profile' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open profile menu' })).not.toBeInTheDocument();
  });

  it('shows initials and opens a dropdown with identity, a quick fact, and the three actions', async () => {
    stubFetch({ status: 'ok', version: '0.1.0' });
    window.localStorage.setItem('userProfile', JSON.stringify(PROFILE));
    const user = userEvent.setup();
    renderApp('/');

    const trigger = screen.getByRole('button', { name: 'Open profile menu' });
    expect(trigger).toHaveTextContent('FA');

    await user.click(trigger);
    const menu = screen.getByRole('menu');
    expect(within(menu).getByText('Festina Ademi')).toBeInTheDocument();
    expect(within(menu).getByText('2000')).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'My profile' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'End session' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Delete profile' })).toBeInTheDocument();
  });

  it('"My profile" navigates to the profile page', async () => {
    stubFetch({ status: 'ok', version: '0.1.0' });
    window.localStorage.setItem('userProfile', JSON.stringify(PROFILE));
    const user = userEvent.setup();
    renderApp('/');

    await user.click(screen.getByRole('button', { name: 'Open profile menu' }));
    await user.click(screen.getByRole('menuitem', { name: 'My profile' }));

    expect(await screen.findByRole('heading', { name: 'My profile' })).toBeInTheDocument();
  });

  it('"End session" returns to the landing page and keeps the profile in storage', async () => {
    stubFetch({ status: 'ok', version: '0.1.0' });
    window.localStorage.setItem('userProfile', JSON.stringify(PROFILE));
    const user = userEvent.setup();
    renderApp('/workspace');

    await user.click(screen.getByRole('button', { name: 'Open profile menu' }));
    await user.click(screen.getByRole('menuitem', { name: 'End session' }));

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      'Learn faster from your lectures.',
    );
    expect(window.localStorage.getItem('userProfile')).not.toBeNull();
  });

  it('deleting the profile wipes the backend and local data, then lands on the landing page', async () => {
    stubUserDataFetch();
    window.localStorage.setItem('userProfile', JSON.stringify(PROFILE));
    window.localStorage.setItem('studymate.document.current', 'doc-1');
    const user = userEvent.setup();
    renderApp('/workspace');

    await user.click(screen.getByRole('button', { name: 'Open profile menu' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete profile' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(
      within(dialog).getByText('Are you sure you want to delete your profile?'),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Yes, delete everything' }));

    expect(await screen.findByText('Profile deleted. Welcome to MIK!')).toBeInTheDocument();
    expect(window.localStorage.getItem('userProfile')).toBeNull();
    expect(window.localStorage.getItem('studymate.document.current')).toBeNull();
    expect(screen.getByRole('link', { name: 'Create a profile' })).toBeInTheDocument();
  });

  it('shows an error and keeps the dialog open when the backend delete fails', async () => {
    stubUserDataFetch(500);
    window.localStorage.setItem('userProfile', JSON.stringify(PROFILE));
    const user = userEvent.setup();
    renderApp('/');

    await user.click(screen.getByRole('button', { name: 'Open profile menu' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete profile' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Yes, delete everything' }));

    expect(
      await within(dialog).findByText('Something went wrong. Please try again.'),
    ).toBeInTheDocument();
    expect(window.localStorage.getItem('userProfile')).not.toBeNull();
  });

  it('dismisses the delete dialog with Escape or Cancel without deleting anything', async () => {
    stubFetch({ status: 'ok', version: '0.1.0' });
    window.localStorage.setItem('userProfile', JSON.stringify(PROFILE));
    const user = userEvent.setup();
    renderApp('/');

    await user.click(screen.getByRole('button', { name: 'Open profile menu' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete profile' }));
    await screen.findByRole('alertdialog');
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Open profile menu' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete profile' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
    expect(window.localStorage.getItem('userProfile')).not.toBeNull();
  });
});
