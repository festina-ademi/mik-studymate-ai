import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderApp } from '../test/utils';

type FetchMock = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

const PROFILE = {
  firstName: 'Festina',
  lastName: 'Ademi',
  birthYear: 2000,
  role: 'student',
  city: 'prishtina',
  university: 'Universum International College',
  degree: 'bachelor',
  yearOfStudy: 'year3',
  language: 'en',
  level: 'intermediate',
  completedAt: '2026-01-01T00:00:00.000Z',
};

const DOCUMENT = {
  id: 'doc-1',
  filename: 'lecture.pdf',
  content_hash: 'h',
  content_type: 'lecture',
  source_format: 'pdf',
  detected_language: 'en',
  size_bytes: 1024,
  page_count: 3,
};

interface FixtureOptions {
  documents?: unknown[];
  quizHistory?: unknown[];
  deleteDocumentStatus?: number;
}

function stubProfileFetch({
  documents = [],
  quizHistory = [],
  deleteDocumentStatus = 204,
}: FixtureOptions = {}): void {
  const deletedIds = new Set<string>();
  const fetchMock = vi.fn<FetchMock>((input, init) => {
    const url = requestUrl(input);
    if (url.endsWith('/api/health')) {
      return Promise.resolve(Response.json({ status: 'ok', version: '0.1.0' }));
    }
    if (url.endsWith('/api/user/documents')) {
      return Promise.resolve(
        Response.json(documents.filter((entry) => !deletedIds.has((entry as { id: string }).id))),
      );
    }
    if (url.endsWith('/api/user/quiz-history')) {
      return Promise.resolve(Response.json(quizHistory));
    }
    if (url.endsWith(`/api/documents/${DOCUMENT.id}/chunks`)) {
      return Promise.resolve(Response.json([{ text: 'Hello world text.', heading: 'Page 1' }]));
    }
    if (url.endsWith(`/api/documents/${DOCUMENT.id}`) && init?.method === 'DELETE') {
      deletedIds.add(DOCUMENT.id);
      return Promise.resolve(
        deleteDocumentStatus === 204
          ? new Response(null, { status: 204 })
          : Response.json({ error: { code: 'http_error' } }, { status: deleteDocumentStatus }),
      );
    }
    if (url.endsWith(`/api/documents/${DOCUMENT.id}`)) {
      return Promise.resolve(Response.json(DOCUMENT));
    }
    return Promise.resolve(Response.json({}, { status: 404 }));
  });
  vi.stubGlobal('fetch', fetchMock);
}

describe('profile page', () => {
  it('redirects to onboarding when there is no saved profile', async () => {
    stubProfileFetch();
    renderApp('/profile');

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Welcome to MIK');
  });

  it('shows the profile header and stats once documents and quizzes have loaded', async () => {
    window.localStorage.setItem('userProfile', JSON.stringify(PROFILE));
    stubProfileFetch({
      documents: [{ ...DOCUMENT, created_at: '2026-01-05T00:00:00.000Z' }],
      quizHistory: [
        {
          quiz_set_id: 'quiz-1',
          document_id: DOCUMENT.id,
          document_name: DOCUMENT.filename,
          level: 'intermediate',
          language: 'en',
          created_at: '2026-01-06T00:00:00.000Z',
          total_questions: 4,
          answered_questions: 4,
          correct_count: 3,
          score: 0.75,
        },
      ],
    });
    renderApp('/profile');

    expect(await screen.findByText('Festina Ademi')).toBeInTheDocument();
    expect(screen.getByText('2000')).toBeInTheDocument();
    expect(
      screen.getByText((text) => text.includes('Universum International College')),
    ).toBeInTheDocument();

    // Stats: 1 document, 1 quiz, 75% average score.
    await waitFor(() => {
      expect(screen.getByText('Documents uploaded').nextElementSibling).toHaveTextContent('1');
    });
    expect(screen.getByText('Quizzes taken').nextElementSibling).toHaveTextContent('1');
    expect(screen.getByText('Average score').nextElementSibling).toHaveTextContent('75%');

    // Appears once in the documents list and once in the quiz history row for the same file.
    expect(screen.getAllByText('lecture.pdf')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Open' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View details' })).toBeInTheDocument();
  });

  it('shows empty states when there are no documents or quizzes yet', async () => {
    window.localStorage.setItem('userProfile', JSON.stringify(PROFILE));
    stubProfileFetch({ documents: [], quizHistory: [] });
    renderApp('/profile');

    expect(await screen.findByText('No documents yet')).toBeInTheDocument();
    expect(screen.getByText("You haven't uploaded any documents yet.")).toBeInTheDocument();
    expect(screen.getByText("You haven't taken any quizzes yet.")).toBeInTheDocument();
  });

  it('opens a document in the workspace from the "Open" button', async () => {
    window.localStorage.setItem('userProfile', JSON.stringify(PROFILE));
    stubProfileFetch({ documents: [{ ...DOCUMENT, created_at: '2026-01-05T00:00:00.000Z' }] });
    const user = userEvent.setup();
    renderApp('/profile');

    await user.click(await screen.findByRole('button', { name: 'Open' }));

    expect(await screen.findByRole('heading', { name: 'lecture.pdf' })).toBeInTheDocument();
  });

  it('deletes a single document from the trash icon and refreshes the list', async () => {
    window.localStorage.setItem('userProfile', JSON.stringify(PROFILE));
    stubProfileFetch({ documents: [{ ...DOCUMENT, created_at: '2026-01-05T00:00:00.000Z' }] });
    const user = userEvent.setup();
    renderApp('/profile');

    expect(await screen.findByText('lecture.pdf')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete document' }));

    await waitFor(() => {
      expect(screen.queryByText('lecture.pdf')).not.toBeInTheDocument();
    });
    expect(await screen.findByText('No documents yet')).toBeInTheDocument();
  });

  it('opens the delete-profile confirmation from the danger zone', async () => {
    window.localStorage.setItem('userProfile', JSON.stringify(PROFILE));
    stubProfileFetch();
    const user = userEvent.setup();
    renderApp('/profile');

    await user.click(await screen.findByRole('button', { name: 'Delete profile' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(
      within(dialog).getByText('Are you sure you want to delete your profile?'),
    ).toBeInTheDocument();
  });
});
