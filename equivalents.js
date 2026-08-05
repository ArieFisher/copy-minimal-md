/**
 * equivalents.js
 *
 * Clipboard `text/html` payload → `{ markdown, simpleHtml }`. Extracted from
 * inspector.js so the derivation can be unit tested directly, with no clipboard
 * and no chrome APIs in the way.
 *
 * Exports `window.Equivalents = { fromHtml, toSimpleHtml, isSameHtmlEntry }`.
 *
 * Expected globals at call time:
 *   - DOMPurify         (lib/purify.min.js)
 *   - TurndownService   (lib/turndown.js)
 *   - turndownPluginGfm (lib/turndown-plugin-gfm.js)
 *   - DOMParser         (browser global / jsdom)
 *
 * Both equivalents come from the same repaired document, and they diverge on
 * exactly one point: the header row. GFM has no table syntax without one, so
 * the Markdown pass promotes the first row when the copy carries no header.
 * Simple HTML is under no such constraint, so it reports the copy's structure
 * as it actually is — a selection taken from the middle of a table has no
 * header row, and inventing one there would misdescribe the copy.
 */
(function (global) {
    if (global.Equivalents) return;

    const ALLOWED_TAGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'li', 'b', 'i', 'strong', 'em', 'u', 'a', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'br', 'hr', 'blockquote', 'code', 'pre', 'div', 'section', 'article', 'figure', 'figcaption', 'header', 'footer', 'main', 'aside'];
    const ALLOWED_ATTR = ['href', 'src', 'alt', 'title'];

    /** The source repairs, applied once for whatever is derived from them. */
    function repair(htmlText) {
        const doc = new DOMParser().parseFromString(htmlText, 'text/html');
        let modified = false;
        let sourceType = 'HTML';

        if (inlineCellDivs(doc)) modified = true;
        if (unwrapGoogleDocsBold(doc)) modified = true;
        if (reconstructAriaTables(doc)) {
            modified = true;
            sourceType = 'HTML (Extracted ARIA Table)';
        }

        return { repaired: modified ? doc.body.innerHTML : htmlText, sourceType };
    }

    /**
     * The Simple HTML alone, for callers with no use for the Markdown: the
     * cmd+shift+U path writes it straight into the clipboard's text/html. Sharing
     * this with `fromHtml` is the point — what the inspector previews and what
     * the hotkey writes are then the same derivation, and cannot drift apart.
     */
    function toSimpleHtml(htmlText) {
        return simplifyTables(collapseContainers(nameEmptyLinks(sanitize(repair(htmlText).repaired))));
    }

    function fromHtml(htmlText) {
        const { repaired, sourceType } = repair(htmlText);

        const simpleHtml = simplifyTables(collapseContainers(nameEmptyLinks(sanitize(repaired))));

        // The promotion happens on a throwaway parse so it reaches the Markdown
        // and nothing else.
        const mdDoc = new DOMParser().parseFromString(repaired, 'text/html');
        const promoted = promoteImplicitHeaders(mdDoc);
        const markdown = toMarkdown(collapseContainers(nameEmptyLinks(sanitize(promoted ? mdDoc.body.innerHTML : repaired))));

        return { markdown, simpleHtml, derivedFrom: 'text/html', sourceType };
    }

    /* ------------------------------------------------------ source repairs */

    /**
     * Whether a cell div being unwrapped needs a <br> in front of it: true
     * when the nearest preceding sibling that isn't whitespace-only text is
     * an element other than <br> (an unwrapped div's span, or ordinary
     * inline content), false when there is none (the div opens the cell) or
     * the source already put a <br> right there.
     */
    function hasContentBeforeCellDiv(div) {
        let sib = div.previousSibling;
        while (sib) {
            if (sib.nodeType === 3) { // Node.TEXT_NODE
                if (sib.textContent.trim() !== '') return true;
                sib = sib.previousSibling;
                continue;
            }
            if (sib.nodeType === 1) { // Node.ELEMENT_NODE
                return sib.tagName !== 'BR';
            }
            sib = sib.previousSibling;
        }
        return false;
    }

    /**
     * div is in ALLOWED_TAGS, so block boundaries survive sanitize — which
     * means a <div> left inside a cell would survive too, and split a table
     * row across lines and break the Markdown table syntax. Inlining cell
     * divs into <span>s here, before sanitize runs, is what keeps that block
     * break out of the table — but the break itself isn't discarded, it
     * degrades to a <br>, the one line-break spelling a Markdown table cell
     * can carry (turndown-plugin-gfm passes a <br> inside a cell through
     * untouched). A <br> goes in only between two divs that each contribute
     * content — never at the start or end of a cell, and never doubled next
     * to a <br> the source already had.
     */
    function inlineCellDivs(doc) {
        const divs = Array.from(doc.querySelectorAll('td div, th div'));
        divs.forEach(div => {
            if (hasContentBeforeCellDiv(div)) {
                div.before(doc.createElement('br'));
            }
            const span = doc.createElement('span');
            span.append(...div.childNodes);
            div.replaceWith(span);
        });
        return divs.length > 0;
    }

    /** Google Docs wraps the whole copy in <b style="font-weight:normal">. */
    function unwrapGoogleDocsBold(doc) {
        const bolds = Array.from(doc.querySelectorAll('b[style*="font-weight:normal"], b[style*="font-weight: normal"]'));
        bolds.forEach(b => {
            const span = doc.createElement('span');
            span.append(...b.childNodes);
            b.replaceWith(span);
        });
        return bolds.length > 0;
    }

    /**
     * Reconstruct ARIA flex/grid tables into real tables (Databricks, Notion).
     * A <thead> is built only where the grid actually declares column headers;
     * a grid with none stays headerless, same as any other table here.
     */
    function reconstructAriaTables(doc) {
        const ariaRows = doc.querySelectorAll('[role="row"]');
        if (ariaRows.length === 0 || doc.querySelectorAll('table').length > 0) return false;

        const newTable = doc.createElement('table');
        const tbody = doc.createElement('tbody');
        let thead = null;

        ariaRows.forEach(ariaRow => {
            const tr = doc.createElement('tr');
            const ariaCells = ariaRow.querySelectorAll('[role="cell"], [role="columnheader"], [role="gridcell"]');
            let isHeaderRow = false;

            if (ariaCells.length > 0) {
                ariaCells.forEach(ariaCell => {
                    const isHeader = ariaCell.getAttribute('role') === 'columnheader';
                    if (isHeader) isHeaderRow = true;
                    const cell = doc.createElement(isHeader ? 'th' : 'td');
                    cell.innerHTML = ariaCell.innerHTML;
                    tr.appendChild(cell);
                });
            } else {
                Array.from(ariaRow.children).forEach(child => {
                    const cell = doc.createElement('td');
                    cell.innerHTML = child.innerHTML;
                    tr.appendChild(cell);
                });
            }

            if (isHeaderRow) {
                if (!thead) thead = doc.createElement('thead');
                thead.appendChild(tr);
            } else {
                tbody.appendChild(tr);
            }
        });

        if (thead) newTable.appendChild(thead);
        newTable.appendChild(tbody);

        const firstRowParent = ariaRows[0].parentElement;
        if (firstRowParent) {
            firstRowParent.insertBefore(newTable, ariaRows[0]);
        } else {
            doc.body.prepend(newTable);
        }

        ariaRows.forEach(row => row.remove());
        return true;
    }

    /* ------------------------------------------------------ header handling */

    /**
     * Does this table carry a header row of its own? The negation is exactly the
     * condition the Markdown promotion fires on, so the two passes stay in step:
     * whatever Markdown has to invent, Simple HTML flattens instead.
     */
    function hasHeaderRow(table) {
        if (table.tHead) return true;
        const firstRow = table.rows[0];
        if (!firstRow) return true;
        return Array.from(firstRow.cells).every(cell => cell.tagName === 'TH');
    }

    /** Markdown only: lift the first row into a <thead> of <th> cells. */
    function promoteImplicitHeaders(doc) {
        let modified = false;
        doc.querySelectorAll('table').forEach(table => {
            if (hasHeaderRow(table)) return;

            const firstRow = table.rows[0];
            const thead = doc.createElement('thead');
            const tr = doc.createElement('tr');
            for (let i = 0; i < firstRow.cells.length; i++) {
                const th = doc.createElement('th');
                th.textContent = firstRow.cells[i]?.textContent || '';
                tr.appendChild(th);
            }
            thead.appendChild(tr);
            table.insertBefore(thead, table.firstChild);
            firstRow.remove();
            modified = true;
        });
        return modified;
    }

    /* -------------------------------------------------- container collapsing */

    /** Containers that say nothing on their own — safe to unwrap or drop. */
    const PLAIN_CONTAINERS = new Set(['DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'MAIN', 'ASIDE']);

    /** The one whose nesting is never meaningful, so it is the one unwrapped. */
    const UNWRAPPABLE = 'DIV';

    /**
     * Take out the wrappers sanitize left behind.
     *
     * These are not in the copy. A Google News headline card nests five divs
     * around a <button> menu; sanitize drops the button, and only then is that
     * a chain of divs around nothing. So this runs on sanitized markup —
     * earlier there is nothing yet to collapse, and the same divs still look
     * occupied.
     *
     * Two rules, repeated until neither fires:
     *
     *   - a container with no text and no elements inside it goes. The test is
     *     "holds no element", not "holds no text", so a container is never
     *     removed over content that has no text of its own — <figure><img></figure>
     *     and a div holding only a <br> both stay.
     *   - a div whose only child is another container is one wrapper too many,
     *     so it is unwrapped. The child is what is kept, which is why a <figure>
     *     or a <section> inside a div survives the div going.
     *
     * Only the plain containers take part. <figure> and <figcaption> say
     * something about what they hold, so they are never unwrapped.
     */
    /**
     * Elements a renderer treats as a block. Whitespace that touches one of
     * these is eaten by the block boundary, so removing it changes nothing on
     * screen — which is what makes the whitespace sweep below safe.
     */
    const BLOCK_TAGS = new Set([
        'DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'MAIN', 'ASIDE', 'FIGURE', 'FIGCAPTION',
        'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'HR',
        'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TH', 'TD'
    ]);

    /**
     * Whitespace left where a wrapper used to be. A removed div takes its tags
     * but not the newline and indent that sat around them, and those add up in
     * a byte count this tool puts on screen.
     *
     * Only whitespace touching a block element goes: that whitespace is not
     * rendered either way. Whitespace between two inline elements is the space
     * between two words, and it stays.
     */
    function dropDeadWhitespace(doc) {
        // Removing a wrapper leaves the whitespace that was on either side of
        // it as two adjacent text nodes. Merging them first is what lets the
        // test below see a real element on each side instead of more text.
        doc.body.normalize();

        const walker = doc.createTreeWalker(doc.body, 4 /* SHOW_TEXT */);
        const dead = [];
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (node.textContent.trim() !== '') continue;
            const before = node.previousSibling;
            const after = node.nextSibling;
            const parent = node.parentElement;
            // Against a block element on either side, or against the open or
            // close tag of the block it sits in. All three are boundaries the
            // renderer eats whitespace at.
            const touchesBlock =
                (before ? before.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has(before.tagName)
                        : !!parent && BLOCK_TAGS.has(parent.tagName))
                || (after ? after.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has(after.tagName)
                          : !!parent && BLOCK_TAGS.has(parent.tagName));
            if (touchesBlock) dead.push(node);
        }
        dead.forEach(node => node.remove());
    }

    function collapseContainers(html) {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const selector = 'div, section, article, header, footer, main, aside';

        let changed = true;
        while (changed) {
            changed = false;
            for (const el of Array.from(doc.querySelectorAll(selector))) {
                // A previous pass in this same sweep may have taken it already.
                if (!el.isConnected) continue;

                if (el.children.length === 0 && el.textContent.trim() === '') {
                    el.remove();
                    changed = true;
                    continue;
                }

                if (el.tagName !== UNWRAPPABLE) continue;
                const kids = Array.from(el.childNodes).filter(
                    node => node.nodeType !== Node.TEXT_NODE || node.textContent.trim() !== ''
                );
                if (kids.length === 1 && kids[0].nodeType === Node.ELEMENT_NODE
                    && (PLAIN_CONTAINERS.has(kids[0].tagName) || kids[0].tagName === 'FIGURE')) {
                    el.replaceWith(...el.childNodes);
                    changed = true;
                }
            }
        }

        dropDeadWhitespace(doc);
        return doc.body.innerHTML;
    }

    /* ----------------------------------------------------------- empty links */

    /** What an anchor the source never named is called. */
    const UNNAMED_LINK = 'image…';

    /** Where a name is looked for, best first. */
    const NAME_ATTRIBUTES = ['alt', 'aria-label', 'title'];

    /** How much of the name stands in for the link text. */
    const NAME_PREVIEW_LENGTH = 4;

    /**
     * Put a name back on a link sanitize emptied.
     *
     * The "see more headlines" control on a Google News card is an <a> around an
     * inline <svg> icon. <svg> is not on the allowlist, and unlike a disallowed
     * HTML tag it is removed with its whole subtree rather than unwrapped — so
     * the anchor comes out of sanitize holding nothing and reads as `[](url)`:
     * invisible in the Markdown, invisible in the Simple HTML, and impossible to
     * tell apart from a copy that quietly lost something.
     *
     * Such an anchor is named from what the source already said about it — its
     * `alt`, else `aria-label`, else `title` — shown as the first few characters
     * and an ellipsis, so the link is visible without a whole sentence standing
     * in for an icon. The name in full goes to `title`, which a browser surfaces
     * on hover and Turndown writes into the link. An anchor the source never
     * named falls back to `image…`.
     *
     * Runs on sanitized markup: before it, the icon is still there and the
     * anchor still looks occupied.
     *
     * An anchor holding an <img> is left alone — it has something to show, and
     * the image carries its own alt.
     */
    function nameEmptyLinks(html) {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const unnamed = Array.from(doc.querySelectorAll('a')).filter(
            a => a.textContent.trim() === '' && !a.querySelector('img')
        );

        unnamed.forEach(a => {
            const name = NAME_ATTRIBUTES
                .map(attribute => (a.getAttribute(attribute) || '').trim())
                .find(Boolean);
            a.textContent = name ? name.slice(0, NAME_PREVIEW_LENGTH).trimEnd() + '…' : UNNAMED_LINK;
            if (name) a.setAttribute('title', name);
        });

        return unnamed.length > 0 ? doc.body.innerHTML : html;
    }

    /**
     * Simple HTML only. Two tidies, both confined to table structure:
     *
     *   - a table with no header row has nothing for <thead>/<tbody> to tell
     *     apart, so its rows sit straight under <table>;
     *   - whitespace between structural tags goes. It is not content — the
     *     parser foster-parents it back out of the table on the way in — and
     *     stripped wrappers leave a good deal of it behind, padding the byte
     *     count the inspector reports against the original.
     *
     * Runs on the sanitized string rather than the document because every parse
     * of table markup re-inserts an implicit <tbody> — dropping it earlier would
     * only see it come back.
     */
    function simplifyTables(html) {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        if (doc.querySelectorAll('table').length === 0) return html;

        doc.querySelectorAll('table').forEach(table => {
            if (hasHeaderRow(table)) return;
            Array.from(table.tBodies).forEach(tbody => {
                tbody.replaceWith(...tbody.childNodes);
            });
        });

        doc.querySelectorAll('table, thead, tbody, tfoot, tr').forEach(node => {
            Array.from(node.childNodes).forEach(child => {
                if (child.nodeType === Node.TEXT_NODE && !child.textContent.trim()) {
                    child.remove();
                }
            });
        });

        return doc.body.innerHTML;
    }

    /* ------------------------------------------------------------ comparison */

    /**
     * Are these two payloads the same clipboard entry?
     *
     * Deliberately not a string comparison. HTML handed to the clipboard comes
     * back parsed and re-serialised by the browser's own sanitiser: the <tbody>
     * that simplifyTables drops from a headerless table is put back, a source
     * may prefix a <meta charset>, and fragment markers can arrive as comments.
     * None of that is a difference anyone can act on — replacing the entry would
     * hand back the identical clipboard.
     *
     * Only those transport artefacts are absorbed. Everything the conversion
     * itself changes — inline styles, vendor tags, wrapper elements, cell
     * contents — still reads as a difference, which is what keeps the action
     * live for a copy that genuinely needs it.
     */
    function isSameHtmlEntry(a, b) {
        return canonical(a) === canonical(b);
    }

    function canonical(html) {
        const doc = new DOMParser().parseFromString(html || '', 'text/html');

        doc.querySelectorAll('meta, base').forEach(node => node.remove());

        // The parser supplies a <tbody> whether or not the markup asked for one,
        // so its presence can never tell two payloads apart.
        doc.querySelectorAll('tbody').forEach(tbody => tbody.replaceWith(...tbody.childNodes));

        const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_COMMENT);
        const comments = [];
        while (walker.nextNode()) comments.push(walker.currentNode);
        comments.forEach(comment => comment.remove());

        // Same rule as simplifyTables: whitespace between structural table tags
        // is not content, and the parser moves it out of the table regardless.
        doc.querySelectorAll('table, thead, tbody, tfoot, tr').forEach(node => {
            Array.from(node.childNodes).forEach(child => {
                if (child.nodeType === Node.TEXT_NODE && !child.textContent.trim()) {
                    child.remove();
                }
            });
        });

        return doc.body.innerHTML.trim();
    }

    /* ------------------------------------------------------------ conversion */

    function sanitize(html) {
        if (typeof DOMPurify === 'undefined') return html;
        return DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR, ALLOW_DATA_ATTR: false });
    }

    function toMarkdown(cleanHtml) {
        const turndownService = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
        if (typeof turndownPluginGfm !== 'undefined') {
            turndownService.use(turndownPluginGfm.gfm);
        }

        // Collapse the whitespace Turndown leaves inside link text.
        return turndownService.turndown(cleanHtml).replace(
            /\[([\s\S]+?)\]\((.*?)\)/g,
            (m, innerText, href) => `[${innerText.trim().replace(/\s+/g, ' ')}](${href})`
        );
    }

    // collapseContainers and nameEmptyLinks are exported for pipeline.js, whose
    // Markdown path does its own sanitize and would otherwise need a second copy
    // of both.
    global.Equivalents = { fromHtml, toSimpleHtml, isSameHtmlEntry, collapseContainers, nameEmptyLinks };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports) {
    module.exports = (typeof window !== 'undefined' ? window : globalThis).Equivalents;
}
