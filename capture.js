/**
 * Capture — write what the inspector is showing to one self-contained HTML file.
 *
 * A bug in this tool is a bug about bytes: a stray newline, a tab that should
 * have been a cell boundary, a wrapper div that swallowed a line break. Prose
 * loses all three, and the inspector tab closes the moment the tester looks
 * away. So the capture writes the payloads out whole, and redraws the panes
 * with the inspector's own stylesheet so a reader sees what the tester saw.
 *
 * THE SEAM WITH inspector.js
 *
 * Every script on this page is a classic script, so `state` and the four card
 * builders are shared bindings and this file reaches them by bare name. Both
 * views come from flipping `state.view`, calling the builders, and restoring it
 * in a `finally`. That is sound only because the builders return detached nodes
 * and none of them measures the document — see the note above buildPlainCard in
 * inspector.js. `render()`, `fitPanesToWindow()` and `applyZoom()` are never
 * called from here.
 *
 * SAFETY, IN FOUR PARTS
 *
 * 1. The rendered panes are sanitised by the inspector's own renderHtmlInto,
 *    because they are the inspector's own nodes. Reusing the builders means
 *    that call cannot drift from the one the live page makes.
 * 2. scrub() then strips what a static file must not carry: event-handler
 *    attributes, javascript: and data:text/html URLs, and the elements that can
 *    reach outside the document. Belt and braces over DOMPurify.
 * 3. The capture declares its own Content-Security-Policy in a meta tag, and
 *    carries no script element at all. img-src is data: only, so a remote image
 *    in a clipboard payload cannot tell its origin server that the copy was
 *    inspected. scrub() also moves such a src to data-original-src, which keeps
 *    the URL readable as evidence and stops the fetch.
 * 4. Untrusted text becomes a text node before it becomes a string. No template
 *    literal in this file interpolates a payload: the document is assembled as
 *    DOM and serialised once, so the serialiser does the escaping.
 *
 * WHY THE PAYLOADS ARE CARRIED TWICE
 *
 * The HTML parser drops one newline directly after a pre, folds CRLF and a lone
 * CR into a newline, and turns NUL into U+FFFD. A visible block therefore cannot
 * hold a carriage return, and line structure is exactly what this tool's bugs
 * are made of. So the visible blocks are for reading, and a hidden pre with the
 * id capture-payloads holds the same payloads as JSON, where stringify escapes
 * CR, NUL and lone surrogates and parse gives them back. The header says which
 * to trust.
 *
 * JSON rides in a pre and not a script of type application/json because a script
 * element is raw text: a payload holding an end-script tag would escape it and
 * need hand-escaping, which is the failure part 4 exists to rule out. It also
 * keeps the word script out of a file whose selling point is having none.
 *
 * THE CONSOLE RIDES ALONG
 *
 * Every capture carries what the page logged, recorded by console-log.js. There
 * is no selection for it and no empty case: a run that logged nothing says so,
 * because "nothing was logged" is itself a finding.
 */
