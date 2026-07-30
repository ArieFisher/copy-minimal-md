import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';

let TsvDetector;

beforeAll(() => {
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
    expect(out.markdown).toBe('| Name | Age |\n| --- | --- |\n| Alice | 30 |\n| Bob | 25 |\n');
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

  describe('simpleHtml via marked', () => {
    // The real page loads lib/marked.min.js as a global; stand in for it so the
    // marked branch of detect() is exercised rather than the fallback builder.
    beforeEach(() => {
      globalThis.marked = {
        parse: () =>
          '<table>\n<thead>\n<tr>\n<th>Name</th>\n<th>Age</th>\n</tr>\n</thead>\n' +
          '<tbody><tr>\n<td>Alice</td>\n<td>30</td>\n</tr>\n</tbody></table>\n'
      };
    });

    afterEach(() => {
      delete globalThis.marked;
    });

    it('de-emphasises header cells without mangling <thead>', () => {
      const out = TsvDetector.detect({ hasHtml: false, plainText: 'Name\tAge\nAlice\t30' });
      expect(out.simpleHtml).toContain('<thead>');
      expect(out.simpleHtml).not.toContain('"ead>');
      expect(out.simpleHtml).toContain('<th style="font-weight: normal;">Name</th>');
    });

    it('keeps existing attributes when marked emits aligned headers', () => {
      globalThis.marked = { parse: () => '<table>\n<thead>\n<tr>\n<th align="left">Name</th>\n</tr>\n</thead>\n</table>' };
      const out = TsvDetector.detect({ hasHtml: false, plainText: 'Name\tAge\nAlice\t30' });
      expect(out.simpleHtml).toContain('<thead>');
      expect(out.simpleHtml).toContain('<th style="font-weight: normal;" align="left">');
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
