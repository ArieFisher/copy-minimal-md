import { describe, it, expect, beforeAll } from 'vitest';

/**
 * Container collapsing — the wrappers sanitize leaves behind.
 *
 * The rule these all turn on: a container is judged by whether it *holds*
 * anything, not by whether it holds text. That is what keeps a <figure> around
 * a thumbnail, and what stops a div being removed over a link with no text of
 * its own.
 */
let collapseContainers;
let toSimpleHtml;

beforeAll(() => {
  ({ collapseContainers, toSimpleHtml } = require('./_adapter.js'));
});

describe('collapseContainers — wrappers around nothing', () => {
  it('takes out a chain of containers holding nothing', () => {
    // The shape a Google News card sanitizes down to once its <button> goes.
    expect(collapseContainers('<div><div><div><div></div><div></div></div></div></div>')).toBe('');
  });

  it('takes the whole chain even when the emptiness is at the bottom', () => {
    expect(collapseContainers('<p>text</p><div><div><div></div></div></div>')).toBe('<p>text</p>');
  });

  it('leaves a container that holds content with no text of its own', () => {
    // The article thumbnail. No text anywhere in it, and removing it would be
    // removing the picture.
    expect(collapseContainers('<figure><img src="t.png" alt=""></figure>'))
      .toBe('<figure><img src="t.png" alt=""></figure>');
    expect(collapseContainers('<div><br></div>')).toBe('<div><br></div>');
    expect(collapseContainers('<div><hr></div>')).toBe('<div><hr></div>');
  });

  it('never removes a container over a link that has no text', () => {
    const linked = '<div><a href="https://example.test/x"></a></div>';
    expect(collapseContainers(linked)).toBe(linked);
  });
});

describe('collapseContainers — one wrapper too many', () => {
  it('unwraps a div whose only child is another container', () => {
    expect(collapseContainers('<div><div>text</div></div>')).toBe('<div>text</div>');
    expect(collapseContainers('<div><div><div>text</div></div></div>')).toBe('<div>text</div>');
  });

  it('keeps a div that holds more than one thing', () => {
    // Both of the divs the Google News card is left with are this shape.
    const two = '<div><div>header</div><a href="x">headline</a></div>';
    expect(collapseContainers(two)).toBe(two);
  });

  it('keeps the child when the wrapper goes, whatever the child is', () => {
    expect(collapseContainers('<div><figure><img src="t.png" alt=""></figure></div>'))
      .toBe('<figure><img src="t.png" alt=""></figure>');
    expect(collapseContainers('<div><section>text</section></div>')).toBe('<section>text</section>');
  });

  it('does not unwrap the containers that say something about what they hold', () => {
    // <figure> and <figcaption> are not interchangeable with a div.
    const fig = '<figure><figcaption>caption</figcaption></figure>';
    expect(collapseContainers(fig)).toBe(fig);
  });

  it('leaves a div holding text alone', () => {
    expect(collapseContainers('<div>text</div>')).toBe('<div>text</div>');
  });
});

describe('collapseContainers — the whitespace a removed wrapper leaves', () => {
  it('drops whitespace that a block boundary would eat anyway', () => {
    expect(collapseContainers('<p>a</p>\n  <p>b</p>')).toBe('<p>a</p><p>b</p>');
    expect(collapseContainers('<div>\n  <p>a</p>\n</div>')).toBe('<div><p>a</p></div>');
  });

  it('joins up the gap a removed wrapper leaves in the middle', () => {
    // Two whitespace runs meet where the empty div was; they have to be seen
    // as one before either can be judged against the elements around it.
    expect(collapseContainers('<p>a</p>\n  <div></div>\n  <p>b</p>')).toBe('<p>a</p><p>b</p>');
  });

  it('keeps the space between two inline elements, which is a word gap', () => {
    expect(collapseContainers('<b>one</b> <i>two</i>')).toBe('<b>one</b> <i>two</i>');
    expect(collapseContainers('<span>one</span> <a href="x">two</a>'))
      .toBe('<span>one</span> <a href="x">two</a>');
  });
});

describe('toSimpleHtml — the collapse in the derivation it belongs to', () => {
  it('reaches the Simple HTML the inspector shows and the hotkey writes', () => {
    // <button> is not allowlisted, so sanitize empties the chain around it and
    // the collapse takes the chain. End to end, through the public entry point.
    const card = '<div><div><div><button aria-label="More"></button></div></div>'
               + '<a href="https://example.test/story">Headline</a></div>';
    expect(toSimpleHtml(card)).toBe('<div><a href="https://example.test/story">Headline</a></div>');
  });

  it('does not flatten a table on the way past', () => {
    const table = '<table><tr><td>a</td><td>b</td></tr></table>';
    expect(toSimpleHtml(table)).toContain('<td>a</td>');
    expect(toSimpleHtml(table)).toContain('<table>');
  });
});
