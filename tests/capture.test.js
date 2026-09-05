/**
 * The pure half of the capture feature: filenames, availability, the scrub pass
 * and the document builder.
 *
 * What is deliberately not here: collecting the cards, fetching the stylesheets
 * and handing a blob to the browser. Those read `state` and the inspector's card
 * builders, and the only honest test of them is an extension running in a real
 * Chromium — tests/e2e/capture.spec.js.
 */
import { describe, it, expect } from 'vitest';
const Capture = require('../capture.js');

/* ---------------------------------------------------------------- helpers */

const parse = (html) => new DOMParser().parseFromString(html, 'text/html');

/** A card the builders would have produced, with whatever markup a test needs. */
function card(inner = '') {
    const node = document.createElement('div');
    node.className = 'card card--clipboard card--plain';
    node.innerHTML = inner;
    return node;
}

function build(overrides = {}) {
    const at = new Date('2026-09-04T14:32:10.514Z');
    return Capture.buildDocument({
        meta: {
            at,
            capturedAt: at.toISOString(),
            extensionVersion: '0.11.0',
            sourceUrl: 'https://docs.google.com/document/d/abc',
            platform: 'Test/1.0',
            zoom: 0.75,
            captureWidth: 1456,
            paneCap: '260px',
            paneCapHtml: '380px',
            derivedFrom: 'text/html'
        },
        sections: [],
        payloads: [],
        data: { captureVersion: 1 },
        inspectorCss: '.card { color: red }',
        reportCss: '.capture-page { margin: 0 }',
        ...overrides
    });
}

/** One verbatim block carrying exactly this text. */
const withPayload = (text) => build({
    payloads: [{
        id: 'payload-text-html',
        entry: 'text/html',
        label: 'text/html',
        kind: 'mime',
        size: '1 KB',
        text
    }],
    data: { captureVersion: 1, payloads: { html: text }, equivalents: {} }
});

/* ------------------------------------------------------------- filenames */

describe('filenameFor', () => {
    const at = new Date(2026, 8, 4, 14, 32, 10);

    it('puts the date first and the time last', () => {
        expect(Capture.filenameFor({ at, sourceUrl: 'https://docs.google.com/x' }))
            .toBe('capture-2026-09-04-docs-google-com-143210.html');
    });

    it('drops a www prefix', () => {
        expect(Capture.filenameFor({ at, sourceUrl: 'https://www.nytimes.com/' }))
            .toContain('-nytimes-com-');
    });

    it('says so when there is no URL', () => {
        expect(Capture.filenameFor({ at, sourceUrl: '' })).toContain('-no-source-');
        expect(Capture.filenameFor({ at, sourceUrl: 'not a url' })).toContain('-no-source-');
    });

    it('leaves no path separator for Chrome to strip', () => {
        const name = Capture.filenameFor({ at, sourceUrl: 'https://a.b.c.example.co.uk/deep/path?q=1' });
        expect(name).not.toMatch(/[/\\:]/);
        expect(name).toBe('capture-2026-09-04-a-b-c-example-co-uk-143210.html');
    });

    it('gives the fixture slug the same shape the regressions folder uses', () => {
        expect(Capture.suggestedSlug({ at, sourceUrl: 'https://news.google.com/' }))
            .toBe('2026-09-04-news-google-com');
    });
});

/* ---------------------------------------------------------- availability */

