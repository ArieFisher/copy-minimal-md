import { describe, it, expect } from 'vitest';

const { fromHtml } = require('./_adapter.js');

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
    // The stray row is not reconstructed; the sanitizer drops its wrappers and
    // keeps the text, same as any other unstructured content.
    expect(squash(simpleHtml)).toBe('<table><tr><td>real</td></tr></table>loose');
  });
});
