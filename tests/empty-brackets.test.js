/**
 * tests/empty-brackets.test.js
 *
 * The two things that reach the Markdown as brackets with nothing in them.
 *
 * `[](url)` is a link whose text sanitize took away: `svg` is not on the
 * allowlist, and an SVG element is removed with its whole subtree rather than
 * unwrapped the way a disallowed HTML tag is, so an <a> around an inline icon
 * comes out holding nothing. `![](url)` is an image the source itself declared
 * decorative with `alt=""`. Different causes, same result on screen — nothing,
 * beside a URL, indistinguishable from a copy that lost something.
 *
 * The rule these all turn on: both are named from what the source already said
 * about them, and anything that still has something to show is left alone.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';

let nameEmptyLinksAndImages;
let fromHtml;
let htmlToMarkdown;

beforeAll(() => {
  ({ nameEmptyLinksAndImages, fromHtml, htmlToMarkdown } = require('./_adapter.js'));
});

const ICON_LINK = '<a href="https://example.test/x"></a>';

describe('nameEmptyLinksAndImages — a link with no text', () => {
  it('names an empty link from its alt', () => {
    expect(nameEmptyLinksAndImages('<a href="https://example.test/x" alt="Sharefile"></a>'))
      .toBe('<a href="https://example.test/x" alt="Sharefile" title="Sharefile">Shar…</a>');
  });

  it('falls back to aria-label, then to title', () => {
    expect(nameEmptyLinksAndImages('<a href="https://example.test/x" aria-label="See more headlines"></a>'))
      .toBe('<a href="https://example.test/x" aria-label="See more headlines" title="See more headlines">See…</a>');

    expect(nameEmptyLinksAndImages('<a href="https://example.test/x" title="Open the report"></a>'))
      .toBe('<a href="https://example.test/x" title="Open the report">Open…</a>');
  });

  it('prefers alt over aria-label over title', () => {
    const all = '<a href="https://example.test/x" alt="AAAA" aria-label="BBBB" title="CCCC"></a>';
    expect(nameEmptyLinksAndImages(all)).toContain('>AAAA…<');

    const noAlt = '<a href="https://example.test/x" aria-label="BBBB" title="CCCC"></a>';
    expect(nameEmptyLinksAndImages(noAlt)).toContain('>BBBB…<');
  });

  it('calls a link the source never named `image…`', () => {
    expect(nameEmptyLinksAndImages(ICON_LINK)).toBe('<a href="https://example.test/x">image…</a>');
  });

  it('keeps the whole name in title, where the preview came from', () => {
    const named = nameEmptyLinksAndImages('<a href="https://example.test/x" aria-label="See more headlines &amp; perspectives"></a>');
    expect(named).toContain('title="See more headlines &amp; perspectives"');
    expect(named).toContain('>See…<');
  });

  it('takes a name shorter than the preview whole', () => {
    expect(nameEmptyLinksAndImages('<a href="https://example.test/x" alt="Go"></a>')).toContain('>Go…<');
  });

  it('leaves a link that has text', () => {
    const linked = '<a href="https://example.test/x" aria-label="Ignore me">Read this</a>';
    expect(nameEmptyLinksAndImages(linked)).toBe(linked);
  });

  it('hands back the very same string when there is nothing to name', () => {
    const prose = '<p>Nothing to do here</p>';
    expect(nameEmptyLinksAndImages(prose)).toBe(prose);
  });
});

describe('nameEmptyLinksAndImages — an image with no alt', () => {
  it('names an empty alt from aria-label, then title', () => {
    expect(nameEmptyLinksAndImages('<img src="t.png" alt="" aria-label="Reuters logo">'))
      .toBe('<img src="t.png" alt="Reut…" aria-label="Reuters logo" title="Reuters logo">');

    expect(nameEmptyLinksAndImages('<img src="t.png" alt="" title="Reuters logo">'))
      .toBe('<img src="t.png" alt="Reut…" title="Reuters logo">');
  });

  it('calls an image the source never named `image…`', () => {
    expect(nameEmptyLinksAndImages('<img src="t.png" alt="">')).toBe('<img src="t.png" alt="image…">');
  });

  it('treats a missing alt the same as an empty one', () => {
    expect(nameEmptyLinksAndImages('<img src="t.png">')).toBe('<img src="t.png" alt="image…">');
  });

  it('leaves an image whose alt already says something', () => {
    const described = '<img src="t.png" alt="The candidate at a rally">';
    expect(nameEmptyLinksAndImages(described)).toBe(described);
  });

  it('names the image inside a link, and leaves the link itself alone', () => {
    // The anchor has something to show — the picture — so it gets no text of
    // its own, and the picture answers for itself.
    expect(nameEmptyLinksAndImages('<a href="https://example.test/x" aria-label="Open"><img src="t.png" alt=""></a>'))
      .toBe('<a href="https://example.test/x" aria-label="Open"><img src="t.png" alt="image…"></a>');
  });
});

describe('the Google News card', () => {
  const html = readFileSync(__dirname + '/fixtures/google-news-icon-link/input.html', 'utf8');

  /** Brackets with nothing in them: a link with no text, or an image with no alt. */
  const EMPTY_BRACKETS = /\[\]\(/;

  it('leaves no empty brackets in the Markdown', () => {
    const { markdown } = fromHtml(html);

    expect(markdown).not.toMatch(EMPTY_BRACKETS);
    expect(markdown).toContain('[See…](https://news.google.com/stories/');
    expect(markdown).toContain('"See more headlines & perspectives');
    expect(markdown).toContain('![image…](https://news.google.com/api/attachments/');
  });

  it('says the same thing on the hotkey path', () => {
    expect(htmlToMarkdown(html)).not.toMatch(EMPTY_BRACKETS);
  });

  it('names both in the Simple HTML too', () => {
    const { simpleHtml } = fromHtml(html);

    expect(simpleHtml).not.toContain('></a>');
    expect(simpleHtml).not.toContain('alt=""');
    expect(simpleHtml).toContain('>See…</a>');
  });

  it('lets the line breaks around the thumbnail survive', () => {
    // With the brackets named, the link-text tidy in toMarkdown closes on the
    // image's own `]` instead of running to the next one several lines down,
    // so the block breaks Turndown emitted are still there.
    const { markdown } = fromHtml(html);
    const line = (needle) => markdown.split('\n').find((l) => l.includes(needle));

    expect(line('CBC')).not.toBe(line('Abdul El-Sayed wins'));
    expect(line('45 minutes ago')).not.toBe(line('api/attachments'));
    expect(line('45 minutes ago')).not.toBe(line('[See…]'));
  });
});
