/**
 * tests/div-line-breaks.test.js
 *
 * DOMPurify's ALLOWED_TAGS omits `div` and the other generic block
 * containers. DOMPurify does not drop a disallowed tag, it unwraps it and
 * splices the children inline — so on a div-based prose page every block
 * boundary is gone before Turndown ever runs, and lines that were never
 * meant to touch run together with no space at all.
 *
 * The fixture is a real clipboard payload captured from a Google News card:
 * a div-based headline block with no table anywhere. See
 * tests/fixtures/google-news-div-prose/notes.md for the capture.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const { htmlToMarkdown, htmlToSimpleHtml } = require('./_adapter.js');

const html = readFileSync(__dirname + '/fixtures/google-news-div-prose/input.html', 'utf8');

function lineContaining(markdown, needle) {
  return markdown.split('\n').find((line) => line.includes(needle));
}

describe('div-based prose keeps its block breaks', () => {
  it('does not run the source, headline, timestamp and byline onto one line', () => {
    const md = htmlToMarkdown(html);

    const reutersLine = lineContaining(md, 'Reuters');
    const headlineLine = lineContaining(md, 'Japan may have sold up to $59 billion');
    const timeLine = lineContaining(md, '8 hours ago');
    const bylineLine = lineContaining(md, 'By Atsuko Aoyama & Noriyuki Hirata');

    expect(reutersLine).toBeDefined();
    expect(headlineLine).toBeDefined();
    expect(timeLine).toBeDefined();
    expect(bylineLine).toBeDefined();

    // The bug glues these onto a single paragraph line with nothing but a
    // stray space between them. None of the four should share a line.
    expect(reutersLine).not.toBe(timeLine);
    expect(headlineLine).not.toBe(timeLine);
    expect(timeLine).not.toBe(bylineLine);
  });

  it('breaks the headline link from the timestamp that follows it', () => {
    const md = htmlToMarkdown(html);

    const headlineLine = lineContaining(md, 'Japan may have sold up to $59 billion');
    const timeLine = lineContaining(md, '8 hours ago');

    expect(headlineLine).not.toBe(timeLine);
  });
});

// Once `div` is allowlisted (this fix), sanitize stops erasing block
// boundaries anywhere — including inside table cells, where a broken-up row
// would wreck the Markdown table's syntax. The td-div → span repair
// (pipeline.js, inlineCellDivs in equivalents.js) runs before sanitize for
// exactly this reason: it inlines cell divs first, so sanitize never sees a
// block element to preserve there. This fixture carries both halves of that
// invariant in one document, so nobody can fix the table half by disabling
// the repair without this test noticing the prose half regress, or vice
// versa.
const mixedHtml = `
  <table>
    <thead><tr><th>Name</th><th>Role</th></tr></thead>
    <tbody>
      <tr><td><div>Alice</div></td><td><div>Engineer</div></td></tr>
      <tr><td><div>Bob</div></td><td><div>Manager</div></td></tr>
    </tbody>
  </table>
  <div>Some prose paragraph one.</div>
  <div>Some prose paragraph two.</div>
`;

describe('table cells stay on one line while prose divs still break', () => {
  it('keeps each table row on one line and still breaks the prose divs apart', () => {
    const md = htmlToMarkdown(mixedHtml);

    expect(md).toContain('| Alice | Engineer |');
    expect(md).toContain('| Bob | Manager |');

    const firstLine = lineContaining(md, 'Some prose paragraph one.');
    const secondLine = lineContaining(md, 'Some prose paragraph two.');
    expect(firstLine).toBeDefined();
    expect(secondLine).toBeDefined();
    expect(firstLine).not.toBe(secondLine);
  });
});

// A cell that once glued its divs into one run of text (`line1line2`) now
// degrades that lost break into a <br> — GFM's only legal way to spell a
// line break inside a table cell. turndown-plugin-gfm passes a <br> already
// inside a cell through untouched, so this is enough to make the break
// survive the round trip through Turndown.
describe('multi-div cells degrade the lost break to <br>, not glued text', () => {
  it('joins two sibling divs in a cell with a <br>, row still on one line', () => {
    const md = htmlToMarkdown(
      '<table><thead><tr><th>X</th></tr></thead><tbody>' +
      '<tr><td><div>line one</div><div>line two</div></td></tr>' +
      '</tbody></table>'
    ).trim();

    expect(md).toContain('| line one<br>line two |');
    // The row is exactly one line — no bare newline snuck into the cell.
    expect(md.split('\n').filter((l) => l.includes('line one'))).toHaveLength(1);
  });

  it('leaves a single-div cell exactly as before: no <br> anywhere', () => {
    const md = htmlToMarkdown(
      '<table><thead><tr><th>X</th></tr></thead><tbody>' +
      '<tr><td><div>line one</div></td></tr>' +
      '</tbody></table>'
    ).trim();

    expect(md).toContain('| line one |');
    expect(md).not.toContain('<br>');
  });

  it('does not double a <br> the source already had between two divs', () => {
    const md = htmlToMarkdown(
      '<table><thead><tr><th>X</th></tr></thead><tbody>' +
      '<tr><td><div>line one</div><br><div>line two</div></td></tr>' +
      '</tbody></table>'
    ).trim();

    expect(md).toContain('| line one<br>line two |');
    expect(md.match(/<br>/g)).toHaveLength(1);
  });

  it('yields at most one <br> per visual boundary when divs are nested', () => {
    // The outer div wraps a lone inner div for "line one" (a boundary
    // against nothing — it opens the cell), then a sibling div for "line
    // two" (one real boundary against the first). querySelectorAll('td div')
    // returns all three divs; unwrapping must still produce exactly one <br>.
    const md = htmlToMarkdown(
      '<table><thead><tr><th>X</th></tr></thead><tbody>' +
      '<tr><td><div><div>line one</div></div><div>line two</div></td></tr>' +
      '</tbody></table>'
    ).trim();

    expect(md).toContain('| line one<br>line two |');
    expect(md.match(/<br>/g)).toHaveLength(1);
  });

  it('carries the <br> into the Simple HTML table too', () => {
    const html = htmlToSimpleHtml(
      '<table><thead><tr><th>X</th></tr></thead><tbody>' +
      '<tr><td><div>line one</div><div>line two</div></td></tr>' +
      '</tbody></table>'
    );

    expect(html).toContain('<td>line one<br>line two</td>');
  });
});

// A link whose content is itself block-level divs (a card pattern, e.g. a
// Google Finance stock row: one <a> wrapping ticker/name/price/change divs)
// can't keep those divs' block breaks as literal newlines — a Markdown link
// label can't safely span a blank line. Before this fix, the whitespace
// collapse in `toMarkdown` that trims incidental link-text padding couldn't
// tell that padding apart from a real div boundary, and flattened both to a
// single bare space: every field ran together with nothing marking where one
// ended and the next began. It should now separate them with an em dash
// while still keeping the whole label on one line.
describe('a link wrapping block-level children separates its fields, on one line', () => {
  const financeCardHtml =
    '<a href="https://www.google.com/finance/beta/quote/AII:TSE">' +
    '<div><div><div>AII</div><div>Almonty Industries Inc</div></div>' +
    '<div><div>$15.51</div><div>-4.96%&nbsp;<div><i>arrow_downward</i></div></div></div>' +
    '</div></a>';

  it('joins the ticker, name, price, change and icon with em dashes on one line', () => {
    const md = htmlToMarkdown(financeCardHtml).trim();

    expect(md).toBe(
      '[AII — Almonty Industries Inc — $15.51 — \\-4.96% — _arrow\\_downward_]' +
      '(https://www.google.com/finance/beta/quote/AII:TSE)'
    );
    expect(md.split('\n')).toHaveLength(1);
  });

  it('leaves a link with a single inline-only child unchanged (no em dash introduced)', () => {
    const md = htmlToMarkdown('<a href="https://example.com">Simple text</a>').trim();

    expect(md).toBe('[Simple text](https://example.com)');
    expect(md).not.toContain('—');
  });

  it('still collapses incidental whitespace (no real block boundary) to a single space', () => {
    const md = htmlToMarkdown('<a href="https://example.com">\n  Simple\n  text\n</a>').trim();

    expect(md).toBe('[Simple text](https://example.com)');
    expect(md).not.toContain('—');
  });
});
