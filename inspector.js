/* =========================================================================
   Clipboard Inspector

   Shows what is actually on the clipboard next to the structure-preserving
   equivalents, and lets the user swap one or both entries for them.

   Layout is a two-column comparison: the real clipboard on the left, the
   equivalents on the right, aligned row-by-row, with the replace actions in
   the gutter between them pointing left — Markdown replaces text/plain,
   Simple HTML replaces text/html.

   Nothing is written to the clipboard until the user asks for it; the payloads
   read at startup are kept in memory so Undo can put them back.
   ========================================================================= */

/* ------------------------------------------------------------- formatting */

function formatBytes(bytes) {
    if (!bytes) return '0 B';
    const k = 1024;
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), units.length - 1);
    const size = parseFloat((bytes / Math.pow(k, i)).toFixed(1));
    return `${size} ${units[i]}`;
}

function byteLength(text) {
    return new Blob([text || '']).size;
}

/** Inline base64 images make the source pane unreadable — stand them in. */
function redactBase64(text) {
    if (!text) return text;
    return text.replace(/(data:image\/[^;]+;base64,)[a-zA-Z0-9+/=]+/g, '$1[IMAGE_BINARY]');
}

/**
 * Pretty-print HTML using js-beautify for the source pane.
 * Clipboard HTML is uppercased so the tag soup is easier to scan; the derived
 * Simple HTML is left lowercase, which is how we emit it.
 */
function prettyPrintHtml(html, { uppercaseTags = false } = {}) {
    if (typeof html_beautify === 'function') {
        html = html_beautify(html, {
            indent_size: 2,
            wrap_line_length: 0,
            preserve_newlines: false,
            indent_inner_html: true
        });
    }
    if (uppercaseTags) {
        // Tag names only, never attributes.
        html = html.replace(/<(\/?)([a-z][a-z0-9]*)/gi, (m, slash, tag) => '<' + slash + tag.toUpperCase());
    }
    return html;
}

/* ----------------------------------------------------------------- state */

const state = {
    view: 'rendered',            // 'rendered' | 'source'
    // How big the preview panes draw the payload: 'fit', or a scale like 1.25.
    // Every inspect starts at Fit — a copy is worth seeing whole before it is
    // worth reading, and the size that takes is a property of the copy, not
    // something the user should have to ask for each time.
    zoom: 'fit',
    // Per-pane line wrapping in the source view. Off by default: long lines run
    // off the edge and the pane scrolls, keeping the payload's real line
    // structure readable.
    wrap: { plain: false, html: false, markdown: false, simpleHtml: false, aria: false },
    mdDone: false,               // text/plain has been replaced
    htmlDone: false,             // text/html has been replaced
    original: { plain: '', html: '' },   // as first read — for Undo
    current: { plain: '', html: '' },    // what is on the clipboard now
    plainPresent: false,         // did the clipboard carry a text/plain entry?
    htmlPresent: false,
    equivalents: { markdown: '', simpleHtml: '' },
    derivedFrom: null,           // 'text/html' | 'text/plain' | null
    extras: [],                  // clipboard entries that are neither text type
    ariaPreview: null            // DOM-bypass snapshot from the background worker
};

const anyReplaced = () => state.mdDone || state.htmlDone;
const bothReplaced = () => state.mdDone && state.htmlDone;
const hasMarkdown = () => !!state.equivalents.markdown;
const hasSimpleHtml = () => !!state.equivalents.simpleHtml;

/** Line endings and a trailing newline survive the clipboard unpredictably. */
const normalizeText = (text) => (text || '').replace(/\r\n/g, '\n').replace(/\s+$/, '');

/**
 * The clipboard already holds this equivalent, so moving it across would hand
 * back the same clipboard. True after a replace here, and true from the outset
 * for anything copied with cmd+shift+U, which writes these entries itself.
 *
 * Neither side is compared as a string: what comes off the clipboard has been
 * through the browser's sanitiser and is not byte-for-byte what was written.
 * Equivalents.isSameHtmlEntry carries the rule for the markup.
 */
const mdOnClipboard = () =>
    hasMarkdown() && normalizeText(state.equivalents.markdown) === normalizeText(state.current.plain);
const simpleHtmlOnClipboard = () =>
    hasSimpleHtml() && Equivalents.isSameHtmlEntry(state.equivalents.simpleHtml, state.current.html);

/* ------------------------------------------------------------- derivation */

/**
 * Run the copy-minimal-md conversion over the clipboard payload.
 *
 * With a text/html entry this is the normal path, handed to Equivalents. Without
 * one we fall back to TSV detection over the plain text, which yields both a
 * Markdown table and a simple HTML table.
 *
 * Returns null when the copy has no structure worth deriving.
 */