describe('availability', () => {
    const base = {
        plainPresent: false, htmlPresent: false, mdDone: false, htmlDone: false,
        markdown: '', simpleHtml: '', markdownOnClipboard: false, simpleHtmlOnClipboard: false
    };

    it('offers all four when the copy carries both entries and both derive', () => {
        const a = Capture.availability({
            ...base, plainPresent: true, htmlPresent: true, markdown: '# x', simpleHtml: '<p>x</p>'
        });
        expect([a.plain.on, a.html.on, a.markdown.on, a.simpleHtml.on]).toEqual([true, true, true, true]);
    });

    it('names an absent clipboard entry', () => {
        const a = Capture.availability({ ...base, htmlPresent: true, markdown: '# x' });
        expect(a.plain).toEqual({ on: false, why: 'not on the clipboard' });
        expect(a.html.on).toBe(true);
    });

    it('counts an entry the inspector has already replaced', () => {
        const a = Capture.availability({ ...base, mdDone: true, htmlDone: true });
        expect(a.plain.on).toBe(true);
        expect(a.html.on).toBe(true);
    });

    it('says nothing was derived when nothing was', () => {
        const a = Capture.availability({ ...base, plainPresent: true });
        expect(a.markdown).toEqual({ on: false, why: 'nothing derived' });
        expect(a.simpleHtml).toEqual({ on: false, why: 'nothing derived' });
    });

    it('switches off an equivalent the clipboard already holds', () => {
        const a = Capture.availability({
            ...base, plainPresent: true, htmlPresent: true,
            markdown: '# x', simpleHtml: '<p>x</p>',
            markdownOnClipboard: true, simpleHtmlOnClipboard: true
        });
        expect(a.markdown).toEqual({ on: false, why: 'already in text/plain' });
        expect(a.simpleHtml).toEqual({ on: false, why: 'already in text/html' });
    });

    it('does not depend on which view is showing', () => {
        const snapshot = { ...base, plainPresent: true, markdown: '# x' };
        expect(Capture.availability(snapshot)).toEqual(Capture.availability(snapshot));
    });
});

/* ----------------------------------------------------------------- scrub */

describe('scrub', () => {
    it('strips event-handler attributes', () => {
        const node = Capture.scrub(card('<img alt="x" onerror="alert(1)"><p onclick="x()">hi</p>'));
        expect(node.querySelector('img').hasAttribute('onerror')).toBe(false);
        expect(node.querySelector('p').hasAttribute('onclick')).toBe(false);
        expect(node.querySelector('p').textContent).toBe('hi');
    });

    it('strips javascript: and data:text/html URLs, keeping the element', () => {
        const node = Capture.scrub(card(
            '<a href="javascript:alert(1)">a</a><a href="data:text/html,<script>x</script>">b</a>'
        ));
        for (const link of node.querySelectorAll('a')) expect(link.hasAttribute('href')).toBe(false);
        expect(node.querySelectorAll('a')).toHaveLength(2);
    });

    it('keeps an ordinary link', () => {
        const node = Capture.scrub(card('<a href="https://example.com/x">a</a>'));
        expect(node.querySelector('a').getAttribute('href')).toBe('https://example.com/x');
    });

    it('drops the elements a static file must not carry', () => {
        const node = Capture.scrub(card(
            '<base href="https://evil.test/"><iframe></iframe><form></form><style>p{}</style><p>kept</p>'
        ));
        expect(node.querySelector('base')).toBeNull();
        expect(node.querySelector('iframe')).toBeNull();
        expect(node.querySelector('form')).toBeNull();
        expect(node.querySelector('style')).toBeNull();
        expect(node.querySelector('p').textContent).toBe('kept');
    });

    it('drops dead controls and the foot that holds them', () => {
        const node = Capture.scrub(card(
            '<div class="card-foot"><button>Copy</button></div><span>body</span>'
        ));
        expect(node.querySelector('.card-foot')).toBeNull();
        expect(node.querySelector('button')).toBeNull();
        expect(node.querySelector('span').textContent).toBe('body');
    });

    it('takes the fetch off a remote image and keeps the URL as evidence', () => {
        const node = Capture.scrub(card('<img src="https://tracker.test/pixel.png" alt="cell">'));
        const img = node.querySelector('img');
        expect(img.hasAttribute('src')).toBe(false);
        expect(img.getAttribute('data-original-src')).toBe('https://tracker.test/pixel.png');
        expect(img.getAttribute('alt')).toBe('cell');
    });

    it('leaves an inline image alone', () => {
        const src = 'data:image/png;base64,iVBORw0KGgo=';
        const img = Capture.scrub(card(`<img src="${src}">`)).querySelector('img');
        expect(img.getAttribute('src')).toBe(src);
        expect(img.hasAttribute('data-original-src')).toBe(false);
    });
});

