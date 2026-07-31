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

/** A source <pre> that honours the pane's own wrap setting. */
function buildSourcePre(key, text) {
    return el('pre', state.wrap[key] ? 'card-source is-wrapped' : 'card-source', text);
}

/**
 * Insert untrusted HTML as a rendered preview. Styles and classes are dropped
 * so the card's own typography governs — the Source view is where the payload
 * is shown verbatim.
 */
function renderHtmlInto(node, html) {
    if (typeof DOMPurify === 'undefined') {
        node.textContent = html || '';
        return;
    }
    node.innerHTML = DOMPurify.sanitize(html || '', {
        FORBID_TAGS: ['style'],
        FORBID_ATTR: ['style', 'class', 'id'],
        ALLOW_DATA_ATTR: false
    });
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

    if (state.plainPresent || state.mdDone) {
        head.appendChild(el('span', 'card-meta', formatBytes(byteLength(state.current.plain))));
    } else {
        head.appendChild(el('span', 'card-meta', 'not present'));
    }
    if (state.mdDone) head.appendChild(el('span', 'card-flag', '· updated'));

    if (!state.plainPresent && !state.mdDone) {
        card.appendChild(head);
        card.appendChild(el('div', 'card-empty', 'This copy did not include a text/plain entry.'));
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
    } else {
        head.appendChild(el('span', 'card-meta', 'not present'));
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
        const body = el('div', 'card-render');
        renderHtmlInto(body, state.current.html);
        card.appendChild(body);
    }

    return card;
}

/* --- equivalent cards (column 3) --- */

/**
 * Once an equivalent has been moved into the clipboard it is spent: the left
 * card now holds it, so it is no longer something to act on. It stays readable
 * and scrollable, but reads as disabled.
 */
function markSpent(card) {
    card.classList.add('is-spent');
    card.setAttribute('aria-disabled', 'true');
}

/**
 * Nothing on offer here. A copy of unstructured plain text has no equivalents to
 * derive and no text/html to convert, so those three cards hold nothing and can
 * do nothing. The card keeps its place — the two columns stay aligned row for
 * row — but reads as switched off rather than explaining its own emptiness.
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
    if (state.mdDone) markSpent(card);

    const head = el('div', 'card-head');
    head.appendChild(el('span', 'card-name-derived', 'Markdown'));
    if (hasMarkdown()) appendDerivedMeta(head, state.equivalents.markdown, !state.mdDone);

    if (!hasMarkdown()) {
        markInert(card);
        card.appendChild(head);
        return card;
    }

    if (state.view === 'source') head.appendChild(buildWrapToggle('markdown'));
    card.appendChild(head);

    if (state.view === 'source') {
        card.appendChild(buildSourcePre('markdown', state.equivalents.markdown));
    } else {
        const body = el('div', 'card-render');
        if (typeof marked !== 'undefined') {
            renderHtmlInto(body, marked.parse(state.equivalents.markdown, { breaks: true }));
        } else {
            body.textContent = state.equivalents.markdown;
        }
        card.appendChild(body);
    }

    return card;
}

function buildSimpleHtmlCard() {
    const card = el('div', 'card card--derived card--simple-html');
    if (state.htmlDone) markSpent(card);

    const head = el('div', 'card-head');
    head.appendChild(el('span', 'card-name-derived', 'Simple HTML'));
    if (hasSimpleHtml()) appendDerivedMeta(head, state.equivalents.simpleHtml, !state.htmlDone);

    if (!hasSimpleHtml()) {
        markInert(card);
        card.appendChild(head);
        return card;
    }

    if (state.view === 'source') head.appendChild(buildWrapToggle('simpleHtml'));
    card.appendChild(head);

    if (state.view === 'source') {
        card.appendChild(buildSourcePre('simpleHtml', prettyPrintHtml(state.equivalents.simpleHtml)));
    } else {
        const body = el('div', 'card-render');
        renderHtmlInto(body, state.equivalents.simpleHtml);
        card.appendChild(body);
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
        button.textContent = targetPresent ? '← Replace' : '← Add';
        button.disabled = !available;
        button.addEventListener('click', () => applyReplace({ md: isMd, html: !isMd }));
    }
    gutter.appendChild(button);

    const hint = done ? target : available ? `${sourceName} into ${target}` : 'Nothing to move';
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
        const body = el('div', 'card-render');
        const img = document.createElement('img');
        img.src = URL.createObjectURL(blob);
        img.alt = `Clipboard image (${type})`;
        body.appendChild(img);
        card.appendChild(body);
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
        const body = el('div', 'card-render');
        if (typeof marked !== 'undefined') {
            renderHtmlInto(body, marked.parse(markdown, { breaks: true }));
        } else {
            body.textContent = markdown;
        }
        card.appendChild(body);
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