function deriveEquivalents({ html, plain, hasHtml }) {
    if (hasHtml && html) {
        return Equivalents.fromHtml(html);
    }

    if (plain) {
        const detection = TsvDetector.detect({ hasHtml: false, plainText: plain });
        if (!detection) return null;
        return {
            markdown: detection.markdown,
            simpleHtml: detection.simpleHtml,
            derivedFrom: 'text/plain',
            sourceType: detection.sourceType
        };
    }

    return null;
}

/* -------------------------------------------------------------- clipboard */

/**
 * Write both entries in a single ClipboardItem — the only reliable way to set
 * text/plain and text/html together. The unchanged entry is carried through so
 * it survives the write.
 */
async function writeClipboard({ plain, html, includePlain, includeHtml }) {
    const payload = {};
    if (includePlain) payload['text/plain'] = new Blob([plain || ''], { type: 'text/plain' });
    if (includeHtml) payload['text/html'] = new Blob([html || ''], { type: 'text/html' });
    if (Object.keys(payload).length === 0) return;
    await navigator.clipboard.write([new ClipboardItem(payload)]);
}

async function applyReplace({ md, html: replaceHtml }) {
    const nextPlain = md ? state.equivalents.markdown : state.current.plain;
    const nextHtml = replaceHtml ? state.equivalents.simpleHtml : state.current.html;
    // Replacing an entry creates it even if the copy had none; an entry the copy
    // never carried is not conjured out of nothing.
    const includePlain = md || state.plainPresent || state.mdDone;
    const includeHtml = replaceHtml || state.htmlPresent || state.htmlDone;

    try {
        await writeClipboard({ plain: nextPlain, html: nextHtml, includePlain, includeHtml });
    } catch (err) {
        console.error('Inspector: clipboard write failed:', err);
        showError(`Could not write to the clipboard: ${err.message}\nMake sure this window is focused.`);
        return;
    }

    state.current = { plain: nextPlain, html: nextHtml };
    if (md) state.mdDone = true;
    if (replaceHtml) state.htmlDone = true;
    clearError();
    render();
}

async function undoReplace() {
    try {
        await writeClipboard({
            plain: state.original.plain,
            html: state.original.html,
            includePlain: state.plainPresent,
            includeHtml: state.htmlPresent
        });
    } catch (err) {
        console.error('Inspector: clipboard undo failed:', err);
        showError(`Could not restore the clipboard: ${err.message}\nMake sure this window is focused.`);
        return;
    }

    state.current = { plain: state.original.plain, html: state.original.html };
    state.mdDone = false;
    state.htmlDone = false;
    clearError();
    render();
}

/**
 * Read both clipboard entries, derive the equivalents, and reset replaced state.
 * The DOM-bypass snapshot is fetched once and cached — the background worker
 * clears it on read, so a re-read must not go looking for it again.
 */
async function readClipboard() {
    const loadingEl = document.getElementById('loading');

    try {
        const clipboardItems = await navigator.clipboard.read();
        if (clipboardItems.length === 0) throw new Error('Clipboard is empty.');

        let plain = '';
        let html = '';
        let plainPresent = false;
        let htmlPresent = false;
        const extras = [];

        for (const item of clipboardItems) {
            for (const type of item.types) {
                try {
                    const blob = await item.getType(type);
                    if (type === 'text/plain') {
                        plain = await blob.text();
                        plainPresent = true;
                    } else if (type === 'text/html') {
                        html = await blob.text();
                        htmlPresent = true;
                    } else {
                        extras.push({ type, blob });
                    }
                } catch (e) {
                    console.warn(`Inspector: could not read ${type}:`, e.message);
                }
            }
        }

        state.original = { plain, html };
        state.current = { plain, html };
        state.plainPresent = plainPresent;
        state.htmlPresent = htmlPresent;
        state.mdDone = false;
        state.htmlDone = false;
        state.extras = extras;
        // A different copy is a different inspect, and every inspect opens on
        // the whole of what was copied. A level chosen for the payload that
        // just left is not a level chosen for this one.
        state.zoom = 'fit';

        let derived = null;
        try {
            derived = deriveEquivalents({ html, plain, hasHtml: htmlPresent });
        } catch (e) {
            console.error('Inspector: derivation failed:', e);
        }
        state.equivalents = derived
            ? { markdown: derived.markdown, simpleHtml: derived.simpleHtml }
            : { markdown: '', simpleHtml: '' };
        state.derivedFrom = derived ? derived.derivedFrom : null;

        if (state.ariaPreview === null) {
            state.ariaPreview = await fetchAriaPreview();
        }

        loadingEl.style.display = 'none';
        clearError();
        render();
    } catch (err) {
        loadingEl.style.display = 'none';
        showError(`Error reading clipboard: ${err.message}\nMake sure the window is focused and the extension has clipboardRead permissions.`);
        console.error(err);
    }
}

