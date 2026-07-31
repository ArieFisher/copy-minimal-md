import { describe, it, expect, beforeAll } from 'vitest';

/**
 * The inline-style policy — what a clipboard payload's own CSS is allowed to do
 * once the inspector renders it.
 *
 * These cover `isAllowed`, which is pure and answers the same way everywhere.
 * `filter` is deliberately not covered here: it splits declarations with the
 * host's CSS parser, and jsdom's knows a subset of what Chrome's does, so a
 * green run would say nothing about the browser the extension ships in. The
 * end-to-end behaviour is in tests/e2e/inspector.spec.js.
 */
let InlineStyle;

beforeAll(() => {
  InlineStyle = require('../inline-style.js');
});

describe('InlineStyle.isAllowed — the formatting a copy carries', () => {
  it('keeps what a Sheets copy uses to say how a cell looks', () => {
    // Every one of these is lifted from a real Sheets text/html payload.
    expect(InlineStyle.isAllowed('background-color', 'rgb(255, 255, 0)')).toBe(true);
    expect(InlineStyle.isAllowed('font-style', 'italic')).toBe(true);
    expect(InlineStyle.isAllowed('font-family', '"Bree Serif"')).toBe(true);
    expect(InlineStyle.isAllowed('color', 'rgb(0, 0, 255)')).toBe(true);
    expect(InlineStyle.isAllowed('font-size', '16pt')).toBe(true);
    expect(InlineStyle.isAllowed('border', '1px solid rgb(204, 204, 204)')).toBe(true);
    expect(InlineStyle.isAllowed('vertical-align', 'top')).toBe(true);
    expect(InlineStyle.isAllowed('padding', '2px 3px')).toBe(true);
  });

  it('keeps a declaration marked important', () => {
    expect(InlineStyle.isAllowed('font-weight', 'bold')).toBe(true);
  });
});

describe('InlineStyle.isAllowed — declarations that fetch', () => {
  it('refuses url(), whichever property carries it', () => {
    expect(InlineStyle.isAllowed('background-image', 'url(http://tracker.test/b.png)')).toBe(false);
    expect(InlineStyle.isAllowed('border-image-source', 'url(http://tracker.test/b.png)')).toBe(false);
    expect(InlineStyle.isAllowed('list-style-image', 'url(http://tracker.test/b.png)')).toBe(false);
    expect(InlineStyle.isAllowed('mask-image', 'url(http://tracker.test/b.png)')).toBe(false);
    expect(InlineStyle.isAllowed('cursor', 'url(http://tracker.test/c.cur), auto')).toBe(false);
    expect(InlineStyle.isAllowed('content', 'url(http://tracker.test/b.png)')).toBe(false);
  });

  it('refuses a data: url as well — the point is that nothing loads', () => {
    expect(InlineStyle.isAllowed('background-image', 'url(data:image/gif;base64,R0lGOD)')).toBe(false);
  });

  it('refuses the image functions that fetch without writing url()', () => {
    expect(InlineStyle.isAllowed('background-image', 'image-set("//tracker.test/b.png" 1x)')).toBe(false);
    expect(InlineStyle.isAllowed('background-image', '-webkit-image-set("//tracker.test/b.png" 1x)')).toBe(false);
    expect(InlineStyle.isAllowed('background-image', 'cross-fade(url(a.png), url(b.png), 50%)')).toBe(false);
    expect(InlineStyle.isAllowed('background-image', 'image("//tracker.test/b.png")')).toBe(false);
    expect(InlineStyle.isAllowed('background-image', 'element(#src)')).toBe(false);
    expect(InlineStyle.isAllowed('background-image', 'paint(worklet)')).toBe(false);
  });

  it('does not mistake a plain word for the function of the same name', () => {
    // "image" and "url" appear inside plenty of innocent values; it is the
    // opening paren that makes one a fetch.
    expect(InlineStyle.isAllowed('font-family', 'url, sans-serif')).toBe(true);
    expect(InlineStyle.isAllowed('background-image', 'none')).toBe(true);
    expect(InlineStyle.isAllowed('background-image', 'linear-gradient(red, blue)')).toBe(true);
  });

  it('refuses the legacy scripting hooks', () => {
    expect(InlineStyle.isAllowed('width', 'expression(alert(1))')).toBe(false);
    expect(InlineStyle.isAllowed('-moz-binding', 'url(x.xml#y)')).toBe(false);
    expect(InlineStyle.isAllowed('behavior', 'url(#default#time2)')).toBe(false);
  });
});

describe('InlineStyle.isAllowed — declarations that leave the card', () => {
  it('refuses fixed and sticky positioning', () => {
    expect(InlineStyle.isAllowed('position', 'fixed')).toBe(false);
    expect(InlineStyle.isAllowed('position', '  fixed  ')).toBe(false);
    expect(InlineStyle.isAllowed('position', 'FIXED')).toBe(false);
    expect(InlineStyle.isAllowed('position', 'sticky')).toBe(false);
    expect(InlineStyle.isAllowed('position', '-webkit-sticky')).toBe(false);
  });

  it('allows the positioning the card contains', () => {
    // `contain: layout paint` on the render body makes it the containing block,
    // so an absolutely positioned payload element stays inside it.
    expect(InlineStyle.isAllowed('position', 'absolute')).toBe(true);
    expect(InlineStyle.isAllowed('position', 'relative')).toBe(true);
    expect(InlineStyle.isAllowed('z-index', '9999')).toBe(true);
  });
});

describe('InlineStyle.isAllowed — reaching for the inspector itself', () => {
  it('refuses custom properties, which name the inspector\'s design tokens', () => {
    expect(InlineStyle.isAllowed('--border-neutral', 'transparent')).toBe(false);
    expect(InlineStyle.isAllowed('--card-bg', 'black')).toBe(false);
    expect(InlineStyle.isAllowed('--anything', 'red')).toBe(false);
  });

  it('refuses a property name that is not one', () => {
    expect(InlineStyle.isAllowed('background-image/*x*/', 'red')).toBe(false);
    expect(InlineStyle.isAllowed('color;background', 'red')).toBe(false);
    expect(InlineStyle.isAllowed('9color', 'red')).toBe(false);
    expect(InlineStyle.isAllowed('', 'red')).toBe(false);
  });

  it('refuses an empty value', () => {
    expect(InlineStyle.isAllowed('color', '')).toBe(false);
    expect(InlineStyle.isAllowed('color', null)).toBe(false);
  });
});
