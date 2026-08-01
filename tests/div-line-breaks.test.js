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

const { htmlToMarkdown } = require('./_adapter.js');

const html = readFileSync(__dirname + '/fixtures/google-news-div-prose/input.html', 'utf8');

function lineContaining(markdown, needle) {
  return markdown.split('\n').find((line) => line.includes(needle));
}

describe('div-based prose keeps its block breaks', () => {
  // ALLOWED_TAGS omits `div`, so this pair currently fails: DOMPurify unwraps
  // every div in the fixture and the four blocks below collapse onto one
  // line. Flips to a normal `it` once div (and its block-container kin) are
  // allowlisted in pipeline.js and equivalents.js.
  it.fails('does not run the source, headline, timestamp and byline onto one line', () => {
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

  it.fails('breaks the headline link from the timestamp that follows it', () => {
    const md = htmlToMarkdown(html);

    const headlineLine = lineContaining(md, 'Japan may have sold up to $59 billion');
    const timeLine = lineContaining(md, '8 hours ago');

    expect(headlineLine).not.toBe(timeLine);
  });
});