async function fetchAriaPreview() {
    try {
        console.log('Inspector: Requesting aria-preview data from background...');
        const preview = await chrome.runtime.sendMessage({ type: 'get-aria-preview' });
        if (preview) {
            console.log(`Inspector: Received aria-preview — ${preview.cellCount} cells across ${preview.rowCount} rows.`);
        } else {
            console.log('Inspector: No aria-selected data from background (no cells selected, or page not injectable).');
        }
        return preview || false;
    } catch (e) {
        console.warn('Inspector: Could not retrieve aria-preview from background:', e.message);
        return false;
    }
}

function showError(message) {
    const errorEl = document.getElementById('error');
    errorEl.style.display = 'block';
    errorEl.textContent = message;
}

function clearError() {
    const errorEl = document.getElementById('error');
    errorEl.style.display = 'none';
    errorEl.textContent = '';
}

/* ------------------------------------------------------------ dom helpers */

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

/* Two uprights flanking a return arrow — the conventional line-wrap glyph.
   A module constant, never built from clipboard data. */
const WRAP_ICON =
    '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor"' +
    ' stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M2.6 2.8v10.4M13.4 2.8v10.4"/>' +
    '<path d="M5.6 6h4.1a2.1 2.1 0 0 1 0 4.2H7.1"/>' +
    '<path d="M8.6 8.6 7 10.2l1.6 1.6"/>' +
    '</svg>';

/**
 * Toggles wrapping for one source pane. Lives at the top-right of the card
 * header, directly above the pane it controls.
 */
function buildWrapToggle(key) {
    const on = state.wrap[key];
    const button = el('button', on ? 'wrap-btn is-on' : 'wrap-btn');
    button.type = 'button';
    button.innerHTML = WRAP_ICON;

    const label = on ? 'Stop wrapping lines' : 'Wrap lines';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', String(on));

    button.addEventListener('click', () => {
        state.wrap[key] = !state.wrap[key];
        render();
    });
    return button;
}

/**
 * Every pane hangs its payload off one of these, and the preview zoom scales
 * the layer rather than the pane — see the note on .zoom-layer in the
 * stylesheet for why the pane itself must not carry it.
 *
 * A <pre> may only contain phrasing content, so its layer is a <span> that the
 * stylesheet makes a block.
 */
function buildZoomLayer(tag = 'div') {
    return el(tag, 'zoom-layer');
}

/** A source <pre> that honours the pane's own wrap setting. */
function buildSourcePre(key, text) {
    const pre = el('pre', state.wrap[key] ? 'card-source is-wrapped' : 'card-source');
    const layer = buildZoomLayer('span');
    layer.textContent = text;
    pre.appendChild(layer);
    return pre;
}

/** A rendered pane, with its layer already in place. Returns both. */
function buildRenderPane() {
    const pane = el('div', 'card-render');
    const layer = buildZoomLayer();
    pane.appendChild(layer);
    return { pane, layer };
}

/**
 * Run an untrusted style attribute past the inline-style policy, and drop the
 * attribute outright if nothing survives.
 */
function filterStyleAttribute(node, data) {
    if (data.attrName !== 'style') return;
    data.attrValue = InlineStyle.filter(data.attrValue);
    if (!data.attrValue) data.keepAttr = false;
}

/**
 * Insert untrusted HTML as a rendered preview.
 *
 * `keepStyles` is for the clipboard's own text/html: that card is there to show
 * what is really on the clipboard, and for a copy out of Sheets or Word the
 * formatting is carried entirely by inline styles. Strip those and the card
 * renders the same bare table as the Simple HTML beside it, which reads as "you
 * lose nothing" next to a header saying the payload is 44× the text it carries.
 * InlineStyle.filter says what a declaration is allowed to do.
 *
 * The derived cards render without it. Nothing they show came off the clipboard
 * — it is this tool's own output, and it is set in this tool's typography.
 *
 * Dropped either way: <style> elements, which have no scope and would restyle
 * the inspector around the card, and class/id, which let a payload reach the
 * inspector's own rules by name.
 */
function renderHtmlInto(node, html, { keepStyles = false } = {}) {
    if (typeof DOMPurify === 'undefined') {
        node.textContent = html || '';
        return;
    }

    const styleable = keepStyles && typeof InlineStyle !== 'undefined';
    if (styleable) DOMPurify.addHook('uponSanitizeAttribute', filterStyleAttribute);
    try {
        node.innerHTML = DOMPurify.sanitize(html || '', {
            FORBID_TAGS: ['style'],
            FORBID_ATTR: styleable ? ['class', 'id'] : ['style', 'class', 'id'],
            ALLOW_DATA_ATTR: false
        });
    } finally {
        if (styleable) DOMPurify.removeHook('uponSanitizeAttribute');
    }
}

/* --------------------------------------------------------------- rendering */

