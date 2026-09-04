import { describe, it, expect } from 'vitest';

const { fromHtml, isSameHtmlEntry } = require('./_adapter.js');

/** Collapse the whitespace the parser leaves behind so assertions read cleanly. */
const squash = (html) => html.replace(/>\s+</g, '><').trim();

describe('Equivalents.fromHtml — Simple HTML', () => {
  it('leaves a mid-table copy headerless', () => {
    // A selection dragged out of the middle of a sheet: every cell is a <td>,
    // because none of those rows was the sheet's header.
    const { simpleHtml } = fromHtml(
      '<table><tbody>' +
      '<tr><td>GitHub org</td><td>abstract codebase</td></tr>' +
      '<tr><td>npm package name</td><td>unify documentation</td></tr>' +
      '</tbody></table>'
    );

    expect(squash(simpleHtml)).toBe(
      '<table>' +
      '<tr><td>GitHub org</td><td>abstract codebase</td></tr>' +
      '<tr><td>npm package name</td><td>unify documentation</td></tr>' +
      '</table>'
    );
    expect(simpleHtml).not.toContain('<thead>');
    expect(simpleHtml).not.toContain('<tbody>');
    expect(simpleHtml).not.toContain('<th>');
  });

  it('keeps a <thead> the copy actually carried', () => {
    const { simpleHtml } = fromHtml(
      '<table><thead><tr><th>Name</th><th>Age</th></tr></thead>' +
      '<tbody><tr><td>Alice</td><td>30</td></tr></tbody></table>'
    );

    expect(squash(simpleHtml)).toBe(
      '<table><thead><tr><th>Name</th><th>Age</th></tr></thead>' +
      '<tbody><tr><td>Alice</td><td>30</td></tr></tbody></table>'
    );
  });

  it('keeps an implicit header row of <th> cells without a <thead>', () => {
    const { simpleHtml } = fromHtml(
      '<table><tr><th>Name</th><th>Age</th></tr><tr><td>Alice</td><td>30</td></tr></table>'
    );

    expect(simpleHtml).toContain('<th>Name</th>');
    expect(simpleHtml).toContain('<tbody>');
  });

  it('strips styles and scripts from the payload', () => {
    const { simpleHtml } = fromHtml(
      '<google-sheets-html-origin><table style="font-size:10pt" border="1"><tbody>' +
      '<tr><td style="border:1px solid #ccc">a</td></tr>' +
      '</tbody></table></google-sheets-html-origin><script>alert(1)</script>'
    );

    expect(squash(simpleHtml)).toBe('<table><tr><td>a</td></tr></table>');
  });

  it('leaves non-table content alone', () => {
    const { simpleHtml } = fromHtml('<h1>Title</h1><p>Body <a href="/x">link</a></p>');
    expect(squash(simpleHtml)).toBe('<h1>Title</h1><p>Body <a href="/x">link</a></p>');
  });
});

describe('Equivalents.fromHtml — Markdown', () => {
  it('still promotes the first row of a headerless table', () => {
    // Markdown has no table syntax without a header row, so this one is
    // invented even though the Simple HTML above does not.
    const { markdown } = fromHtml(
      '<table><tbody>' +
      '<tr><td>GitHub org</td><td>abstract codebase</td></tr>' +
      '<tr><td>npm package name</td><td>unify documentation</td></tr>' +
      '</tbody></table>'
    );

    expect(markdown.trim().split('\n')).toEqual([
      '| GitHub org | abstract codebase |',
      '| --- | --- |',
      '| npm package name | unify documentation |',
    ]);
  });

  it('uses the header the copy carried', () => {
    const { markdown } = fromHtml(
      '<table><thead><tr><th>Name</th><th>Age</th></tr></thead>' +
      '<tbody><tr><td>Alice</td><td>30</td></tr></tbody></table>'
    );

    expect(markdown.trim().split('\n')).toEqual([
      '| Name | Age |',
      '| --- | --- |',
      '| Alice | 30 |',
    ]);
  });

  it('converts headings, links and lists', () => {
    const { markdown } = fromHtml('<h2>Title</h2><ul><li>one</li></ul><p><a href="/x">link</a></p>');
    expect(markdown).toContain('## Title');
    expect(markdown).toContain('*   one');
    expect(markdown).toContain('[link](/x)');
  });
});

