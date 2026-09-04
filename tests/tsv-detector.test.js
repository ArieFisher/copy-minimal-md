import { describe, it, expect, beforeAll } from 'vitest';

let TsvDetector;

beforeAll(() => {
  // detect() builds a table and hands it to Equivalents, the same derivation
  // every other source goes through. The adapter puts that global in place the
  // way the extension's own script loading does.
  require('./_adapter.js').fromHtml;
  TsvDetector = require('../tsv-detector.js');
});

describe('TsvDetector.detect', () => {
  it('returns null when HTML is present', () => {
    expect(TsvDetector.detect({ hasHtml: true, plainText: 'a\tb\n1\t2' })).toBeNull();
  });

  it('returns null when plainText is empty', () => {
    expect(TsvDetector.detect({ hasHtml: false, plainText: '' })).toBeNull();
  });

  it('returns null for single-line input', () => {
    expect(TsvDetector.detect({ hasHtml: false, plainText: 'a\tb' })).toBeNull();
  });

  it('returns null when header has no tabs', () => {
    expect(TsvDetector.detect({ hasHtml: false, plainText: 'no tabs here\nstill none' })).toBeNull();
  });

  it('produces a markdown table for valid TSV', () => {
    const out = TsvDetector.detect({ hasHtml: false, plainText: 'Name\tAge\nAlice\t30\nBob\t25' });
    expect(out).not.toBeNull();
    expect(out.markdown).toBe('| Name | Age |\n| --- | --- |\n| Alice | 30 |\n| Bob | 25 |');
    expect(out.sourceType).toBe('Plain Text (TSV Conversion)');
  });

  it('pads short rows to header width', () => {
    const out = TsvDetector.detect({ hasHtml: false, plainText: 'a\tb\tc\n1\t2' });
    expect(out.markdown).toContain('| 1 | 2 |  |');
  });

  it('truncates rows longer than header', () => {
    const out = TsvDetector.detect({ hasHtml: false, plainText: 'a\tb\n1\t2\t3\t4' });
    const rowLine = out.markdown.split('\n').find((l) => l.startsWith('| 1'));
    expect(rowLine).toBe('| 1 | 2 |');
  });

  it('handles CRLF line endings', () => {
    const out = TsvDetector.detect({ hasHtml: false, plainText: 'a\tb\r\n1\t2\r\n' });
    expect(out).not.toBeNull();
    expect(out.markdown).toContain('| 1 | 2 |');
  });

  it('keeps the header row as a header', () => {
    const out = TsvDetector.detect({ hasHtml: false, plainText: 'Name\tAge\nAlice\t30' });
    expect(out.simpleHtml).toContain('<thead><tr><th>Name</th><th>Age</th></tr></thead>');
    expect(out.simpleHtml).toContain('<tbody><tr><td>Alice</td><td>30</td></tr></tbody>');
  });

  it('keeps a cell with a pipe to one cell', () => {
    const out = TsvDetector.detect({ hasHtml: false, plainText: 'Col\tB\na | b\t2' });
    expect(out.markdown).toContain('| a \\| b | 2 |');
  });

  describe('a cell holding markup', () => {
    // A spreadsheet column of HTML snippets. Both entries used to carry the
    // markup as markup: the Markdown was glued together from raw cell text,
    // and the Simple HTML was that same Markdown rendered.
    const TSV = 'Tag\tNote\n<table>\ta &amp; b';

    it('writes the tag as text in the Markdown', () => {
      const out = TsvDetector.detect({ hasHtml: false, plainText: TSV });
      expect(out.markdown).toContain('| \\<table> | a \\&amp; b |');
    });

    it('writes the tag as text in the Simple HTML', () => {
      const out = TsvDetector.detect({ hasHtml: false, plainText: TSV });
      expect(out.simpleHtml).toContain('<td>&lt;table&gt;</td>');
      expect(out.simpleHtml).toContain('<td>a &amp;amp; b</td>');
    });
  });
});

describe('TsvDetector listener registry', () => {
  it('fires registered listeners with the detection', async () => {
    const captured = [];
    TsvDetector.addListener((d) => captured.push(d));
    await TsvDetector.fire({ marker: 'x' });
    expect(captured.at(-1)).toEqual({ marker: 'x' });
  });
});
