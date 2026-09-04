import { describe, it, expect } from 'vitest';

const { htmlToEntries, htmlToMarkdown, htmlToSimpleHtml, gridToEntries, gridToMarkdown, gridToSimpleHtml, fromHtml } = require('./_adapter.js');

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

  it('degrades Google Sheets div-in-cell newlines to <br>, keeping the row on one line', () => {
    const md = htmlToMarkdown('<table><thead><tr><th>X</th></tr></thead><tbody><tr><td><div>line1</div><div>line2</div></td></tr></tbody></table>').trim();
    // Block divs would otherwise split the row across lines and break the
    // table syntax; the break survives as a <br>, GFM's spelling for one
    // inside a cell, instead of being dropped.
    expect(md).toContain('| line1<br>line2 |');
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
    expect(gridToEntries(null)).toEqual({ markdown: '', simpleHtml: '' });
  });

  it('gives what the clipboard path gives for the same table', () => {
    // The grid path used to run its own converter behind its own allowlist, so
    // the same table said two different things depending on whether the page
    // put HTML on the clipboard.
    const t = document.createElement('table');
    t.innerHTML = '<thead><tr><th>Source</th></tr></thead>'
      + '<tbody><tr><td><a href="https://example.com">Report</a></td></tr></tbody>';

    expect(gridToEntries({ type: 'aria', tables: [t] })).toEqual({
      markdown: fromHtml(t.outerHTML).markdown,
      simpleHtml: fromHtml(t.outerHTML).simpleHtml
    });
  });

  it('keeps a link in a cell', () => {
    const t = document.createElement('table');
    t.innerHTML = '<thead><tr><th>Source</th></tr></thead>'
      + '<tbody><tr><td><a href="https://example.com">Report</a></td></tr></tbody>';

    expect(gridToMarkdown({ type: 'aria', tables: [t] })).toContain('[Report](https://example.com)');
    expect(gridToSimpleHtml({ type: 'aria', tables: [t] })).toContain('href="https://example.com"');
  });

  it('writes a tag in a cell as text', () => {
    const t = document.createElement('table');
    t.innerHTML = '<thead><tr><th>Tag</th></tr></thead><tbody><tr><td>&lt;table&gt;</td></tr></tbody>';

    expect(gridToMarkdown({ type: 'aria', tables: [t] })).toContain('| \\<table> |');
  });
});

describe('Pipeline.htmlToSimpleHtml', () => {
  it('returns a table for a copy that has one', () => {
    const html = htmlToSimpleHtml('<table><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>');
    expect(html).toContain('<table>');
    expect(html).toContain('<th>A</th>');
    expect(html).toContain('<td>1</td>');
  });

  it('returns the Simple HTML for prose too, not only for a table', () => {
    const html = htmlToSimpleHtml('<h1>Title</h1><p>Body <a href="/x">link</a></p>');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<a href="/x">link</a>');
  });

  it('strips the source formatting from prose, same as it does from a table', () => {
    const html = htmlToSimpleHtml(
      '<p style="font-family: Arial; color: #ff0000"><span class="vendor-tag">Styled</span></p>'
    );
    expect(html).toContain('Styled');
    expect(html).not.toContain('style=');
    expect(html).not.toContain('class=');
  });

  it('returns nothing when the copy simplifies to nothing, so text/plain goes out alone', () => {
    // '' is content.js's signal to write text/plain on its own. A blank
    // text/html entry would instead paste as nothing.
    expect(htmlToSimpleHtml('')).toBe('');
    expect(htmlToSimpleHtml('   ')).toBe('');
    expect(htmlToSimpleHtml('<div><div></div></div>')).toBe('');
  });

  it('leaves a headerless copy headerless, unlike the Markdown', () => {
    // The Markdown has to invent a header row — GFM has no table without one.
    // Simple HTML is under no such constraint and must not follow it.
    const source = '<table><tr><td>Alice</td><td>30</td></tr><tr><td>Bob</td><td>25</td></tr></table>';
    expect(htmlToMarkdown(source).trim().split('\n')[0]).toBe('| Alice | 30 |');

    const html = htmlToSimpleHtml(source);
    expect(html).not.toContain('<th>');
    expect(html).not.toContain('<thead>');
    expect(html).toContain('<td>Alice</td>');
  });

  it('carries the grid repair into the HTML, same as the Markdown', () => {
    const domTable = document.createElement('table');
    domTable.innerHTML = '<thead><tr><th>P</th><th>Q</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody>';
    const gridResult = { type: 'aria', tables: [domTable] };

    const html = htmlToSimpleHtml('<div>flat text from div grid</div>', { gridResult });
    expect(html).toContain('<th>P</th>');
    expect(html).toContain('<td>2</td>');
    expect(html).not.toContain('flat text');
  });

  it('carries a tableless grid copy through as its prose', () => {
    // No grid was found, so there is nothing to repair — but the copy still has
    // content, and content is what earns a text/html entry now.
    expect(htmlToSimpleHtml('<div>flat text</div>', { gridResult: null })).toContain('flat text');
  });
});

