/**
 * pipeline.js
 *
 * Pure HTML → Markdown transformations extracted from content.js so they
 * can be unit/regression tested directly (no clipboard, no DOM injection).
 *
 * Exports `window.Pipeline = { htmlToMarkdown, htmlToSimpleHtml, gridToMarkdown,
 * gridToSimpleHtml }`.
 *
 * Expected globals at call time:
 *   - DOMPurify        (lib/purify.min.js)
 *   - TurndownService  (lib/turndown.js)
 *   - turndownPluginGfm (lib/turndown-plugin-gfm.js)
 *   - Equivalents      (equivalents.js — the Simple HTML derivation)
 *   - DOMParser        (browser global / jsdom)
 *
 * The full pipeline executes in two parts:
 *   1. Optional GridDetector pre-pass (in content.js) builds `gridResult`.
 *   2. htmlToMarkdown(html, { gridResult }) returns the final markdown string.
 *
 * When there is no `text/html` clipboard payload but `gridResult` reconstructed
 * a table, call `gridToMarkdown(gridResult)` instead.
 *
 * Tables get a second output. `htmlToSimpleHtml` / `gridToSimpleHtml` return the
 * Simple HTML for the same copy, which content.js writes to the clipboard's
 * text/html so a paste into a rich-text editor lands as a real table. Both
 * return '' when the copy holds no table.
 */
