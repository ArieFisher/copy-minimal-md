/**
 * PlainKind.of — what the inspector's text/plain card draws in its rendered
 * pane. 'text' is the answer that makes the rendered pane the source pane
 * again, so a false positive here is what costs: it redraws a payload whose
 * characters were the point.
 */
import { describe, it, expect } from 'vitest';

const PlainKind = require('../plain-kind.js');

describe('plain text', () => {
    it('reads prose as text', () => {
        expect(PlainKind.of('The quick brown fox jumps over the lazy dog.')).toBe('text');
        expect(PlainKind.of('Line one\nLine two\nLine three')).toBe('text');
    });

    it('reads a spreadsheet copy as text', () => {
        expect(PlainKind.of('yellow highlight\titalics\nfunny font\tblue')).toBe('text');
        expect(PlainKind.of('Region 1\t1000\nRegion 2\t2000')).toBe('text');
    });

    it('reads an empty entry as text', () => {
        expect(PlainKind.of('')).toBe('text');
        expect(PlainKind.of(null)).toBe('text');
    });

    it('does not take arithmetic for markup', () => {
        expect(PlainKind.of('a < b and c > d')).toBe('text');
        expect(PlainKind.of('5 < 6')).toBe('text');
    });

    it('does not take a hyphen mid-sentence for a list', () => {
        expect(PlainKind.of('one - two - three')).toBe('text');
    });

    it('does not take snake_case for emphasis', () => {
        expect(PlainKind.of('call foo_bar_baz with the_other_thing')).toBe('text');
    });
});

describe('markdown', () => {
    it('reads the table this extension writes', () => {
        const table = '| Name | Age |\n| --- | --- |\n| Alice | 30 |\n| Bob | 25 |';
        expect(PlainKind.of(table)).toBe('markdown');
    });

    it.each([
        ['heading', '# Title\n\nsome text'],
        ['deep heading', '###### Title'],
        ['quote', '> quoted line'],
        ['fence', '```js\nconst a = 1;\n```'],
        ['dash list', '- one\n- two'],
        ['star list', '* one\n* two'],
        ['numbered list', '1. one\n2. two'],
        ['rule', 'above\n\n---\n\nbelow'],
        ['link', 'see [the docs](https://example.com) for more'],
        ['image', 'an ![alt text](https://example.com/a.png) inline'],
        ['bold', 'this is **important** text'],
        ['strikethrough', 'this is ~~gone~~ now'],
        ['code span', 'call `render()` first'],
    ])('reads a %s as markdown', (_name, text) => {
        expect(PlainKind.of(text)).toBe('markdown');
    });

    it('wins over markup, which markdown carries through anyway', () => {
        expect(PlainKind.of('# Title\n\n<p>a paragraph</p>')).toBe('markdown');
    });

    it('reads windows line endings', () => {
        expect(PlainKind.of('# Title\r\n\r\nsome text')).toBe('markdown');
    });
});

describe('html', () => {
    it('reads an element that closes', () => {
        expect(PlainKind.of('<p>a paragraph</p>')).toBe('html');
        expect(PlainKind.of('<table><tr><td>cell</td></tr></table>')).toBe('html');
    });

    it('reads an element that never closes', () => {
        expect(PlainKind.of('one line<br>another line')).toBe('html');
        expect(PlainKind.of('<img src="a.png" alt="a">')).toBe('html');
    });

    it('reads a document header', () => {
        expect(PlainKind.of('<!DOCTYPE html>\n<html><body>hi</body></html>')).toBe('html');
    });

    it('does not read an unclosed lone tag as markup', () => {
        expect(PlainKind.of('the <section marker in the log')).toBe('text');
    });
});