function render() {
    const container = document.getElementById('output-container');
    container.innerHTML = '';

    const grid = el('div', 'inspector-grid');

    if (anyReplaced()) grid.appendChild(buildBanner());

    grid.appendChild(buildLeftHeading());
    grid.appendChild(el('div', 'grid-spacer'));
    grid.appendChild(buildRightHeading());

    grid.appendChild(buildPlainCard());
    grid.appendChild(buildGutter('md'));
    grid.appendChild(buildMarkdownCard());

    grid.appendChild(buildHtmlCard());
    grid.appendChild(buildGutter('html'));
    grid.appendChild(buildSimpleHtmlCard());

    container.appendChild(grid);

    const extras = buildExtras();
    if (extras) container.appendChild(extras);

    // Last, and after the panes are in the document: Fit has to measure them.
    applyZoom();
}

function buildBanner() {
    const banner = el('div', 'banner');

    const message = bothReplaced()
        ? '✓ Both clipboard entries replaced with their equivalents.'
        : state.mdDone
            ? '✓ text/plain now holds the Markdown equivalent.'
            : '✓ text/html now holds the Simple HTML equivalent.';

    banner.appendChild(el('div', 'banner-msg', message));

    const undo = el('button', 'banner-undo', 'Undo');
    undo.type = 'button';
    undo.addEventListener('click', undoReplace);
    banner.appendChild(undo);

    return banner;
}

function buildLeftHeading() {
    const heading = el('div', 'col-heading');
    heading.appendChild(el('div', 'col-heading-title', 'In your clipboard'));

    const sub = el('div', 'col-heading-sub');
    if (state.plainPresent && state.htmlPresent) {
        sub.textContent = 'The clipboard usually contains 2 versions of what you copy.';
    } else if (state.plainPresent) {
        sub.appendChild(document.createTextNode('When you pressed “copy”, the application only populated '));
        sub.appendChild(el('span', 'mime', 'text/plain'));
    } else if (state.htmlPresent) {
        sub.textContent = 'One entry — this copy carried HTML only.';
    } else {
        sub.textContent = 'No text entries on the clipboard.';
    }
    heading.appendChild(sub);

    return heading;
}

function buildRightHeading() {
    const heading = el('div', 'col-heading');
    heading.appendChild(el('div', 'col-heading-title', 'Equivalent'));

    const sub = el('div', 'col-heading-sub');
    if (state.derivedFrom) {
        sub.appendChild(document.createTextNode('Derived from '));
        sub.appendChild(el('span', 'mime', state.derivedFrom));
    } else if (state.plainPresent) {
        sub.textContent = 'Conversion would produce original text.';
    } else {
        sub.textContent = 'Nothing structural to derive from this copy.';
    }
    heading.appendChild(sub);

    return heading;
}

/* --- clipboard cards (column 1) --- */

function buildPlainCard() {
    const card = el('div', 'card card--clipboard card--plain');

    const head = el('div', 'card-head');
    head.appendChild(el('span', 'card-name-mime', 'text/plain'));

    // No "not present" marker: the column heading above has already said which
    // entries this copy carried, and saying it twice is not saying it better.
    if (state.plainPresent || state.mdDone) {
        head.appendChild(el('span', 'card-meta', formatBytes(byteLength(state.current.plain))));
    }
    if (state.mdDone) head.appendChild(el('span', 'card-flag', '· updated'));

    if (!state.plainPresent && !state.mdDone) {
        card.appendChild(head);
        // Name the missing entry only while something is waiting to fill it —
        // the gutter is offering to add the Markdown. With nothing to add, the
        // card is inert, same as its text/html neighbour.
        if (hasMarkdown()) {
            card.appendChild(el('div', 'card-empty', 'This copy did not include a text/plain entry.'));
        } else {
            markInert(card);
        }
        return card;
    }

    // Plain text has no rendered form — this card is always a <pre>, so its
    // wrap toggle shows in both views.
    head.appendChild(buildWrapToggle('plain'));
    card.appendChild(head);
    card.appendChild(buildSourcePre('plain', redactBase64(state.current.plain) || '[Empty String]'));
    return card;
}