(function (global) {
    if (global.Pipeline) return;

    const ALLOWED_TAGS = ['h1','h2','h3','h4','h5','h6','p','ul','ol','li','b','i','strong','em','u','a','img','table','thead','tbody','tr','th','td','br','hr','blockquote','code','pre','div','section','article','figure','figcaption','header','footer','main','aside'];
    const ALLOWED_ATTR = ['href','src','alt','title'];
    const GRID_ALLOWED_TAGS = ['table','thead','tbody','tr','th','td'];

    /**
     * Fold the DOM-extracted grid into the clipboard document: swap jagged native
     * tables for their DOM originals, or inject the reconstructed table where the
     * clipboard HTML has none. Shared by both outputs, so the Markdown and the
     * Simple HTML always describe the same repaired table.
     *
     * Mutates `doc`; returns whether anything changed.
     */
    function applyGridRepairs(doc, gridResult) {
        const tables = doc.querySelectorAll('table');
        let modified = false;

        // Native-table jagged-repair: replace clipboard tables with DOM-extracted ones
        // when counts match and clipboard column count is not >2× the DOM's (layout-table guard).
        if (tables.length > 0 && gridResult && gridResult.type === 'native' && gridResult.tables.length === tables.length) {
            let structureMatch = true;
            for (let i = 0; i < tables.length; i++) {
                const maxClipboardCols = Math.max(...Array.from(tables[i].rows).map(r => r.cells.length));
                const domCols = (gridResult.tables[i].rows[0] && gridResult.tables[i].rows[0].cells.length) || 0;
                if (domCols > 0 && maxClipboardCols > domCols * 2) {
                    structureMatch = false;
                    break;
                }
            }
            if (structureMatch) {
                for (let i = 0; i < tables.length; i++) {
                    tables[i].replaceWith(doc.adoptNode(gridResult.tables[i].cloneNode(true)));
                }
                modified = true;
            }
        }

        // ARIA/heuristic grid injection: clipboard HTML has no <table>, inject the
        // DOM-reconstructed table(s) so Turndown emits a real Markdown table.
        if (tables.length === 0 && gridResult && (gridResult.type === 'aria' || gridResult.type === 'heuristic')) {
            doc.body.innerHTML = '';
            for (const t of gridResult.tables) {
                doc.body.appendChild(doc.adoptNode(t.cloneNode(true)));
            }
            modified = true;
        }

        return modified;
    }

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

    function htmlToMarkdown(htmlText, opts) {
        const gridResult = (opts && opts.gridResult) || null;

        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlText, 'text/html');
        let modified = applyGridRepairs(doc, gridResult);

        const currentTables = doc.querySelectorAll('table');

        // div is in ALLOWED_TAGS, so block boundaries survive sanitize — which
        // means a <div> left inside a cell would survive too, and split a table
        // row across lines and break the Markdown table syntax. Inlining cell
        // divs into <span>s here, before sanitize runs, is what keeps that block
        // break out of the table — but the break itself isn't discarded, it
        // degrades to a <br>, the one line-break spelling a Markdown table cell
        // can carry (turndown-plugin-gfm passes a <br> inside a cell through
        // untouched). A <br> goes in only between two divs that each contribute
        // content — never at the start or end of a cell, and never doubled next
        // to a <br> the source already had.
        Array.from(doc.querySelectorAll('td div, th div')).forEach(div => {
            if (hasContentBeforeCellDiv(div)) {
                div.before(doc.createElement('br'));
            }
            const span = doc.createElement('span');
            span.append(...div.childNodes);
            div.replaceWith(span);
            modified = true;
        });

        // Google Docs wraps the whole copy in <b style="font-weight:normal">. Strip it.
        Array.from(doc.querySelectorAll('b[style*="font-weight:normal"], b[style*="font-weight: normal"]')).forEach(b => {
            const span = doc.createElement('span');
            span.append(...b.childNodes);
            b.replaceWith(span);
            modified = true;
        });

        // Implicit-header promotion: if a table has no <thead> and its first row isn't all <th>,
        // promote that row to <thead> so Turndown GFM emits a proper Markdown header.
        currentTables.forEach(table => {
            const firstRow = table.rows[0];
            if (firstRow && !table.tHead) {
                const isImplicitHeader = Array.from(firstRow.cells).every(c => c.tagName === 'TH');
                if (!isImplicitHeader) {
                    const thead = doc.createElement('thead');
                    const tr = doc.createElement('tr');
                    for (let i = 0; i < firstRow.cells.length; i++) {
                        const th = doc.createElement('th');
                        th.textContent = (firstRow.cells[i] && firstRow.cells[i].textContent) || '';
                        tr.appendChild(th);
                    }
                    thead.appendChild(tr);
                    table.insertBefore(thead, table.firstChild);
                    firstRow.remove();
                    modified = true;
                }
            }
        });

        if (modified) {
            htmlText = doc.body.innerHTML;
        }

        const cleanHtml = Equivalents.collapseContainers(Equivalents.nameEmptyLinks(DOMPurify.sanitize(htmlText, {
            ALLOWED_TAGS, ALLOWED_ATTR, ALLOW_DATA_ATTR: false
        })));

        const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
        td.use(turndownPluginGfm.gfm);

        let markdown = td.turndown(cleanHtml);
        markdown = markdown.replace(/\[([\s\S]+?)\]\((.*?)\)/g, (m, innerText, href) => {
            return `[${innerText.trim().replace(/\s+/g, ' ')}](${href})`;
        });
        return markdown;
    }

    /**
     * The Simple HTML companion to htmlToMarkdown: the same repaired document,
     * simplified rather than converted, for the clipboard's text/html entry.
     *
     * Only a table gets one, and the check is deliberately on this document
     * rather than on what comes back — the two entries have to agree, so
     * text/html carries a table exactly when the Markdown is one too. Prose
     * returns '' and leaves the entry alone.
     */
    function htmlToSimpleHtml(htmlText, opts) {
        const gridResult = (opts && opts.gridResult) || null;

        const doc = new DOMParser().parseFromString(htmlText, 'text/html');
        const modified = applyGridRepairs(doc, gridResult);
        if (doc.querySelectorAll('table').length === 0) return '';

        return Equivalents.toSimpleHtml(modified ? doc.body.innerHTML : htmlText);
    }

    function gridToMarkdown(gridResult) {
        if (!gridResult || !gridResult.tables || !gridResult.tables[0]) return '';
        const cleanHtml = DOMPurify.sanitize(gridResult.tables[0].outerHTML, {
            ALLOWED_TAGS: GRID_ALLOWED_TAGS,
            ALLOWED_ATTR: [],
            ALLOW_DATA_ATTR: false
        });
        const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
        td.use(turndownPluginGfm.gfm);
        return td.turndown(cleanHtml);
    }

    /** Simple HTML for the path where the table came straight from the DOM. */
    function gridToSimpleHtml(gridResult) {
        if (!gridResult || !gridResult.tables || !gridResult.tables[0]) return '';
        return Equivalents.toSimpleHtml(gridResult.tables[0].outerHTML);
    }

    global.Pipeline = { htmlToMarkdown, htmlToSimpleHtml, gridToMarkdown, gridToSimpleHtml };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports) {
    module.exports = (typeof window !== 'undefined' ? window : globalThis).Pipeline;
}
