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

    const ALLOWED_TAGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'li', 'b', 'i', 'strong', 'em', 'u', 'a', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'br', 'hr', 'blockquote', 'code', 'pre'];
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
        return simplifyTables(sanitize(repair(htmlText).repaired));
    }

    function fromHtml(htmlText) {
        const { repaired, sourceType } = repair(htmlText);

        const simpleHtml = simplifyTables(sanitize(repaired));

        // The promotion happens on a throwaway parse so it reaches the Markdown
        // and nothing else.
        const mdDoc = new DOMParser().parseFromString(repaired, 'text/html');
        const promoted = promoteImplicitHeaders(mdDoc);
        const markdown = toMarkdown(sanitize(promoted ? mdDoc.body.innerHTML : repaired));

        return { markdown, simpleHtml, derivedFrom: 'text/html', sourceType };
    }

    /* ------------------------------------------------------ source repairs */

    /** Google Sheets: block-level <div>s inside cells produce extra newlines. */
    function inlineCellDivs(doc) {
        const divs = Array.from(doc.querySelectorAll('td div, th div'));
        divs.forEach(div => {
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

    global.Equivalents = { fromHtml, toSimpleHtml, isSameHtmlEntry };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports) {
    module.exports = (typeof window !== 'undefined' ? window : globalThis).Equivalents;
}
