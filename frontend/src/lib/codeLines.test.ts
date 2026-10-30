import { describe, expect, it } from 'vitest';

import type { ChunkRecord } from './api';
import { countCodeLines, reconstructCode } from './codeLines';

function chunk(text: string, lineStart: number | null, lineEnd: number | null): ChunkRecord {
  return {
    text,
    heading: null,
    page_start: null,
    page_end: null,
    line_start: lineStart,
    line_end: lineEnd,
  };
}

describe('countCodeLines', () => {
  it('counts non-empty lines only', () => {
    expect(countCodeLines([chunk('a = 1\n\n  \nb = 2', 1, 4)])).toBe(2);
  });

  it('counts a line shared by overlapping chunks once (a class and its method)', () => {
    const cls = chunk('class A:\n    def f(self):\n        return 1', 1, 3);
    const method = chunk('def f(self):\n        return 1', 2, 3);
    expect(countCodeLines([cls, method])).toBe(3);
  });

  it('falls back to a plain count for chunks without line numbers', () => {
    expect(countCodeLines([chunk('x\ny', null, null), chunk('z', null, null)])).toBe(3);
  });
});

describe('reconstructCode', () => {
  it('joins chunks in source order and skips ones nested in an earlier chunk', () => {
    const second = chunk('def g():\n    pass', 5, 6);
    const cls = chunk('class A:\n    def f(self):\n        return 1', 1, 3);
    const method = chunk('def f(self):\n        return 1', 2, 3);
    expect(reconstructCode([second, method, cls])).toBe(
      'class A:\n    def f(self):\n        return 1\n\ndef g():\n    pass',
    );
  });
});
