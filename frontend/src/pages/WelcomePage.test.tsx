import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { readLevelPreference } from '../hooks/useLevel';
import { readUserProfile } from '../lib/profile';
import { renderApp, sseJsonResponse } from '../test/utils';

type FetchMock = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

const DOCUMENT = {
  id: 'doc-9',
  filename: 'notes.pdf',
  content_hash: 'h',
  content_type: 'lecture',
  source_format: 'pdf',
  detected_language: 'en',
  size_bytes: 2048,
  page_count: 1,
};

const METADATA = {
  document_id: 'doc-9',
  content_type: 'lecture',
  task: 'summary',
  level: 'advanced',
  language: 'en',
  chunks_used: 1,
  prompt_version: '9',
  model: 'test',
  cached: false,
};

function stubFetch(uploadStatus = 201): ReturnType<typeof vi.fn<FetchMock>> {
  const fetchMock = vi.fn<FetchMock>((input, init) => {
    const url = requestUrl(input);
    if (url.endsWith('/api/health')) {
      return Promise.resolve(Response.json({ status: 'ok', version: '0.1.0' }));
    }
    if (url.endsWith('/api/documents') && init?.method === 'POST') {
      if (uploadStatus !== 201) {
        return Promise.resolve(
          Response.json(
            {
              error: {
                code: 'llm_not_configured',
                message_key: 'errors.llm_not_configured',
                details: { provider: 'gemini' },
              },
            },
            { status: uploadStatus },
          ),
        );
      }
      return Promise.resolve(
        Response.json(
          { document: DOCUMENT, chunks: [{ text: 'Hello world text.', heading: 'Page 1' }] },
          { status: 201 },
        ),
      );
    }
    if (url.includes('/summary')) {
      return Promise.resolve(
        sseJsonResponse({
          overview: 'A real overview',
          key_concepts: [],
          takeaways: [],
          confidence_notes: [],
          metadata: METADATA,
        }),
      );
    }
    if (url.includes('/explanation')) {
      return Promise.resolve(
        sseJsonResponse({
          sections: [],
          recommendations: [],
          walkthrough: [],
          confidence_notes: [],
          metadata: METADATA,
        }),
      );
    }
    return Promise.resolve(Response.json({}, { status: 404 }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Fills the new name/birth-year step and advances past it. */
async function fillNameStep(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(await screen.findByLabelText('First name'), 'Festina');
  await user.type(screen.getByLabelText('Last name'), 'Ademi');
  await user.selectOptions(screen.getByLabelText('Birth year'), '2000');
  await user.click(screen.getByRole('button', { name: 'Next' }));
}

describe('onboarding', () => {
  it('requires first name, last name and a birth year before the name step can continue', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderApp('/welcome');

    await user.click(await screen.findByRole('button', { name: 'Get started' }));
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();

    await user.type(await screen.findByLabelText('First name'), 'Festina');
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();

    await user.type(screen.getByLabelText('Last name'), 'Ademi');
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();

    await user.selectOptions(screen.getByLabelText('Birth year'), '2000');
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
  });

  it('walks a student through every click-based step, saves the profile and opens the workspace', async () => {
    stubFetch();
    window.localStorage.removeItem('userProfile');
    const user = userEvent.setup();
    renderApp('/welcome');

    await user.click(await screen.findByRole('button', { name: 'Get started' }));

    // Name: Next stays disabled until all three fields are filled.
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    await fillNameStep(user);

    // Role: Next stays disabled until a role is chosen.
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    await user.click(await screen.findByRole('radio', { name: 'Student' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));

    // City: a known city reveals its own university list.
    await user.click(await screen.findByRole('radio', { name: 'Pristina' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(
      await screen.findByRole('radio', { name: 'Universum International College' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Universiteti i Tiranës' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Universum International College' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));

    // Degree, then a year chip appropriate to it.
    await user.click(await screen.findByRole('radio', { name: 'Bachelor' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(await screen.findByRole('radio', { name: 'Year 3' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));

    // Language: pick Albanian, which switches the interface immediately.
    await user.click(await screen.findByRole('radio', { name: 'Shqip (SQ)' }));
    expect(await screen.findByRole('button', { name: 'Vazhdo' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Vazhdo' }));

    // Level.
    await user.click(await screen.findByRole('radio', { name: /I avancuar/ }));
    await user.click(screen.getByRole('button', { name: 'Vazhdo' }));

    // Summary card, then on to the workspace.
    await user.click(await screen.findByRole('button', { name: /Vazhdo te ngarkimi/ }));

    const profile = readUserProfile();
    expect(profile).toMatchObject({
      firstName: 'Festina',
      lastName: 'Ademi',
      birthYear: 2000,
      role: 'student',
      city: 'prishtina',
      university: 'Universum International College',
      degree: 'bachelor',
      yearOfStudy: 'year3',
      language: 'sq',
      level: 'advanced',
    });
    expect(profile?.completedAt).toBeTruthy();
    expect(readLevelPreference()).toBe('advanced');
    expect(window.localStorage.getItem('studymate.language')).toBe('sq');
    await user.click(await screen.findByRole('button', { name: /Ngarko një dokument/ }));
    expect(await screen.findByRole('button', { name: 'Përpuno dokumentin' })).toBeInTheDocument();
  });

  it('lets a student type a custom city and university when theirs is not listed', async () => {
    stubFetch();
    window.localStorage.removeItem('userProfile');
    const user = userEvent.setup();
    renderApp('/welcome');

    await user.click(await screen.findByRole('button', { name: 'Get started' }));
    await fillNameStep(user);
    await user.click(await screen.findByRole('radio', { name: 'Student' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));

    // Picking "Other" for the city opens a text field, and the Next button stays disabled
    // until it has content. Scoped to this step's radiogroup: the previous step's own
    // "Other" role option can still be mid-exit-animation in the DOM at this point.
    const cityGroup = await screen.findByRole('radiogroup', { name: 'Which city are you in?' });
    await user.click(within(cityGroup).getByRole('radio', { name: 'Other' }));
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    await user.type(screen.getByLabelText('City'), 'Durrës');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    // With an unlisted/custom city, only the "Other" university chip is offered.
    const universityGroup = await screen.findByRole('radiogroup', {
      name: 'Which university or college?',
    });
    expect(universityGroup.querySelectorAll('[role="radio"]')).toHaveLength(1);
    await user.click(within(universityGroup).getByRole('radio', { name: 'Other' }));
    await user.type(screen.getByLabelText('University'), 'Aldent University');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    await user.click(await screen.findByRole('radio', { name: 'Master' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    // Master only offers Year 1 / Year 2.
    expect(await screen.findByRole('radio', { name: 'Year 1' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Year 3' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Year 2' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));

    await user.click(screen.getByRole('button', { name: 'Next' })); // language (default English)
    await user.click(screen.getByRole('button', { name: 'Next' })); // level (no change needed)
    await user.click(await screen.findByRole('button', { name: /Continue to upload/ }));

    const profile = readUserProfile();
    expect(profile).toMatchObject({
      role: 'student',
      city: 'Durrës',
      university: 'Aldent University',
      degree: 'master',
      yearOfStudy: 'year2',
    });
  });

  it('asks a professional for their field of work instead, with a custom fallback', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderApp('/welcome');

    await user.click(await screen.findByRole('button', { name: 'Get started' }));
    await fillNameStep(user);
    await user.click(await screen.findByRole('radio', { name: 'Professional' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.queryByLabelText('University')).not.toBeInTheDocument();
    const fieldGroup = await screen.findByRole('radiogroup', {
      name: 'What field do you work in?',
    });
    expect(
      within(fieldGroup).getByRole('radio', { name: 'IT / Computer Science' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();

    await user.click(within(fieldGroup).getByRole('radio', { name: 'Other' }));
    await user.type(screen.getByLabelText('Field of work'), 'Backend engineering');
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
  });

  it('shows a Back button on every step after the first and lets the student revise an earlier choice', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderApp('/welcome');

    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Get started' }));
    await fillNameStep(user);

    await user.click(await screen.findByRole('radio', { name: 'Student' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(await screen.findByRole('radio', { name: 'Tirana (Albania)' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(
      await screen.findByRole('radio', { name: 'Universiteti i Tiranës' }),
    ).toBeInTheDocument();

    // Go back to the city step and change the answer; the university list updates accordingly.
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(await screen.findByRole('radio', { name: 'Pristina' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(
      await screen.findByRole('radio', { name: 'Universum International College' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Universiteti i Tiranës' })).not.toBeInTheDocument();
  });
});

describe('workspace upload', () => {
  it('shows the chosen file, uploads it and opens the summary', async () => {
    window.localStorage.clear();
    stubFetch();
    const user = userEvent.setup();
    renderApp('/workspace');

    await user.click(await screen.findByRole('button', { name: /Upload a document/ }));
    const input = await screen.findByTestId('workspace-file-input');
    await user.upload(input, new File(['%PDF'], 'notes.pdf', { type: 'application/pdf' }));
    expect(screen.getByText('notes.pdf')).toBeInTheDocument();
    expect(screen.getByText('4 B')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Process document' }));

    expect(await screen.findByRole('heading', { name: 'notes.pdf' })).toBeInTheDocument();
    expect(await screen.findByText('A real overview', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload a new document' })).toBeInTheDocument();
  });

  it('shows the backend error, with the environment variable to set for a missing AI key', async () => {
    window.localStorage.clear();
    stubFetch(503);
    const user = userEvent.setup();
    renderApp('/workspace');

    await user.click(await screen.findByRole('button', { name: /Upload a document/ }));
    const input = await screen.findByTestId('workspace-file-input');
    await user.upload(input, new File(['%PDF'], 'notes.pdf', { type: 'application/pdf' }));
    await user.click(screen.getByRole('button', { name: 'Process document' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('GEMINI_API_KEY');
    expect(alert).toHaveTextContent('llm_not_configured');
  });
});
