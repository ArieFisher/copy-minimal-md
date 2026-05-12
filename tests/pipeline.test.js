import { describe, it, expect } from 'vitest';

const { htmlToMarkdown, gridToMarkdown } = require('./_adapter.js');

describe('Pipeline.htmlToMarkdown', () => {
  it('converts simple HTML to Markdown', () => {
    const md = htmlToMarkdown('<h1>Title</h1><p>Body</p>').trim();
    expect(md).toBe('# Title\n\nBody');
  });

  it('emits a GFM table for a native <table>', () => {
    const md = htmlToMarkdown('<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>').trim();
    expect(md).toContain('| A | B |');
    expect(md).toContain('| 1 | 2 |');
  });

  it('promotes the first row to <thead> when missing', () => {
    const md = htmlToMarkdown('<table><tr><td>Name</td><td>Age</td></tr><tr><td>Alice</td><td>30</td></tr></table>').trim();
    expect(md.split('\n')[0]).toBe('| Name | Age |');
    expect(md).toContain('| Alice | 30 |');
  });

  it('strips Google Docs fake-bold wrapper', () => {
    const md = htmlToMarkdown('<b style="font-weight:normal">hello world</b>').trim();
    expect(md).toBe('hello world');
  });

  it('strips Google Sheets div-in-cell newlines', () => {
    const md = htmlToMarkdown('<table><thead><tr><th>X</th></tr></thead><tbody><tr><td><div>line1</div><div>line2</div></td></tr></tbody></table>').trim();
    // Block divs would otherwise produce extra newlines; spans keep it inline.
    expect(md).toContain('| line1line2 |');
  });

  it('skips native-table replacement when clipboard cols > 2× DOM cols (layout-table guard)', () => {
    // Build a fake gridResult with 1 col, clipboard has 5 cols. Guard should refuse to swap.
    const clipboardHtml = '<table><tr><td>a</td><td>b</td><td>c</td><td>d</td><td>e</td></tr></table>';
    const domTable = document.createElement('table');
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.textContent = 'REPLACED';
    tr.appendChild(td);
    domTable.appendChild(tr);
    const gridResult = { type: 'native', tables: [domTable] };

    const md = htmlToMarkdown(clipboardHtml, { gridResult }).trim();
    expect(md).not.toContain('REPLACED');
  });

  it('injects ARIA gridResult when clipboard HTML has no tables', () => {
    const domTable = document.createElement('table');
    domTable.innerHTML = '<thead><tr><th>P</th><th>Q</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody>';
    const gridResult = { type: 'aria', tables: [domTable] };

    const md = htmlToMarkdown('<div>flat text from div grid</div>', { gridResult }).trim();
    expect(md).toContain('| P | Q |');
    expect(md).toContain('| 1 | 2 |');
  });

  it('cleans whitespace inside Markdown links', () => {
    const md = htmlToMarkdown('<a href="http://x">hello\n   world</a>').trim();
    expect(md).toBe('[hello world](http://x)');
  });
});

describe('Pipeline.gridToMarkdown', () => {
  it('emits a Markdown table from a reconstructed grid table', () => {
    const t = document.createElement('table');
    t.innerHTML = '<thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody>';
    const md = gridToMarkdown({ type: 'aria', tables: [t] }).trim();
    expect(md).toContain('| A | B |');
    expect(md).toContain('| 1 | 2 |');
  });

  it('returns empty string for null/empty input', () => {
    expect(gridToMarkdown(null)).toBe('');
    expect(gridToMarkdown({ type: 'aria', tables: [] })).toBe('');
  });
});