function buildHtmlCard() {
    const card = el('div', 'card card--clipboard card--html');

    const head = el('div', 'card-head');
    const name = el('span', 'card-name-mime is-html', 'text/html');
    head.appendChild(name);

    if (state.htmlPresent || state.htmlDone) {
        const htmlBytes = byteLength(state.current.html);
        head.appendChild(el('span', 'card-meta', formatBytes(htmlBytes)));

        // How much of the payload is markup rather than the text it carries.
        const plainBytes = byteLength(state.original.plain);
        if (!state.htmlDone && plainBytes > 0) {
            const ratio = Math.round(htmlBytes / plainBytes);
            if (ratio >= 10) {
                head.appendChild(el('span', 'card-note', `· ${ratio}× the text it carries`));
            }
        }
    }
    if (state.htmlDone) head.appendChild(el('span', 'card-flag', '· updated'));

    if (!state.htmlPresent && !state.htmlDone) {
        card.appendChild(head);
        // A missing entry is worth naming only while something is waiting to fill
        // it — the gutter offers to add the Simple HTML. With no equivalent
        // derived there is no such offer, and the card is inert.
        if (hasSimpleHtml()) {
            card.appendChild(el('div', 'card-empty', 'This copy did not include a text/html entry.'));
        } else {
            markInert(card);
        }
        return card;
    }

    if (state.view === 'source') head.appendChild(buildWrapToggle('html'));
    card.appendChild(head);

    if (state.view === 'source') {
        // Show the clipboard payload as it really is, tags uppercased to scan.
        const source = prettyPrintHtml(redactBase64(state.current.html), { uppercaseTags: true });
        card.appendChild(buildSourcePre('html', source || '[Empty String]'));
    } else {
        const { pane, layer } = buildRenderPane();
        renderHtmlInto(layer, state.current.html, { keepStyles: true });
        card.appendChild(pane);
    }

    return card;
}

/* --- equivalent cards (column 3) --- */

/**
 * Nothing on offer here, for either of the two reasons a card can have nothing
 * to say: there was nothing to derive, or what was derived is already sitting in
 * the card to the left. Both leave an empty frame. It keeps its place — the two
 * columns stay aligned row for row — and reads as switched off, with the head
 * saying which of the two it is.
 */
function markInert(card) {
    card.classList.add('is-inert');
    card.setAttribute('aria-disabled', 'true');
}

/**
 * The savings figure compares the equivalent against the payload it was
 * derived from. Suppressed when the equivalent isn't actually smaller, and
 * once it has been moved into the clipboard — there is nothing left to
 * compare it against at that point.
 */
function appendDerivedMeta(head, equivalentText, showSavings) {
    const bytes = byteLength(equivalentText);
    const sourceBytes = byteLength(state.original.html) || byteLength(state.original.plain);

    const meta = el('span', 'card-meta');
    meta.appendChild(document.createTextNode(formatBytes(bytes)));

    if (showSavings && sourceBytes > 0) {
        const percent = Math.round((1 - bytes / sourceBytes) * 100);
        if (percent >= 1) {
            meta.appendChild(document.createTextNode(' · '));
            meta.appendChild(el('span', 'card-savings', `${percent}% smaller`));
        }
    }
    head.appendChild(meta);
}

function buildMarkdownCard() {
    const card = el('div', 'card card--derived card--markdown');
    const onClipboard = mdOnClipboard();

    const head = el('div', 'card-head');
    head.appendChild(el('span', 'card-name-derived', 'Markdown'));
    if (hasMarkdown()) appendDerivedMeta(head, state.equivalents.markdown, !onClipboard);
    // Say why the card is empty. After a replace the banner and the left card's
    // "· updated" already account for it.
    if (onClipboard && !state.mdDone) head.appendChild(el('span', 'card-flag', '· already in text/plain'));

    // Empty frame either way: nothing was derived, or the card to the left is
    // already showing this. Printing it again inside a switched-off pane adds
    // nothing the head does not already say.
    if (!hasMarkdown() || onClipboard) {
        markInert(card);
        card.appendChild(head);
        return card;
    }

    if (state.view === 'source') head.appendChild(buildWrapToggle('markdown'));
    card.appendChild(head);

    if (state.view === 'source') {
        card.appendChild(buildSourcePre('markdown', state.equivalents.markdown));
    } else {
        const { pane, layer } = buildRenderPane();
        if (typeof marked !== 'undefined') {
            renderHtmlInto(layer, marked.parse(state.equivalents.markdown, { breaks: true }));
        } else {
            layer.textContent = state.equivalents.markdown;
        }
        card.appendChild(pane);
    }

    return card;
}

function buildSimpleHtmlCard() {
    const card = el('div', 'card card--derived card--simple-html');
    const onClipboard = simpleHtmlOnClipboard();

    const head = el('div', 'card-head');
    head.appendChild(el('span', 'card-name-derived', 'Simple HTML'));
    if (hasSimpleHtml()) appendDerivedMeta(head, state.equivalents.simpleHtml, !onClipboard);
    if (onClipboard && !state.htmlDone) head.appendChild(el('span', 'card-flag', '· already in text/html'));

    if (!hasSimpleHtml() || onClipboard) {
        markInert(card);
        card.appendChild(head);
        return card;
    }

    if (state.view === 'source') head.appendChild(buildWrapToggle('simpleHtml'));
    card.appendChild(head);

    if (state.view === 'source') {
        card.appendChild(buildSourcePre('simpleHtml', prettyPrintHtml(state.equivalents.simpleHtml)));
    } else {
        const { pane, layer } = buildRenderPane();
        renderHtmlInto(layer, state.equivalents.simpleHtml);
        card.appendChild(pane);
    }

    return card;
}

/* --- gutter actions (column 2) --- */

