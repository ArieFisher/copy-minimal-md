/**
 * An image's drawn size, across the sanitize step.
 *
 * The copy says how big to draw a picture in two places — the width/height
 * attributes, and the same two properties inside the inline style — and the
 * conversion used to discard both, so every image landed at the natural size of
 * the file behind it. These pin what now survives, and what deliberately does
 * not.
 *
 * Simple HTML is what is asserted throughout. It is the entry that goes to the
 * clipboard's text/html and gets pasted somewhere with none of this tool's CSS
 * around it, so it is the one where a missing dimension is a visible defect.
 * Markdown has no size syntax and is unaffected either way; the last block here
 * holds that.
 */
import { describe, it, expect } from 'vitest';

const { fromHtml, toSimpleHtml } = require('./_adapter.js');

/** The <img …> tag alone, so an assertion reads as the tag it is about. */
const imgTag = (html) => html.match(/<img[^>]*>/)[0];

describe('sizing carried on attributes', () => {
  it('keeps width and height', () => {
    const { simpleHtml } = fromHtml('<p><img src="https://x.test/f.png" alt="" width="32" height="32"></p>');
    expect(imgTag(simpleHtml)).toContain('width="32"');
    expect(imgTag(simpleHtml)).toContain('height="32"');
  });

  it('keeps one axis given alone', () => {
    // The other is the file's own proportions, which the browser applies. A
    // second number here would be this pass inventing one.
    const { simpleHtml } = fromHtml('<p><img src="https://x.test/f.png" alt="" width="48"></p>');
    expect(imgTag(simpleHtml)).toContain('width="48"');
    expect(imgTag(simpleHtml)).not.toContain('height=');
  });
});

describe('sizing carried in the inline style', () => {
  it('transcribes pixel width and height into attributes', () => {
    const { simpleHtml } = fromHtml(
      '<p><img src="https://x.test/f.png" alt="" style="border-radius: 12px; width: 64px; height: 64px;"></p>'
    );
    expect(imgTag(simpleHtml)).toContain('width="64"');
    expect(imgTag(simpleHtml)).toContain('height="64"');
  });

  it('does not let the rest of the style through with it', () => {
    // The reason the two properties are copied out rather than the style
    // allowlisted: this declaration would make the recipient's renderer fetch a
    // URL the payload chose.
    const { simpleHtml } = fromHtml(
      '<p><img src="https://x.test/f.png" alt="" style="width: 64px; background-image: url(https://track.test/beacon.png);"></p>'
    );
    expect(imgTag(simpleHtml)).toContain('width="64"');
    expect(simpleHtml).not.toContain('style=');
    expect(simpleHtml).not.toContain('track.test');
  });

  it('rounds a fractional pixel length', () => {
    const { simpleHtml } = fromHtml('<p><img src="https://x.test/f.png" alt="" style="width: 538.003px;"></p>');
    expect(imgTag(simpleHtml)).toContain('width="538"');
  });

  it('reads the axis it was asked for, not one whose name ends the same way', () => {
    // border-width and max-width are not the width of the image.
    const { simpleHtml } = fromHtml(
      '<p><img src="https://x.test/f.png" alt="" style="border-width: 3px; max-width: 900px; height: 14px;"></p>'
    );
    expect(imgTag(simpleHtml)).toContain('height="14"');
    expect(imgTag(simpleHtml)).not.toContain('width=');
  });

  it('lets the style win over an attribute that disagrees', () => {
    // The order the browser resolved them in, on the page the copy came from.
    const { simpleHtml } = fromHtml(
      '<p><img src="https://x.test/f.png" alt="" width="500" style="width: 40px;"></p>'
    );
    expect(imgTag(simpleHtml)).toContain('width="40"');
    expect(imgTag(simpleHtml)).not.toContain('width="500"');
  });

  it('keeps an attribute the style says nothing about', () => {
    const { simpleHtml } = fromHtml(
      '<p><img src="https://x.test/f.png" alt="" width="500" height="80" style="width: 40px;"></p>'
    );
    expect(imgTag(simpleHtml)).toContain('width="40"');
    expect(imgTag(simpleHtml)).toContain('height="80"');
  });
});

describe('lengths that have no attribute form', () => {
  // These attributes are counted in pixels and nothing else. Writing `50%` out
  // as `width="50"` would name a different size that happens to share a number,
  // so the image is left unsized and the render cap catches it instead.
  for (const declared of ['50%', 'auto', '12em', 'calc(100% - 20px)', '10vw']) {
    it(`leaves \`width: ${declared}\` behind`, () => {
      const { simpleHtml } = fromHtml(
        `<p><img src="https://x.test/f.png" alt="" style="width: ${declared};"></p>`
      );
      expect(imgTag(simpleHtml)).not.toContain('width=');
    });
  }
});

