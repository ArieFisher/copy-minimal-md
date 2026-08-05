/**
 * tests/beacon-parity.test.js
 *
 * One cmd+shift+U writes two clipboard entries, and they are produced by two
 * different functions: `Pipeline.htmlToMarkdown` for text/plain, and
 * `Pipeline.htmlToSimpleHtml` — via `Equivalents.toSimpleHtml` — for text/html.
 * Only the second went through `repair`, where the beacon removal lives, so the
 * Markdown path kept every beacon the HTML path dropped.
 *
 * That gap was worse than a straight omission. `nameEmptyLinksAndImages` runs on
 * both paths, and it names any image whose `alt` is empty — which a beacon's is.
 * So the path that skipped the removal did not merely pass a beacon through, it
 * relabelled `![](beacon-url)` as `![image…](beacon-url)`: the tracking src
 * intact, now reading as a picture the sender chose.
 *
 * What these pin is the agreement, not one path's output. A beacon has to be
 * gone from both entries, and a real image has to survive in both — the removal
 * is a category (a pixel or less, or hidden outright), never a size threshold.
 */
import { describe, it, expect, beforeAll } from 'vitest';

let htmlToMarkdown;
let fromHtml;

beforeAll(() => {
  ({ htmlToMarkdown, fromHtml } = require('./_adapter.js'));
});

const BEACON_URL = 'https://tracker.example/pixel.gif?id=abc';
const REAL_URL = 'https://cdn.example/photo.jpg';

/** How a beacon declares itself. Attributes and inline style both count. */
const BEACONS = {
  'width/height attributes': `<img src="${BEACON_URL}" width="1" height="1" alt="">`,
  'a zero-sized image': `<img src="${BEACON_URL}" width="0" height="0" alt="">`,
  'inline style in px': `<img src="${BEACON_URL}" style="width:1px;height:1px" alt="">`,
  'display:none': `<img src="${BEACON_URL}" style="display:none" alt="">`,
  'visibility:hidden': `<img src="${BEACON_URL}" style="visibility:hidden" alt="">`,
};

describe('the Markdown path drops beacons, as the Simple HTML path does', () => {
  for (const [how, tag] of Object.entries(BEACONS)) {
    it(`drops a beacon declared by ${how}`, () => {
      const markdown = htmlToMarkdown(`<p>Real text</p>${tag}`);
      expect(markdown).not.toContain(BEACON_URL);
      expect(markdown.trim()).toBe('Real text');
    });
  }

  it('never lets the naming pass dress a beacon up', () => {
    // The regression itself: before the fix this came back as
    // `![image…](https://tracker.example/pixel.gif?id=abc)`.
    const markdown = htmlToMarkdown(`<p>Real text</p>${BEACONS['width/height attributes']}`);
    expect(markdown).not.toContain('image…');
  });

  it('agrees with what the inspector derives from the same payload', () => {
    const payload = `<p>Real text</p>${BEACONS['width/height attributes']}`;
    const { markdown, simpleHtml } = fromHtml(payload);

    expect(htmlToMarkdown(payload).trim()).toBe(markdown.trim());
    expect(simpleHtml).not.toContain(BEACON_URL);
  });

  it('takes an anchor the beacon was the whole of', () => {
    // Left behind on its own, the <a> becomes `[](href)` — a destination the
    // reader is given no way to see.
    const markdown = htmlToMarkdown(
      `<p>Real text</p><a href="https://example.test/x"><img src="${BEACON_URL}" width="1" height="1" alt=""></a>`
    );
    expect(markdown.trim()).toBe('Real text');
  });

  it('leaves an anchor that still has something to show', () => {
    const markdown = htmlToMarkdown(
      `<a href="https://example.test/x">Read on<img src="${BEACON_URL}" width="1" height="1" alt=""></a>`
    );
    expect(markdown).not.toContain(BEACON_URL);
    expect(markdown).toContain('[Read on](https://example.test/x)');
  });
});

describe('a real image is not a beacon', () => {
  it('keeps a 14px favicon, which is content', () => {
    // The publisher favicon in the Google News fixture. Any floor high enough to
    // catch it would be eating content — which is why the rule is a category.
    const markdown = htmlToMarkdown(`<img src="${REAL_URL}" width="14" height="14" alt="">`);
    expect(markdown).toContain(REAL_URL);
  });

  it('still names a real image the source left undescribed', () => {
    const markdown = htmlToMarkdown(`<img src="${REAL_URL}" width="14" height="14" alt="">`);
    expect(markdown).toBe(`![image…](${REAL_URL})`);
  });

  it('keeps an image that declares no size at all', () => {
    const markdown = htmlToMarkdown(`<img src="${REAL_URL}" alt="A photo">`);
    expect(markdown).toContain(REAL_URL);
  });
});