/**
 * The leftward arrow is the point: the equivalents are on the right, the
 * clipboard is on the left, and clicking moves right → left.
 */
function buildGutter(row) {
    const isMd = row === 'md';
    const gutter = el('div', isMd ? 'gutter gutter--first' : 'gutter');

    const done = isMd ? state.mdDone : state.htmlDone;
    const available = isMd ? hasMarkdown() : hasSimpleHtml();
    const onClipboard = isMd ? mdOnClipboard() : simpleHtmlOnClipboard();
    const targetPresent = isMd ? state.plainPresent : state.htmlPresent;
    const target = isMd ? 'text/plain' : 'text/html';
    const sourceName = isMd ? 'Markdown' : 'Simple HTML';

    const button = el('button', 'replace-btn');
    button.type = 'button';

    if (done) {
        button.classList.add('is-done');
        button.textContent = targetPresent ? '✓ Replaced' : '✓ Added';
        button.disabled = true;
    } else {
        // A write that would change nothing stays on the page, switched off with
        // its reason underneath. Dropping the button instead would leave the row
        // looking broken, and hide that the copy is already what it should be.
        button.textContent = targetPresent ? '← Replace' : '← Add';
        button.disabled = !available || onClipboard;
        if (!button.disabled) {
            button.addEventListener('click', () => applyReplace({ md: isMd, html: !isMd }));
        }
    }
    gutter.appendChild(button);

    const hint = done ? target
        : onClipboard ? `${target} already matches`
            : available ? `${sourceName} into ${target}`
                : 'Nothing to move';
    gutter.appendChild(el('div', 'replace-hint', hint));

    // "Replace both" straddles the seam between the two clipboard cards.
    if (isMd && hasMarkdown() && hasSimpleHtml()) {
        const wrap = el('div', 'replace-both-wrap');
        const both = el('button', 'replace-both-btn');
        both.type = 'button';

        if (bothReplaced()) {
            both.classList.add('is-done');
            both.textContent = '✓ Both replaced';
            both.disabled = true;
        } else if (mdOnClipboard() && simpleHtmlOnClipboard()) {
            // Both rows are already a no-op; so is doing them together.
            both.textContent = '⇐ Replace both';
            both.disabled = true;
        } else {
            // The double arrow signals two entries moving at once.
            both.textContent = '⇐ Replace both';
            both.addEventListener('click', () => applyReplace({ md: true, html: true }));
        }
        wrap.appendChild(both);
        gutter.appendChild(wrap);
    }

    return gutter;
}

/* --- extras: non-text clipboard entries and the DOM-bypass diagnostic --- */

function buildExtras() {
    const hasOther = state.extras.length > 0;
    const hasAria = !!state.ariaPreview;
    if (!hasOther && !hasAria) return null;

    const section = el('section', 'extras');

    if (hasOther) {
        section.appendChild(el('h2', 'extras-title', 'Also on the clipboard'));
        state.extras.forEach(entry => section.appendChild(buildExtraCard(entry)));
    }

    if (hasAria) {
        const ariaCard = buildAriaBypassCard(state.ariaPreview);
        if (ariaCard) section.appendChild(ariaCard);
    }

    return section;
}

function buildExtraCard({ type, blob }) {
    const card = el('div', 'card card--clipboard');

    const head = el('div', 'card-head');
    head.appendChild(el('span', 'card-name-mime', type));
    head.appendChild(el('span', 'card-meta', formatBytes(blob.size)));
    card.appendChild(head);

    if (type.startsWith('image/')) {
        const { pane, layer } = buildRenderPane();
        const img = document.createElement('img');
        img.src = URL.createObjectURL(blob);
        img.alt = `Clipboard image (${type})`;
        layer.appendChild(img);
        card.appendChild(pane);
    } else {
        card.appendChild(el('div', 'card-empty', 'No preview available for this type.'));
    }

    return card;
}

/**
 * Experimental: the table reconstructed straight from the page DOM via
 * aria-selected cells, bypassing the clipboard entirely. Kept as a diagnostic
 * for the grid-selection work.
 */
