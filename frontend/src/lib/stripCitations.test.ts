import { describe, expect, it } from 'vitest';

import { stripCitationsForTts } from './stripCitations';

describe('stripCitationsForTts', () => {
  it.each([
    ['Hello [Page 5] world.', 'Hello world.'],
    ['Code [pasted_code_2026-10-13.py:17] runs.', 'Code runs.'],
    ['See [line 12-15] for details.', 'See for details.'],
    ['No citations here.', 'No citations here.'],
    ['Multi [Page 1] cite [Faqja 3] test [line 5-7].', 'Multi cite test.'],
    ['', ''],
    [
      'Then, the code counts how many of those three rules were met [pasted_code_2026-10-13.py:17].',
      'Then, the code counts how many of those three rules were met.',
    ],
    [
      'Kodi kontrollon gjatësinë [Rreshti 4] e fjalëkalimit.',
      'Kodi kontrollon gjatësinë e fjalëkalimit.',
    ],
    ['Shiko [Slajdi 3] dhe [Slide 4].', 'Shiko dhe.'],
    ['Range [file.py:45-60], then more.', 'Range, then more.'],
    ['A bare ref [12] here.', 'A bare ref here.'],
    ['[Page 3] Starts with a citation.', 'Starts with a citation.'],
    ['Back to back [Page 1][Page 2].', 'Back to back.'],
    ['Case [LINE 7] and [lines 3-5] too.', 'Case and too.'],
  ])('strips %j', (text, expected) => {
    expect(stripCitationsForTts(text)).toBe(expected);
  });

  it.each([
    'We compare [linear search] with binary search.',
    'The first item is arr[0] in the list.',
    'Slicing items[a:5] copies part of it.',
    'Pick [3 apples] from the basket.',
    'Gjatësia e fjalëkalimit[Page 3] mbetet.',
  ])('keeps brackets that are not citations: %j', (text) => {
    expect(stripCitationsForTts(text)).toBe(text);
  });
});