/* -------------------------------------------------------- the whole file */

describe('buildDocument', () => {
    it('declares a policy that forbids script, and carries none', () => {
        const doc = parse(build());
        const csp = doc.querySelector('meta[http-equiv="Content-Security-Policy"]');
        expect(csp.getAttribute('content')).toContain("script-src 'none'");
        expect(csp.getAttribute('content')).toContain('img-src data:');
        expect(doc.querySelectorAll('script')).toHaveLength(0);
    });

    it('inlines both stylesheets and asks for nothing over the network', () => {
        const doc = parse(build());
        const styles = [...doc.querySelectorAll('style')].map((s) => s.textContent).join('\n');
        expect(styles).toContain('.card { color: red }');
        expect(styles).toContain('.capture-page { margin: 0 }');
        expect(doc.querySelectorAll('link')).toHaveLength(0);
    });

    it('reproduces the zoom and the pane caps the copy was seen at', () => {
        const styles = [...parse(build()).querySelectorAll('style')].map((s) => s.textContent).join('\n');
        expect(styles).toContain('--preview-zoom: 0.75');
        expect(styles).toContain('--pane-cap: 260px');
        expect(styles).toContain('--pane-cap-html: 380px');
    });

    it('records where the copy came from and what drew it', () => {
        const text = parse(build()).querySelector('.capture-facts').textContent;
        expect(text).toContain('https://docs.google.com/document/d/abc');
        expect(text).toContain('v0.11.0');
        expect(text).toContain('75%');
        expect(text).toContain('1456px');
    });

    it('leaves out a section that was not selected', () => {
        const doc = parse(build({
            sections: [{ id: 'view-source', view: 'source', node: card('<span>only source</span>') }]
        }));
        expect(doc.getElementById('view-source')).not.toBeNull();
        expect(doc.getElementById('view-rendered')).toBeNull();
    });

    it('carries a selected card into its view section', () => {
        const doc = parse(build({
            sections: [{ id: 'view-rendered', view: 'rendered', node: card('<b>drawn</b>') }]
        }));
        expect(doc.querySelector('#view-rendered .card--plain b').textContent).toBe('drawn');
    });

    describe('a hostile payload', () => {
        const HOSTILE = '</pre><script>alert(1)</script><img src=x onerror=alert(2)>' +
            '<a href="javascript:alert(3)">x</a><base href="https://evil.test/">';

        it('cannot break out of its verbatim block', () => {
            const doc = parse(withPayload(HOSTILE));
            expect(doc.querySelectorAll('script')).toHaveLength(0);
            expect(doc.querySelectorAll('base')).toHaveLength(0);
            expect(doc.querySelectorAll('img')).toHaveLength(0);
            expect(doc.getElementById('payload-text-html').textContent).toContain('<script>alert(1)</script>');
        });

        it('cannot break out of the JSON block either', () => {
            const doc = parse(withPayload(HOSTILE));
            const data = JSON.parse(doc.getElementById('capture-payloads').textContent);
            expect(data.payloads.html).toBe(HOSTILE);
        });
    });

    describe('byte fidelity', () => {
        // Everything a clipboard payload throws at a text carrier. CR and NUL
        // are the two an HTML parser will not give back, which is why the JSON
        // block exists.
        const NASTY = {
            'ampersands and angles': 'a & b < c > d',
            'quotes': `he said "x" and 'y'`,
            'tabs': 'a\tb\tc',
            'trailing spaces': 'a   \nb  ',
            'a leading newline': '\n\nstarts blank',
            'CRLF': 'one\r\ntwo\r\nthree',
            'a lone CR': 'one\rtwo',
            'NUL': 'a b',
            'astral emoji': 'a 👍🏽 b',
            'a lone surrogate': 'a\ud800b'
        };

        for (const [name, text] of Object.entries(NASTY)) {
            it(`round-trips ${name} through the JSON block`, () => {
                const doc = parse(withPayload(text));
                const data = JSON.parse(doc.getElementById('capture-payloads').textContent);
                expect(data.payloads.html).toBe(text);
            });
        }

        it('round-trips everything but CR and NUL through the visible block', () => {
            // Recorded, not wished away: a visible block is for reading, and the
            // JSON above is what a fixture importer should take.
            for (const [name, text] of Object.entries(NASTY)) {
                if (name === 'CRLF' || name === 'a lone CR' || name === 'NUL') continue;
                const doc = parse(withPayload(text));
                expect(doc.getElementById('payload-text-html').textContent).toBe(text);
            }
        });

        it('guards the newline the parser eats where a block starts', () => {
            // The builder writes a spare newline and the parser takes it, which
            // is how a payload that opens on a blank line survives at all.
            expect(parse(withPayload('first line')).getElementById('payload-text-html').textContent)
                .toBe('first line');
            expect(parse(withPayload('\n\nblank first')).getElementById('payload-text-html').textContent)
                .toBe('\n\nblank first');
        });

        it('folds a carriage return in the visible block, and loses NUL', () => {
            // The two the JSON block exists for. A carriage return always comes
            // back as a newline; what a parser does with NUL is its own business
            // — jsdom drops it, another may stand in U+FFFD — so the claim here
            // is only that it does not survive, which is what decides whether a
            // reader may trust this block.
            expect(parse(withPayload('one\r\ntwo')).getElementById('payload-text-html').textContent)
                .toBe('one\ntwo');
            expect(parse(withPayload('a\u0000b')).getElementById('payload-text-html').textContent)
                .not.toBe('a\u0000b');
        });
    });

    it('names each verbatim block by the entry it holds', () => {
        const doc = parse(withPayload('x'));
        const block = doc.getElementById('payload-text-html');
        expect(block.getAttribute('data-entry')).toBe('text/html');
        expect(block.closest('.capture-block').querySelector('.card-name-mime').textContent).toBe('text/html');
    });

    it('hides the JSON block without hiding it from a parser', () => {
        const doc = parse(build({ data: { captureVersion: 1, suggestedSlug: '2026-09-04-x' } }));
        const island = doc.getElementById('capture-payloads');
        expect(island.hasAttribute('hidden')).toBe(true);
        expect(JSON.parse(island.textContent).suggestedSlug).toBe('2026-09-04-x');
    });

    it('opens with a doctype so it renders in standards mode', () => {
        expect(build().startsWith('<!DOCTYPE html>')).toBe(true);
    });

    describe('notes', () => {
        const terms = (html) =>
            [...parse(html).querySelectorAll('.capture-notes dt')].map((dt) => dt.textContent);

        const values = (html) =>
            [...parse(html).querySelectorAll('.capture-notes dd')].map((dd) => dd.textContent);

        it('asks for three fields, in the order a tester fills them', () => {
            expect(terms(build())).toEqual(['Expected', 'Observed', 'Cause']);
        });

        it('leaves out what the header already records', () => {
            expect(terms(build())).not.toContain('Reported');
            expect(terms(build())).not.toContain('Source');
        });

        it('writes what was typed', () => {
            const html = build({ notes: { expected: 'a table', observed: 'one long line' } });
            expect(values(html)).toEqual(['a table', 'one long line', '']);
        });

        it('marks a filled field so it reads as prose and not as a blank rule', () => {
            const doc = parse(build({ notes: { observed: 'one long line' } }));
            const [expected, observed] = doc.querySelectorAll('.capture-notes dd');
            expect(expected.className).toBe('');
            expect(observed.className).toBe('is-filled');
        });

        it('keeps the blank rule for a field left empty or blank', () => {
            const doc = parse(build({ notes: { expected: '   ', observed: '' } }));
            for (const dd of doc.querySelectorAll('.capture-notes dd')) {
                expect(dd.textContent).toBe('');
                expect(dd.className).toBe('');
            }
        });

        it('escapes a note rather than letting it become markup', () => {
            const doc = parse(build({ notes: { cause: '<img src=x onerror=alert(1)>' } }));
            const dd = doc.querySelectorAll('.capture-notes dd')[2];
            expect(dd.querySelector('img')).toBe(null);
            expect(dd.textContent).toBe('<img src=x onerror=alert(1)>');
        });
    });
});