function buildAriaBypassCard(ariaPreview) {
    if (typeof TurndownService === 'undefined') {
        console.warn('Inspector (DOM Bypass): TurndownService not available.');
        return null;
    }

    const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
    if (typeof turndownPluginGfm !== 'undefined') td.use(turndownPluginGfm.gfm);
    const markdown = td.turndown(ariaPreview.html);

    const card = el('div', 'card card--experimental');

    const head = el('div', 'card-head');
    head.appendChild(el('span', 'card-name-derived', 'Experimental: DOM Bypass'));
    head.appendChild(el('span', 'card-meta',
        `${ariaPreview.cellCount} cells, ${ariaPreview.rowCount} rows · ${ariaPreview.strategy ?? 'aria-selected'}`));
    if (state.view === 'source') head.appendChild(buildWrapToggle('aria'));
    card.appendChild(head);

    if (state.view === 'source') {
        card.appendChild(buildSourcePre('aria', markdown || '[Empty]'));
    } else {
        const { pane, layer } = buildRenderPane();
        if (typeof marked !== 'undefined') {
            renderHtmlInto(layer, marked.parse(markdown, { breaks: true }));
        } else {
            layer.textContent = markdown;
        }
        card.appendChild(pane);
    }

    const foot = el('div', 'card-foot');
    const copyBtn = el('button', 'ghost-btn', 'Copy Markdown to clipboard');
    copyBtn.type = 'button';
    copyBtn.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(markdown);
            copyBtn.textContent = 'Copied — re-reading...';
            // The clipboard changed underneath us; re-read so the grid stays honest.
            setTimeout(readClipboard, 500);
        } catch (err) {
            console.error('Inspector (DOM Bypass): copy failed:', err);
            copyBtn.textContent = 'Copy failed';
            setTimeout(() => { copyBtn.textContent = 'Copy Markdown to clipboard'; }, 2000);
        }
    });
    foot.appendChild(copyBtn);
    card.appendChild(foot);

    return card;
}

/* ----------------------------------------------------------- preview zoom */

/** The ladder the menu offers, and what the keyboard shortcuts step through. */
const ZOOM_STEPS = [0.5, 0.75, 0.9, 1, 1.25, 1.5, 2];

/**
 * Fit stops here. Below it the payload is no longer readable, and a pane that
 * cannot fit even at 50% goes back to doing what it always did — showing what
 * it can and scrolling for the rest.
 */
const ZOOM_FIT_FLOOR = 0.5;

const zoomEls = {};   // filled in at DOMContentLoaded

function setPreviewZoom(scale) {
    document.documentElement.style.setProperty('--preview-zoom', String(scale));
}

/** True when no pane is still holding content past its cap. */
function everyPaneClears() {
    for (const layer of document.querySelectorAll('.zoom-layer')) {
        const pane = layer.parentElement;
        if (pane.scrollHeight - pane.clientHeight > 1) return false;
    }
    return true;
}

/**
 * Fit: the largest scale at which every pane's content clears its own cap.
 *
 * One scale for the whole page, not one per pane. Packing each pane
 * separately would fit more in, but a row of this grid exists to be compared
 * against itself, and two panes drawn at different scales cannot be.
 *
 * Measured at 1, because a pane already scaled reports scaled numbers. The
 * pane's padding does not scale with the layer inside it, so it comes off the
 * available height before the ratio is taken.
 *
 * The arithmetic gives a first guess and not the answer: a scaled table row
 * rounds up to a whole layout unit, so ten of them land a few pixels past
 * where the ratio said they would and the pane scrolls after all. From the
 * guess it walks down a percent at a time until every pane clears.
 *
 * Width is left alone. Long lines are the line-wrap toggle's job, one pane at
 * a time, and Fit does not touch it.
 */
function computeFit() {
    setPreviewZoom(1);

    let ratio = 1;
    for (const layer of document.querySelectorAll('.zoom-layer')) {
        const pane = layer.parentElement;
        const box = getComputedStyle(pane);
        const available = pane.clientHeight
            - parseFloat(box.paddingTop) - parseFloat(box.paddingBottom);
        const needed = layer.scrollHeight;
        if (needed > available && available > 0) ratio = Math.min(ratio, available / needed);
    }

    // Never larger than life: Fit shows the whole payload, it does not enlarge
    // one that already fits.
    let scale = Math.max(ZOOM_FIT_FLOOR, Math.floor(Math.min(ratio, 1) * 100) / 100);
    setPreviewZoom(scale);

    for (let step = 0; step < 12 && scale > ZOOM_FIT_FLOOR && !everyPaneClears(); step++) {
        scale = Math.max(ZOOM_FIT_FLOOR, Math.round(scale * 100 - 1) / 100);
        setPreviewZoom(scale);
    }

    return scale;
}

/**
 * Put the current choice on the page. Fit is recomputed here rather than
 * remembered: render() has just rebuilt the panes it was measured against, and
 * a wrap toggle or a view switch changes how tall the same payload stands.
 */
function applyZoom() {
    const isFit = state.zoom === 'fit';
    setPreviewZoom(isFit ? computeFit() : state.zoom);

    if (!zoomEls.trigger) return;
    zoomEls.value.textContent = isFit ? 'Fit' : `${Math.round(state.zoom * 100)}%`;
    zoomEls.trigger.classList.toggle('is-fit', isFit);

    const selected = isFit ? 'fit' : String(state.zoom);
    zoomEls.options.forEach(option => {
        option.setAttribute('aria-selected', String(option.dataset.zoom === selected));
    });
}

function setZoom(choice) {
    state.zoom = choice === 'fit' ? 'fit' : parseFloat(choice);
    applyZoom();
}