(function (global) {
    'use strict';

    const CAPTURE_VERSION = 2;

    const CAPTURE_CSP = [
        "script-src 'none'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
        "img-src data:"
    ].join('; ');

    /* ------------------------------------------------------------ filenames */

    const pad2 = (n) => String(n).padStart(2, '0');

    /**
     * The hostname, reduced to something a filename can hold. Chrome strips path
     * separators out of a download name anyway, so build them out here rather
     * than find out afterwards what it left behind.
     */
    function hostSlug(sourceUrl) {
        if (!sourceUrl) return 'no-source';

        let host;
        try {
            host = new URL(sourceUrl).hostname;
        } catch (err) {
            return 'no-source';
        }

        const slug = host.toLowerCase()
            .replace(/^www\./, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
        return slug || 'no-source';
    }

    const dateSlug = (at) => `${at.getFullYear()}-${pad2(at.getMonth() + 1)}-${pad2(at.getDate())}`;

    /** The date-first shape the regression fixture folders already use. */
    function suggestedSlug({ at, sourceUrl }) {
        return `${dateSlug(at)}-${hostSlug(sourceUrl)}`;
    }

    /**
     * Date first, to sort beside the fixtures. Time last, so a second capture of
     * the same page is a new file rather than Chrome's "capture (1)".
     */
    function filenameFor({ at, sourceUrl }) {
        const time = `${pad2(at.getHours())}${pad2(at.getMinutes())}${pad2(at.getSeconds())}`;
        return `capture-${dateSlug(at)}-${hostSlug(sourceUrl)}-${time}.html`;
    }

    /* --------------------------------------------------------- availability */

    /** The four cards, in the order the grid lays them out. */
    const CARD_KEYS = ['plain', 'html', 'markdown', 'simpleHtml'];

    const CARD_LABEL = {
        plain: 'text/plain',
        html: 'text/html',
        markdown: 'Markdown',
        simpleHtml: 'Simple HTML'
    };

    /** The same words the cards and the gutter already use. */
    const WHY = {
        absent: 'not on the clipboard',
        nothing: 'nothing derived',
        haveMarkdown: 'already in text/plain',
        haveSimpleHtml: 'already in text/html'
    };

    /**
     * What this copy has to offer, per card, and the reason when it has none.
     *
     * Independent of the view: a card is empty for what it holds, never for
     * which face of it is showing.
     */
    function availability(s) {
        const on = () => ({ on: true, why: '' });
        const off = (why) => ({ on: false, why });

        return {
            plain: (s.plainPresent || s.mdDone) ? on() : off(WHY.absent),
            html: (s.htmlPresent || s.htmlDone) ? on() : off(WHY.absent),
            markdown: !s.markdown ? off(WHY.nothing)
                : s.markdownOnClipboard ? off(WHY.haveMarkdown)
                    : on(),
            simpleHtml: !s.simpleHtml ? off(WHY.nothing)
                : s.simpleHtmlOnClipboard ? off(WHY.haveSimpleHtml)
                    : on()
        };
    }

    /* ---------------------------------------------------------------- scrub */

    /** Elements a static file must not carry, whatever put them there. */
    const DROP_TAGS = new Set([
        'BASE', 'SCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'LINK', 'META', 'STYLE',
        // Not dangerous, only dead: a button in a saved file can do nothing, and
        // one that still looks pressable is a lie.
        'BUTTON'
    ]);

    const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'xlink:href', 'poster']);

    const BAD_URL = /^\s*(javascript:|data:text\/html)/i;

    /**
     * Make one card safe to write into a file. Mutates and returns it.
     *
     * DOMPurify has already run over everything untrusted inside. This catches
     * what a future builder might add, and unlike DOMPurify it is small enough
     * to assert against directly in a test.
     */
    function scrub(root) {
        for (const foot of root.querySelectorAll('.card-foot')) foot.remove();

        for (const node of [root, ...root.querySelectorAll('*')]) {
            if (node !== root && DROP_TAGS.has(node.tagName)) {
                node.remove();
                continue;
            }

            for (const attr of [...node.attributes]) {
                const name = attr.name.toLowerCase();
                if (name.startsWith('on') || name === 'srcdoc') {
                    node.removeAttribute(attr.name);
                } else if (URL_ATTRS.has(name) && BAD_URL.test(attr.value)) {
                    node.removeAttribute(attr.name);
                }
            }

            // A remote image would fetch when the capture is opened, telling the
            // origin server that the copy was inspected and when. Keep the URL
            // where a reader can see it; take away the fetch.
            if (node.tagName === 'IMG') {
                const src = node.getAttribute('src') || '';
                if (src && !/^data:/i.test(src)) {
                    node.setAttribute('data-original-src', src);
                    node.removeAttribute('src');
                }
            }
        }

        return root;
    }

    /* ------------------------------------------------------------- document */

    const TITLE = 'Clipboard capture';

    const STRAP = 'Redrawn from the payloads below with the extension’s own stylesheet. ' +
        'The panes are the size they were on screen, so one that scrolled here scrolled there. ' +
        'Nothing is lost to that: the verbatim blocks hold every payload whole.';

    const VIEW_HINT = {
        rendered: 'What each entry looks like when something renders it.',
        source: 'The characters each entry is made of, as the inspector shows them: clipboard ' +
            'markup pretty-printed and uppercased, inline image data stood down to a marker.'
    };

    const VIEW_TITLE = { rendered: 'Rendered', source: 'Source' };

    const VERBATIM_HINT = 'Every payload as it stands, with nothing redacted and nothing ' +
        'reformatted. Read these for the bytes. One caveat: an HTML parser folds a carriage ' +
        'return into a newline and drops one newline where a block starts, so where that matters, ' +
        'take the payloads out of the JSON at the end of this file instead. It survives both.';

    const FOOT_NOTE = 'This file carries no script and declares a policy forbidding one. The ' +
        'machine-readable copy of every payload, and of the console rows above, is in a hidden ' +
        'block with the id capture-payloads, as JSON.';

    const NOTES_HINT = 'Why the tester took this capture, and what they wrote about it, as marked ' +
        'and typed in the capture panel. A blank rule is one nobody filled in.';

    const CONSOLE_HINT = 'What the inspector page logged, in the order it logged it, up to the ' +
        'moment Save was pressed. The service worker and the content script log elsewhere and are ' +
        'not here. An indented row sat inside a group; a long argument is cut and marked.';

    const CONSOLE_EMPTY = 'Nothing was logged.';

    /** Two spaces a level, which is what a console draws a group as. */
    const INDENT = '  ';

    /**
     * The one thing a capture cannot work out for itself. Reported and Source
     * are not among them: the header above already carries the capture time and
     * the page the copy came from.
     *
     * It was three fields — Expected, Observed, Cause — and most captures came
     * back with two of them blank. One box asks the same question and gets an
     * answer; the shape the three carried lives on in the placeholder, which
     * changes with the mark.
     *
     * Still an array. `buildDocument` and `notesFor` iterate it, so a second
     * field costs a line here and nothing anywhere else.
     */
    const NOTES_FIELDS = [
        { key: 'note', label: 'Notes' }
    ];

    /**
     * Why the capture was taken, as the tester marked it.
     *
     * The key is what the file records and what an agent sorting a backlog
     * reads. The emoji is for the person who opens the file, and never reaches
     * the JSON: a word survives a grep, a re-encode and a diff, and an emoji
     * survives none of them reliably.
     */
    const INTENTS = {
        positive: { emoji: '\u{1F44D}', label: 'Works as intended' },
        question: { emoji: '\u{1F914}', label: 'A question' },
        negative: { emoji: '\u{1F44E}', label: 'Something is wrong' }
    };

    /**
     * `15:59:40.893` out of an ISO stamp, which is what a console shows and what
     * reads against the capture time in the header above. Anything that is not
     * an ISO stamp goes through as it stands.
     */
    function clockOf(at) {
        const text = String(at || '');
        return /^\d{4}-\d{2}-\d{2}T/.test(text) ? text.slice(11, 23) : text;
    }

    /** The inspector's own el(), against an arbitrary document. */
    function elem(doc, tag, className, text) {
        const node = doc.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = text;
        return node;
    }

    function fact(doc, list, term, value) {
        if (!value) return;
        list.appendChild(elem(doc, 'dt', null, term));
        list.appendChild(elem(doc, 'dd', null, value));
    }

    /**
     * The console section. Written into every capture, empty or not.
     *
     * A row is a time, a level and the text, and the text sits in a pre because
     * a stack trace is lines. Depth becomes leading spaces rather than a style:
     * a reader copying a row out of the file gets the nesting with it.
     */
    function consoleSection(doc, log) {
        const entries = (log && log.entries) || [];
        const dropped = (log && log.dropped) || 0;

        const section = elem(doc, 'section', 'capture-console');
        section.id = 'capture-console';
        section.appendChild(elem(doc, 'h2', 'capture-console-title', 'Console'));
        section.appendChild(elem(doc, 'p', 'capture-console-hint', CONSOLE_HINT));

        if (dropped) {
            section.appendChild(elem(doc, 'p', 'capture-console-dropped',
                `${dropped} earlier ${dropped === 1 ? 'message' : 'messages'} dropped: the buffer keeps the last ${entries.length}.`));
        }

        if (!entries.length) {
            section.appendChild(elem(doc, 'p', 'capture-console-empty', CONSOLE_EMPTY));
            return section;
        }

        const list = elem(doc, 'div', 'capture-log');
        for (const entry of entries) {
            const level = entry.level || 'log';
            const row = elem(doc, 'div', `capture-log-row is-${level}`);
            row.setAttribute('data-level', level);
            if (entry.depth) row.setAttribute('data-depth', String(entry.depth));

            row.appendChild(elem(doc, 'span', 'capture-log-time', clockOf(entry.at)));
            row.appendChild(elem(doc, 'span', 'capture-log-level', level));

            const text = elem(doc, 'pre', 'capture-log-text');
            // The parser eats one newline where a pre starts. Feed it a spare.
            text.textContent = `\n${INDENT.repeat(entry.depth || 0)}${entry.text || ''}`;
            row.appendChild(text);

            list.appendChild(row);
        }
        section.appendChild(list);

        return section;
    }

    /**
     * Assemble the capture and serialise it.
     *
     * Pure: takes nodes and plain data, reads no global state, so a test can
     * drive it with a hand-made card and a hostile payload.
     *
     * `sections` are `{ id, view, node }`, the node being a ready grid.
     * `payloads` are `{ id, entry, label, kind, size, text }`.
     * `intent` is a key of INTENTS, or nothing when the capture is unmarked.
     * `consoleLog` is `{ entries, dropped }` off console-log.js. It is written
     * into the page and into the JSON here rather than by the caller, so no
     * caller can leave it out.
     */
    function buildDocument({ meta, sections, payloads, data, notes, intent, consoleLog, inspectorCss, reportCss }) {
        const doc = document.implementation.createHTMLDocument(TITLE);
        doc.head.textContent = '';

        const charset = doc.createElement('meta');
        charset.setAttribute('charset', 'utf-8');
        doc.head.appendChild(charset);

        const viewport = doc.createElement('meta');
        viewport.setAttribute('name', 'viewport');
        viewport.setAttribute('content', 'width=device-width, initial-scale=1');
        doc.head.appendChild(viewport);

        const csp = doc.createElement('meta');
        csp.setAttribute('http-equiv', 'Content-Security-Policy');
        csp.setAttribute('content', CAPTURE_CSP);
        doc.head.appendChild(csp);

        doc.head.appendChild(elem(doc, 'title', null, TITLE));
        doc.head.appendChild(elem(doc, 'style', null, inspectorCss || ''));
        doc.head.appendChild(elem(doc, 'style', null, reportCss || ''));

        // The zoom and the pane caps the copy was seen at. Last, so it wins.
        const vars = [
            `  --preview-zoom: ${meta.zoom};`,
            meta.paneCap ? `  --pane-cap: ${meta.paneCap};` : '',
            meta.paneCapHtml ? `  --pane-cap-html: ${meta.paneCapHtml};` : ''
        ].filter(Boolean).join('\n');
        doc.head.appendChild(elem(doc, 'style', null, `:root {\n${vars}\n}\n`));

        const page = elem(doc, 'div', 'capture-page');

        const header = elem(doc, 'header', 'capture-header');
        header.appendChild(elem(doc, 'h1', 'capture-title', TITLE));
        header.appendChild(elem(doc, 'p', 'capture-strap', STRAP));

        const facts = elem(doc, 'dl', 'capture-facts');
        fact(doc, facts, 'Source', meta.sourceUrl || 'not recorded');
        fact(doc, facts, 'Captured', meta.capturedAt);
        fact(doc, facts, 'Extension', `v${meta.extensionVersion}`);
        fact(doc, facts, 'Platform', meta.platform);
        fact(doc, facts, 'Preview zoom', `${Math.round(meta.zoom * 100)}%`);
        fact(doc, facts, 'Capture width', meta.captureWidth ? `${meta.captureWidth}px` : '');
        fact(doc, facts, 'Derived from', meta.derivedFrom || 'nothing');
        header.appendChild(facts);
        page.appendChild(header);

        const notesBox = elem(doc, 'section', 'capture-notes');
        notesBox.appendChild(elem(doc, 'h2', 'capture-notes-title', 'Notes'));
        notesBox.appendChild(elem(doc, 'p', 'capture-notes-hint', NOTES_HINT));
        const notesList = elem(doc, 'dl');

        // hasOwn, not a bare lookup: `intent` carries a key from the page, and
        // a bare INTENTS[intent] answers 'constructor' with something truthy
        // off the prototype, which lands in the file as "undefined undefined".
        const mark = Object.hasOwn(INTENTS, intent || '') ? INTENTS[intent] : null;

        // The mark goes first: a reader placing this file wants it before the
        // prose, and an unmarked capture is a blank rule like any other.
        notesList.appendChild(elem(doc, 'dt', null, 'Intent'));
        notesList.appendChild(elem(doc, 'dd', mark ? 'is-filled is-intent' : null,
            mark ? `${mark.emoji} ${mark.label}` : ''));

        for (const field of NOTES_FIELDS) {
            const value = ((notes && notes[field.key]) || '').trim();
            notesList.appendChild(elem(doc, 'dt', null, field.label));
            notesList.appendChild(elem(doc, 'dd', value ? 'is-filled' : null, value));
        }
        notesBox.appendChild(notesList);
        page.appendChild(notesBox);

        for (const section of sections) {
            page.appendChild(elem(doc, 'h2', 'capture-view-title', VIEW_TITLE[section.view]));
            page.appendChild(elem(doc, 'p', 'capture-view-hint', VIEW_HINT[section.view]));
            const wrap = elem(doc, 'section', 'capture-view');
            wrap.id = section.id;
            wrap.appendChild(doc.importNode(section.node, true));
            page.appendChild(wrap);
        }

        if (payloads.length) {
            page.appendChild(elem(doc, 'h2', 'capture-verbatim-title', 'Payloads, verbatim'));
            page.appendChild(elem(doc, 'p', 'capture-verbatim-hint', VERBATIM_HINT));

            const blocks = elem(doc, 'div', 'capture-blocks');
            for (const payload of payloads) {
                const block = elem(doc, 'div', 'capture-block');

                const blockHead = elem(doc, 'div', 'capture-block-head');
                const nameClass = payload.kind === 'mime'
                    ? (payload.entry === 'text/html' ? 'card-name-mime is-html' : 'card-name-mime')
                    : 'card-name-derived';
                blockHead.appendChild(elem(doc, 'span', nameClass, payload.label));
                blockHead.appendChild(elem(doc, 'span', 'card-meta', payload.size));
                block.appendChild(blockHead);

                const body = elem(doc, 'pre', 'capture-block-body');
                body.id = payload.id;
                body.setAttribute('data-entry', payload.entry);
                // The parser eats one newline where a pre starts. Feed it a spare.
                body.textContent = `\n${payload.text}`;
                block.appendChild(body);

                blocks.appendChild(block);
            }
            page.appendChild(blocks);
        }

        page.appendChild(consoleSection(doc, consoleLog));

        page.appendChild(elem(doc, 'p', 'capture-foot-note', FOOT_NOTE));
        doc.body.appendChild(page);

        const log = {
            entries: (consoleLog && consoleLog.entries) || [],
            dropped: (consoleLog && consoleLog.dropped) || 0
        };
        const island = elem(doc, 'pre', null, JSON.stringify({ ...data, console: log }, null, 2));
        island.id = 'capture-payloads';
        island.hidden = true;
        doc.body.appendChild(island);

        return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}\n`;
    }

    global.Capture = {
        CAPTURE_VERSION,
        CAPTURE_CSP,
        CARD_KEYS,
        CARD_LABEL,
        NOTES_FIELDS,
        INTENTS,
        WHY,
        hostSlug,
        dateSlug,
        filenameFor,
        suggestedSlug,
        availability,
        scrub,
        clockOf,
        buildDocument
    };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports) {
    module.exports = (typeof window !== 'undefined' ? window : globalThis).Capture;
}