describe('Equivalents.fromHtml — text that reads as markup', () => {
  // The copy that started this: a Google Doc table documenting the extension's
  // own markup, one tag per cell. Every cell here is text. None of it is
  // structure.
  const TAGS_AS_TEXT =
    '<table><tbody>' +
    '<tr><td>&lt;table&gt;</td><td>&lt;table class="dr-ext-target-flash"&gt;</td></tr>' +
    '<tr><td>&lt;td&gt;$ 320&lt;/td&gt;</td><td>&lt;td title="Original: $ 320"&gt;$300&lt;/td&gt;</td></tr>' +
    '</tbody></table>';

  it('writes a tag in a cell as text, not as a tag', () => {
    const { markdown } = fromHtml(TAGS_AS_TEXT);

    expect(markdown).toContain('| \\<table> | \\<table class="dr-ext-target-flash"> |');
    expect(markdown).toContain('| \\<td>$ 320\\</td> | \\<td title="Original: $ 320">$300\\</td> |');
  });

  it('leaves the Simple HTML as it already was', () => {
    // This entry was never wrong. It parses and re-serialises, and that write
    // step spells an angle bracket in text as an entity.
    const { simpleHtml } = fromHtml(TAGS_AS_TEXT);

    expect(squash(simpleHtml)).toContain('<td>&lt;table&gt;</td>');
    expect(squash(simpleHtml)).toContain('<td>&lt;td&gt;$ 320&lt;/td&gt;</td>');
  });

  it('keeps an entity in text an entity', () => {
    // A document holding the five characters &amp; spells them &amp;amp;.
    // Written out bare, the next renderer reads that as an entity and draws
    // one &.
    const { markdown } = fromHtml('<p>Write &amp;amp; for an ampersand.</p>');

    expect(markdown).toBe('Write \\&amp; for an ampersand.');
  });

  it('leaves a bracket that opens nothing alone', () => {
    const { markdown } = fromHtml('<p>5 &lt; 10, and a &lt; b, at AT&amp;T.</p>');

    expect(markdown).toBe('5 < 10, and a < b, at AT&T.');
  });

  it('leaves code alone', () => {
    // A code span is already literal, so a backslash there would show up in
    // the code.
    const { markdown } = fromHtml(
      '<p>Use <code>&lt;br&gt;</code> here.</p><pre><code>&lt;div&gt;x&lt;/div&gt;</code></pre>'
    );

    expect(markdown).toContain('Use `<br>` here.');
    expect(markdown).toContain('<div>x</div>');
    expect(markdown).not.toContain('\\<');
  });
});

describe('Equivalents.fromHtml — a pipe in a cell', () => {
  // A pipe ends a cell, so a cell carrying one used to come out as two and the
  // row ran wider than the table.
  const row = (markdown, first) => markdown.split('\n').find((l) => l.startsWith(`| ${first}`));

  it('keeps a cell with a pipe in its text to one cell', () => {
    const { markdown } = fromHtml(
      '<table><thead><tr><th>Col</th><th>B</th></tr></thead>' +
      '<tbody><tr><td>a | b</td><td>2</td></tr></tbody></table>'
    );

    expect(row(markdown, 'a')).toBe('| a \\| b | 2 |');
  });

  it('keeps a cell with a pipe in a link to one cell', () => {
    // The pipe is in an attribute, so escaping text nodes would never see it.
    const { markdown } = fromHtml(
      '<table><thead><tr><th>Q</th></tr></thead>' +
      '<tbody><tr><td><a href="https://x.test/?q=a|b">go</a></td></tr></tbody></table>'
    );

    expect(row(markdown, '[go]')).toBe('| [go](https://x.test/?q=a\\|b) |');
  });

  it('keeps a cell with a pipe in code to one cell', () => {
    // Turndown hands code text straight through without escaping it.
    const { markdown } = fromHtml(
      '<table><thead><tr><th>Cmd</th></tr></thead>' +
      '<tbody><tr><td><code>ls | wc</code></td></tr></tbody></table>'
    );

    expect(row(markdown, '`ls')).toBe('| `ls \\| wc` |');
  });

  it('leaves the delimiter row alone', () => {
    const { markdown } = fromHtml(
      '<table><thead><tr><th>Col</th><th>B</th></tr></thead>' +
      '<tbody><tr><td>a | b</td><td>2</td></tr></tbody></table>'
    );

    expect(markdown).toContain('| --- | --- |');
  });

  it('leaves a pipe in prose bare', () => {
    // Outside a table a pipe is an ordinary character.
    expect(fromHtml('<p>Run a | b in the shell.</p>').markdown).toBe('Run a | b in the shell.');
  });

  it('still writes a cell line break', () => {
    const { markdown } = fromHtml(
      '<table><thead><tr><th>H</th></tr></thead>' +
      '<tbody><tr><td><div>one</div><div>two</div></td></tr></tbody></table>'
    );

    expect(row(markdown, 'one')).toBe('| one<br>two |');
  });
});

describe('Equivalents.fromHtml — source quirks', () => {
  it('inlines Google Sheets block divs inside cells', () => {
    const { simpleHtml, markdown } = fromHtml(
      '<table><tbody><tr><td><div>line1</div><div>line2</div></td><td>b</td></tr>' +
      '<tr><td>c</td><td>d</td></tr></tbody></table>'
    );

    expect(simpleHtml).not.toContain('<div>');
    expect(markdown).toContain('| line1line2 | b |');
  });

  it('unwraps the Google Docs fake-bold wrapper', () => {
    const { markdown } = fromHtml('<b style="font-weight:normal">hello world</b>');
    expect(markdown.trim()).toBe('hello world');
  });

  it('reports the source type for an extracted ARIA grid', () => {
    const { sourceType, derivedFrom } = fromHtml(
      '<div role="row"><span role="cell">a</span><span role="cell">b</span></div>'
    );
    expect(sourceType).toBe('HTML (Extracted ARIA Table)');
    expect(derivedFrom).toBe('text/html');
  });
});

