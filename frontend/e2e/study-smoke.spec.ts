import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

/**
 * Study Mode smoke test: an admin (via API, the way a researcher would use /admin) imports a
 * material and a test and activates both, then a participant walks the public flow far enough to
 * prove the whole pipeline (randomization, participant creation, the fixed study material and
 * test) is wired correctly end to end: language choice -> consent -> participant code.
 */

const SAMPLE_PDF = path.resolve(import.meta.dirname, 'fixtures/sample-lecture.pdf');
const ADMIN_PASSWORD = 'e2e-test-password'; // matches playwright.config.ts's backend env

test('participant reaches their code after a researcher configures the study', async ({ page }) => {
  // --- Admin setup, via the API exactly as the /admin dashboard would call it.
  const login = await page.request.post('/api/admin/login', {
    data: { password: ADMIN_PASSWORD },
  });
  expect(login.ok()).toBeTruthy();

  const material = await page.request.post('/api/admin/materials', {
    multipart: {
      name: 'E2E study material',
      files: {
        name: 'sample-lecture.pdf',
        mimeType: 'application/pdf',
        buffer: readFileSync(SAMPLE_PDF),
      },
    },
  });
  expect(material.ok()).toBeTruthy();
  const materialBody = (await material.json()) as { id: string };
  const activateMaterial = await page.request.post(
    `/api/admin/materials/${materialBody.id}/activate`,
  );
  expect(activateMaterial.ok()).toBeTruthy();

  const testImport = await page.request.post('/api/admin/tests', {
    data: {
      name: 'E2E study test',
      items: [
        {
          kind: 'multiple_choice',
          topic: 'Binary search',
          question: {
            en: 'What does binary search repeatedly divide?',
            sq: 'Çfarë ndan përsëritshëm kërkimi binar?',
          },
          options: {
            en: ['The search interval', 'The file size'],
            sq: ['Intervalin e kërkimit', 'Madhësinë e skedarit'],
          },
          correct_answer: { en: 'The search interval', sq: 'Intervalin e kërkimit' },
          max_score: 1,
        },
      ],
    },
  });
  expect(testImport.ok()).toBeTruthy();
  const testBody = (await testImport.json()) as { id: string };
  const activateTest = await page.request.post(`/api/admin/tests/${testBody.id}/activate`);
  expect(activateTest.ok()).toBeTruthy();

  // --- Participant flow: language -> consent -> participant code.
  // Scoped to <main>: the header's own SQ|EN toggle also has a button whose accessible name
  // contains "English" ("English (EN)"), which would otherwise make this locator ambiguous.
  await page.goto('/study/participate');
  const main = page.locator('main');
  await main.getByRole('button', { name: 'English', exact: true }).click();
  await expect(page.getByText('Informed consent')).toBeVisible();
  await main.getByRole('button', { name: 'I understand and agree to take part' }).click();

  await expect(page.getByText(/^P-[A-Z0-9]{4}$/)).toBeVisible({ timeout: 20_000 });
});
