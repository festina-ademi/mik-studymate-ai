import path from 'node:path';

import { expect, test } from '@playwright/test';

/**
 * One deterministic end-to-end flow against real backend + frontend servers (see
 * playwright.config.ts): upload a sample PDF, see its summary, answer a quiz question, ask the
 * tutor a question and see a citation, then switch the UI language.
 *
 * Determinism: the backend runs with LLM_PROVIDER=mock, fed a schema-keyed fixture file
 * (backend/e2e_fixtures/mock_llm_responses.json) instead of a real model — see
 * app.llm.mock.MockProvider's `schema_responses`.
 */

const SAMPLE_PDF = path.resolve(import.meta.dirname, 'fixtures/sample-lecture.pdf');

test('upload, summary, quiz, tutor citation and language switch', async ({ page }) => {
  await page.goto('/workspace');

  // --- Upload: the workspace's empty state has a real <input type="file"> behind a styled
  // trigger (see components/DocumentUploader.tsx); Playwright can target it directly regardless
  // of its visual styling.
  await page.locator('input[type="file"]').setInputFiles(SAMPLE_PDF);

  // --- Summary appears: navigation to /workspace plus real generated content from the fixture.
  await expect(page).toHaveURL(/\/workspace$/, { timeout: 20_000 });
  await expect(page.getByRole('heading', { name: 'sample-lecture.pdf' })).toBeVisible();
  await expect(
    page.getByText('This document explains binary search', { exact: false }),
  ).toBeVisible({ timeout: 20_000 });

  // --- Quiz answered.
  await page.getByRole('button', { name: 'Quiz' }).click();
  await page.getByRole('button', { name: 'Start quiz' }).click();
  await expect(page.getByText('What does binary search repeatedly divide in half?')).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole('button', { name: /The search interval/ }).click();
  await page.getByRole('button', { name: 'Check answer' }).click();
  await page.getByRole('button', { name: 'See results' }).click();
  // Exact match: the print-only PDF-export header (see components/PrintableSection.tsx) also
  // contains the words "Quiz results" as part of a longer "Quiz results — <filename>" string.
  await expect(page.getByText('Quiz results', { exact: true })).toBeVisible();

  // --- Chat question with citation.
  await page.getByRole('button', { name: 'Chat' }).click();
  await page
    .getByPlaceholder('Ask about a concept, idea, or example from this material…')
    .fill('How does binary search work?');
  await page.getByRole('button', { name: 'Ask question' }).click();
  await expect(
    page.getByText('Binary search repeatedly divides the search interval', { exact: false }),
  ).toBeVisible({ timeout: 20_000 });
  // Exact match: the document viewer's page-selector button is also named "Page 1", plus its
  // own preview text, so a substring match would be ambiguous with the chat's citation chip.
  await expect(page.getByRole('button', { name: 'Page 1', exact: true })).toBeVisible();

  // --- Language switched: the header toggle re-renders visible UI text into Albanian.
  await page.getByRole('button', { name: 'Shqip (SQ)' }).click();
  await expect(page.getByRole('button', { name: 'Kuiz' })).toBeVisible();
});
