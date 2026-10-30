import { describe, expect, it } from 'vitest';

import { getReferenceTargetId } from './references';

describe('getReferenceTargetId', () => {
  it('maps English page citations to the page viewer item', () => {
    expect(getReferenceTargetId('Page 12', 'doc-1')).toBe('page-doc-1-12');
  });

  it('maps Albanian page citations to the same page viewer item', () => {
    expect(getReferenceTargetId('Faqja 12', 'doc-1')).toBe('page-doc-1-12');
  });

  it('maps English slide citations to the slide viewer item', () => {
    expect(getReferenceTargetId('Slide 7', 'doc-1')).toBe('slide-doc-1-7');
  });

  it('maps Albanian slide citations to the same slide viewer item', () => {
    expect(getReferenceTargetId('Slajdi 7', 'doc-1')).toBe('slide-doc-1-7');
  });

  it('is case-insensitive for the location word', () => {
    expect(getReferenceTargetId('page 3', 'doc-1')).toBe('page-doc-1-3');
    expect(getReferenceTargetId('slajdi 3', 'doc-1')).toBe('slide-doc-1-3');
  });

  it('maps a file:line-range code citation to a file-line viewer id', () => {
    expect(getReferenceTargetId('src/app.py:45-60', 'doc-1')).toBe('src/app.py-45-60');
  });

  it('maps a single-line code citation using the same line as start and end', () => {
    expect(getReferenceTargetId('main.py:10', 'doc-1')).toBe('main.py-10-10');
  });

  it('falls back to a slug of the reference text for anything else', () => {
    expect(getReferenceTargetId('Section A', 'doc-1')).toBe('section-a');
  });

  it('falls back to the document id when the reference has no usable text', () => {
    expect(getReferenceTargetId('   ', 'doc-1')).toBe('doc-1');
  });
});