describe('the size only a stylesheet knew', () => {
  it('cannot be recovered, because it never reached the clipboard', () => {
    // Sizing written as `.logo { width: 32px }` lives in the site's CSS file.
    // A copy carries the tag, not the file. Pinned so the limit is a stated one
    // rather than a surprise.
    const { simpleHtml } = fromHtml('<p><img src="https://x.test/f.png" alt="" class="logo"></p>');
    expect(imgTag(simpleHtml)).not.toContain('width=');
    expect(imgTag(simpleHtml)).not.toContain('height=');
  });
});

describe('images that were never meant to be seen', () => {
  const gone = (html) => {
    const { simpleHtml, markdown } = fromHtml(html);
    expect(simpleHtml).not.toContain('<img');
    expect(simpleHtml).not.toContain('track.test');
    expect(markdown).not.toContain('track.test');
  };

  it('drops a 1×1 declared on attributes', () => {
    gone('<p>Story<img src="https://track.test/p.gif" width="1" height="1"></p>');
  });

  it('drops a 1×1 declared in the style', () => {
    gone('<p>Story<img src="https://track.test/p.gif" style="width: 1px; height: 1px;"></p>');
  });

  it('drops one that vanishes on a single axis', () => {
    // A 1×100 spacer holds a gap open. It is still not a picture.
    gone('<p>Story<img src="https://track.test/p.gif" width="1" height="100"></p>');
  });

  it('drops a zero', () => {
    gone('<p>Story<img src="https://track.test/p.gif" style="width: 0; height: 0;"></p>');
  });

  it('drops one hidden outright', () => {
    gone('<p>Story<img src="https://track.test/p.gif" style="display: none;"></p>');
    gone('<p>Story<img src="https://track.test/p.gif" style="visibility: hidden;"></p>');
  });

  it('keeps the text either side of it', () => {
    const { markdown } = fromHtml('<p>Before<img src="https://track.test/p.gif" width="1" height="1">After</p>');
    expect(markdown).toBe('BeforeAfter');
  });

  it('leaves a 2px image alone, and every real image above it', () => {
    // No floor in the range where content lives. 14px is the publisher favicon
    // in the Google News fixture; 16px is the common favicon size. The category
    // stops at one pixel and does not creep upward.
    for (const size of [2, 14, 16, 64]) {
      const { simpleHtml } = fromHtml(`<p><img src="https://x.test/f.png" alt="" width="${size}" height="${size}"></p>`);
      expect(imgTag(simpleHtml)).toContain(`width="${size}"`);
    }
  });

  it('takes the link a dropped beacon was the whole of', () => {
    // Otherwise the <a> survives around nothing and Turndown writes `[](href)`:
    // a link with no text, naming a destination the reader cannot see.
    const { markdown, simpleHtml } = fromHtml(
      '<p><a href="https://news.test/s"><img src="https://track.test/p.gif" width="1" height="1"></a></p>'
    );
    expect(markdown).toBe('');
    expect(simpleHtml).not.toContain('<a');
  });

  it('leaves a link that still has something to show', () => {
    const { markdown } = fromHtml(
      '<p><a href="https://news.test/s">Headline<img src="https://track.test/p.gif" width="1" height="1"></a></p>'
    );
    expect(markdown).toBe('[Headline](https://news.test/s)');
  });

  it('does not read a size it was not given as a vanishing one', () => {
    // No declared size at all is unknown, not zero.
    const { simpleHtml } = fromHtml('<p><img src="https://x.test/f.png" alt=""></p>');
    expect(simpleHtml).toContain('<img');
  });
});

describe('the hotkey path derives the same thing', () => {
  it('sizes an image written straight to the clipboard', () => {
    // toSimpleHtml is what cmd+shift+U writes to text/html. It shares the repair
    // pass with the inspector, and this is what holds the two together.
    const simpleHtml = toSimpleHtml('<p><img src="https://x.test/f.png" alt="" style="width: 64px; height: 64px;"></p>');
    expect(imgTag(simpleHtml)).toContain('width="64"');
    expect(imgTag(simpleHtml)).toContain('height="64"');
  });
});

describe('Markdown', () => {
  it('is unchanged — it has no way to say how big a picture is', () => {
    const { markdown } = fromHtml(
      '<p><img src="https://x.test/f.png" alt="Globe logo" width="32" style="height: 32px;"></p>'
    );
    expect(markdown).toBe('![Globe logo](https://x.test/f.png)');
  });
});
