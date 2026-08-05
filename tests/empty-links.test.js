/**
 * tests/empty-links.test.js
 *
 * A link sanitize emptied.
 *
 * `svg` is not on the allowlist, and an SVG element is removed with its whole
 * subtree rather than unwrapped the way a disallowed HTML tag is. An <a> whose
 * only content was an inline icon therefore comes out of sanitize holding
 * nothing, and lands in both outputs as a link with no text — a URL nobody can
 * see, indistinguishable from a copy that lost something.
 *
 * The rule these all turn on: such an anchor is named from what the source
 * already said about it, and an anchor that still has something to show is left
 * alone.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';

let nameEmptyLinks;
let fromHtml;
let htmlToMarkdown;

beforeAll(() => {
  ({ nameEmptyLinks, fromHtml, htmlToMarkdown } = require('./_adapter.js'));
});

const ICON_LINK = '<a href="https://example.test/x"></a>';

describe('nameEmptyLinks — naming what is left', () => {
  it('names an empty link from its alt', () => {
    expect(nameEmptyLinks('<a href="https://example.test/x" alt="Sharefile"></a>'))
      .toBe('<a href="https://example.test/x" alt="Sharefile" title="Sharefile">Shar…</a>');
  });

  it('falls back to aria-label, then to title', () => {
    expect(nameEmptyLinks('<a href="https://example.test/x" aria-label="See more headlines"></a>'))
      .toBe('<a href="https://example.test/x" aria-label="See more headlines" title="See more headlines">See…</a>');

    expect(nameEmptyLinks('<a href="https://example.test/x" title="Open the report"></a>'))
      .toBe('<a href="https://example.test/x" title="Open the report">Open…</a>');
  });

  it('prefers alt over aria-label over title', () => {
    const all = '<a href="https://example.test/x" alt="AAAA" aria-label="BBBB" title="CCCC"></a>';
    expect(nameEmptyLinks(all)).toContain('>AAAA…<');

    const noAlt = '<a href="https://example.test/x" aria-label="BBBB" title="CCCC"></a>';
    expect(nameEmptyLinks(noAlt)).toContain('>BBBB…<');
  });

  it('calls a link the source never named `image…`', () => {
    expect(nameEmptyLinks(ICON_LINK)).toBe('<a href="https://example.test/x">image…</a>');
  });

  it('keeps the whole name in title, where the preview came from', () => {
    const named = nameEmptyLinks('<a href="https://example.test/x" aria-label="See more headlines &amp; perspectives"></a>');
    expect(named).toContain('title="See more headlines &amp; perspectives"');
    expect(named).toContain('>See…<');
  });

  it('takes a name shorter than the preview whole', () => {
    expect(nameEmptyLinks('<a href="https://example.test/x" alt="Go"></a>')).toContain('>Go…<');
  });

  it('leaves a link that has text', () => {
    const linked = '<a href="https://example.test/x" aria-label="Ignore me">Read this</a>';
    expect(nameEmptyLinks(linked)).toBe(linked);
  });

  it('leaves a link holding an image, which shows itself', () => {
    const thumbnail = '<a href="https://example.test/x" aria-label="Ignore me"><img src="t.png" alt=""></a>';
    expect(nameEmptyLinks(thumbnail)).toBe(thumbnail);
  });

  it('hands back the very same string when there is nothing to name', () => {
    const prose = '<p>Nothing to do here</p>';
    expect(nameEmptyLinks(prose)).toBe(prose);
  });
});

describe('the icon link on a Google News card', () => {
  const html = readFileSync(__dirname + '/fixtures/google-news-icon-link/input.html', 'utf8');

  /**
   * A link with no text. The leading `!` is what keeps an image out of this:
   * `![](…)` is an empty *alt*, which is the source calling the picture
   * decorative, and a separate matter from a link nobody can see.
   */
  const EMPTY_LINK = /(^|[^!])\[\]\(/;

  it('no longer reaches the Markdown as a link with no text', () => {
    const { markdown } = fromHtml(html);

    expect(markdown).not.toMatch(EMPTY_LINK);
    expect(markdown).toContain('[See…](https://news.google.com/stories/');
    expect(markdown).toContain('"See more headlines & perspectives');
  });

  it('says the same thing on the hotkey path', () => {
    expect(htmlToMarkdown(html)).not.toMatch(EMPTY_LINK);
  });

  it('names it in the Simple HTML too', () => {
    const { simpleHtml } = fromHtml(html);

    expect(simpleHtml).not.toContain('></a>');
    expect(simpleHtml).toContain('>See…</a>');
  });
});