describe('Pipeline.htmlToEntries — the two entries describe one copy', () => {
  /**
   * Both entries used to be derived twice over: this module repaired a document
   * for the Markdown and equivalents.js repaired its own for the Simple HTML.
   * That was survivable while text/html was reserved for tables, since a copy
   * the two could disagree about got no text/html at all. Now every copy writes
   * both, so they come from one call — these pin that they cannot drift.
   */
  const PAYLOADS = {
    prose: '<h1>Title</h1><p>Body</p>',
    'a table': '<table><tr><td>Alice</td><td>30</td></tr></table>',
    'a Google Docs copy': '<b style="font-weight:normal"><p>hello world</p></b>',
    'a tracking beacon': '<p>Real text</p><img src="https://tracker.test/p.gif" width="1" height="1" alt="">',
    'an ARIA grid the DOM pass missed': `
      <div role="row"><span role="columnheader">A</span><span role="columnheader">B</span></div>
      <div role="row"><span role="gridcell">1</span><span role="gridcell">2</span></div>`,
  };

  for (const [what, payload] of Object.entries(PAYLOADS)) {
    it(`agrees with what the inspector derives from ${what}`, () => {
      const entries = htmlToEntries(payload);
      const inspector = fromHtml(payload);

      expect(entries.markdown.trim()).toBe(inspector.markdown.trim());
      expect(entries.simpleHtml.trim()).toBe(inspector.simpleHtml.trim());
    });
  }

  it('reports an ARIA grid as a table in both entries, not one', () => {
    // The clipboard payload kept the role attributes but GridDetector found
    // nothing to hand over — the source repairs reconstruct the table, and
    // because both entries come from them, neither is left reading it as prose.
    const { markdown, simpleHtml } = htmlToEntries(PAYLOADS['an ARIA grid the DOM pass missed']);

    expect(markdown).toContain('| A | B |');
    expect(markdown).toContain('| 1 | 2 |');
    expect(simpleHtml).toContain('<th>A</th>');
    expect(simpleHtml).toContain('<td>2</td>');
  });

  it('applies the grid repair to both entries', () => {
    const domTable = document.createElement('table');
    domTable.innerHTML = '<thead><tr><th>P</th><th>Q</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody>';

    const { markdown, simpleHtml } = htmlToEntries('<div>flat text from div grid</div>', {
      gridResult: { type: 'aria', tables: [domTable] },
    });

    expect(markdown).toContain('| P | Q |');
    expect(simpleHtml).toContain('<th>P</th>');
    expect(markdown).not.toContain('flat text');
    expect(simpleHtml).not.toContain('flat text');
  });
});

describe('Pipeline.gridToSimpleHtml', () => {
  it('emits a table from a reconstructed grid table', () => {
    const t = document.createElement('table');
    t.innerHTML = '<thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody>';
    const html = gridToSimpleHtml({ type: 'aria', tables: [t] });
    expect(html).toContain('<th>A</th>');
    expect(html).toContain('<td>2</td>');
  });

  it('returns empty string for null/empty input', () => {
    expect(gridToSimpleHtml(null)).toBe('');
    expect(gridToSimpleHtml({ type: 'aria', tables: [] })).toBe('');
  });
});