describe('Equivalents.fromHtml — ARIA grids', () => {
  const ARIA_WITH_HEADER =
    '<div role="row"><span role="columnheader">Name</span><span role="columnheader">Age</span></div>' +
    '<div role="row"><span role="cell">Alice</span><span role="cell">30</span></div>';

  const ARIA_HEADERLESS =
    '<div role="row"><span role="cell">Alice</span><span role="cell">30</span></div>' +
    '<div role="row"><span role="cell">Bob</span><span role="cell">25</span></div>';

  it('keeps the <thead> when the grid declares column headers', () => {
    const { simpleHtml, markdown } = fromHtml(ARIA_WITH_HEADER);
    expect(simpleHtml).toContain('<th>Name</th>');
    expect(markdown).toContain('| Name | Age |');
    expect(markdown).toContain('| Alice | 30 |');
  });

  it('stays headerless when the grid declares none', () => {
    const { simpleHtml, markdown } = fromHtml(ARIA_HEADERLESS);
    expect(simpleHtml).not.toContain('<th>');
    expect(simpleHtml).not.toContain('<thead>');
    expect(simpleHtml).not.toContain('<tbody>');
    // Markdown still needs one, so the first row is promoted there.
    expect(markdown.trim().split('\n')[0]).toBe('| Alice | 30 |');
    expect(markdown).toContain('| Bob | 25 |');
  });

  it('ignores role="row" markup when the payload already has a real table', () => {
    const { simpleHtml } = fromHtml(
      '<table><tbody><tr><td>real</td></tr></tbody></table>' +
      '<div role="row"><span role="cell">loose</span></div>'
    );
    // The stray row is not reconstructed into a table. Its <div> now
    // survives sanitize like any other block container, so the text keeps
    // that wrapper instead of landing bare.
    expect(squash(simpleHtml)).toBe('<table><tr><td>real</td></tr></table><div>loose</div>');
  });
});

describe('Equivalents.isSameHtmlEntry', () => {
  // What cmd+shift+U writes for a headerless table, and what the clipboard hands
  // back on the next read — captured from Chromium on Linux, which restores the
  // <tbody>. macOS also prefixes a <meta charset>, covered separately below.
  // These cases are the rule, not one platform's output: each covers a kind of
  // change the clipboard is known to make, so a platform we have not measured
  // has to produce something new to escape them.
  const WRITTEN = '<table><tr><td>header 1</td><td>header 2</td></tr><tr><td>text 1</td><td>12</td></tr></table>';
  const READ_BACK = '<table><tbody><tr><td>header 1</td><td>header 2</td></tr><tr><td>text 1</td><td>12</td></tr></tbody></table>';

  it('sees through the <tbody> the clipboard puts back', () => {
    expect(isSameHtmlEntry(WRITTEN, READ_BACK)).toBe(true);
  });

  it('ignores a <meta charset> prefix', () => {
    expect(isSameHtmlEntry(WRITTEN, '<meta charset="utf-8">' + READ_BACK)).toBe(true);
  });

  it('ignores fragment marker comments', () => {
    expect(isSameHtmlEntry(WRITTEN, '<!--StartFragment-->' + READ_BACK + '<!--EndFragment-->')).toBe(true);
  });

  it('ignores whitespace between structural tags', () => {
    expect(isSameHtmlEntry(WRITTEN, '<table>\n  <tbody>\n    <tr>\n      <td>header 1</td>\n<td>header 2</td>\n</tr>\n<tr><td>text 1</td><td>12</td></tr>\n</tbody>\n</table>\n')).toBe(true);
  });

  it('still counts inline styles as a difference', () => {
    expect(isSameHtmlEntry(WRITTEN, READ_BACK.replace('<table>', '<table style="color: rgb(0,0,0)">'))).toBe(false);
  });

  it('still counts wrapper elements as a difference', () => {
    expect(isSameHtmlEntry(WRITTEN, READ_BACK.replace('header 1', '<span class="x">header 1</span>'))).toBe(false);
  });

  it('still counts changed content as a difference', () => {
    expect(isSameHtmlEntry(WRITTEN, READ_BACK.replace('text 1', 'text 9'))).toBe(false);
    expect(isSameHtmlEntry(WRITTEN, READ_BACK.replace('<td>12</td>', ''))).toBe(false);
  });

  it('does not confuse a header row with a plain one', () => {
    expect(isSameHtmlEntry(WRITTEN, READ_BACK.replace(/<td>header 1<\/td>/, '<th>header 1</th>'))).toBe(false);
  });
});