/** Step to the next rung of the ladder from wherever the panes are drawn now. */
function stepZoom(direction) {
    const current = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--preview-zoom')
    ) || 1;
    const next = direction > 0
        ? ZOOM_STEPS.find(step => step > current + 0.001)
        : [...ZOOM_STEPS].reverse().find(step => step < current - 0.001);
    if (next !== undefined) setZoom(String(next));
}

function openZoomMenu() {
    zoomEls.menu.hidden = false;
    zoomEls.trigger.setAttribute('aria-expanded', 'true');
    zoomEls.cursor = Math.max(0, zoomEls.options.findIndex(o => o.getAttribute('aria-selected') === 'true'));
    markZoomCursor();
}

function closeZoomMenu() {
    zoomEls.menu.hidden = true;
    zoomEls.trigger.setAttribute('aria-expanded', 'false');
    zoomEls.trigger.removeAttribute('aria-activedescendant');
    zoomEls.options.forEach(option => option.classList.remove('is-cursor'));
}

/** The keyboard's own place in the menu, which is not the selected option. */
function markZoomCursor() {
    zoomEls.options.forEach((option, i) => option.classList.toggle('is-cursor', i === zoomEls.cursor));
    const option = zoomEls.options[zoomEls.cursor];
    zoomEls.trigger.setAttribute('aria-activedescendant', option.id);
    option.scrollIntoView({ block: 'nearest' });
}

function moveZoomCursor(delta) {
    zoomEls.cursor = (zoomEls.cursor + delta + zoomEls.options.length) % zoomEls.options.length;
    markZoomCursor();
}

function wireZoomControl() {
    zoomEls.trigger = document.getElementById('zoom-trigger');
    zoomEls.value = document.getElementById('zoom-value');
    zoomEls.menu = document.getElementById('zoom-menu');
    zoomEls.options = [...zoomEls.menu.querySelectorAll('.zoom-option')];
    zoomEls.cursor = 0;

    zoomEls.trigger.addEventListener('click', () => {
        zoomEls.menu.hidden ? openZoomMenu() : closeZoomMenu();
    });

    zoomEls.menu.addEventListener('click', (event) => {
        const option = event.target.closest('.zoom-option');
        if (!option) return;
        setZoom(option.dataset.zoom);
        closeZoomMenu();
        zoomEls.trigger.focus();
    });

    document.addEventListener('click', (event) => {
        if (!zoomEls.menu.hidden && !event.target.closest('#zoom')) closeZoomMenu();
    });

    document.addEventListener('keydown', (event) => {
        if (!zoomEls.menu.hidden) {
            if (event.key === 'Escape') { closeZoomMenu(); zoomEls.trigger.focus(); return; }
            if (event.key === 'ArrowDown') { event.preventDefault(); moveZoomCursor(1); return; }
            if (event.key === 'ArrowUp') { event.preventDefault(); moveZoomCursor(-1); return; }
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setZoom(zoomEls.options[zoomEls.cursor].dataset.zoom);
                closeZoomMenu();
                zoomEls.trigger.focus();
                return;
            }
        }

        // The editor shortcuts. This page has one thing worth resizing, so they
        // are taken from the browser and pointed at the panes.
        if (!(event.ctrlKey || event.metaKey)) return;
        if (event.key === '=' || event.key === '+') {
            event.preventDefault();
            stepZoom(1);
        } else if (event.key === '-') {
            event.preventDefault();
            stepZoom(-1);
        } else if (event.key === '0') {
            event.preventDefault();
            setZoom('fit');
        }
    });

    // A narrower window re-wraps the payload, which changes how tall it stands,
    // which changes what Fit is.
    let pending = null;
    window.addEventListener('resize', () => {
        if (state.zoom !== 'fit' || pending) return;
        pending = requestAnimationFrame(() => { pending = null; applyZoom(); });
    });
}

/* ----------------------------------------------------------------- wiring */

function setView(view) {
    if (state.view === view) return;
    state.view = view;
    document.querySelectorAll('#view-toggle .segment').forEach(btn => {
        btn.classList.toggle('is-selected', btn.dataset.view === view);
    });
    render();
}

// The Async Clipboard API requires document focus. Fire immediately if we
// already have it, otherwise wait for the first focus event.
document.addEventListener('DOMContentLoaded', () => {
    const manifest = chrome.runtime.getManifest();
    const versionLabel = document.getElementById('version-label');
    if (versionLabel) {
        versionLabel.textContent = `v${manifest.version}`;
    }

    document.querySelectorAll('#view-toggle .segment').forEach(btn => {
        btn.addEventListener('click', () => setView(btn.dataset.view));
    });

    wireZoomControl();

    if (document.hasFocus()) {
        readClipboard();
    } else {
        window.addEventListener('focus', readClipboard, { once: true });
    }
});

// Close the tab when the user leaves it
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        window.close();
    }
});
