/**
 * pipeline.js
 *
 * Pure HTML → Markdown transformations extracted from content.js so they
 * can be unit/regression tested directly (no clipboard, no DOM injection).
 *
 * Exports `window.Pipeline = { htmlToMarkdown, gridToMarkdown }`.
 *
 * Expected globals at call time:
 *   - DOMPurify        (lib/purify.min.js)
 *   - TurndownService  (lib/turndown.js)
 *   - turndownPluginGfm (lib/turndown-plugin-gfm.js)
 *   - DOMParser        (browser global / jsdom)
 *
 * The full pipeline executes in two parts:
 *   1. Optional GridDetector pre-pass (in content.js) builds `gridResult`.
 *   2. htmlToMarkdown(html, { gridResult }) returns the final markdown string.
 *
 * When there is no `text/html` clipboard payload but `gridResult` reconstructed
 * a table, call `gridToMarkdown(gridResult)` instead.
 */
(function (global) {
    if (global.Pipeline) return;

    const ALLOWED_TAGS = ['h1','h2','h3','h4','h5','h6','p','ul','ol','li','b','i','strong','em','u','a','img','table','thead','tbody','tr','th','td','br','hr','blockquote','code','pre'];
    const ALLOWED_ATTR = ['href','src','alt','title'];
    const GRID_ALLOWED_TAGS = ['table','thead','tbody','tr','th','td'];

    function htmlToMarkdown(htmlText, opts) {
        const gridResult = (opts && opts.gridResult) || null;

        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlText, 'text/html');
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

        const currentTables = doc.querySelectorAll('table');

        // Google Sheets: block-level <div>s inside cells produce extra newlines in Turndown.
        // Replace with inline <span>s.
        Array.from(doc.querySelectorAll('td div, th div')).forEach(div => {
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

        const cleanHtml = DOMPurify.sanitize(htmlText, {
            ALLOWED_TAGS, ALLOWED_ATTR, ALLOW_DATA_ATTR: false
        });

        const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
        td.use(turndownPluginGfm.gfm);

        let markdown = td.turndown(cleanHtml);
        markdown = markdown.replace(/\[([\s\S]+?)\]\((.*?)\)/g, (m, innerText, href) => {
            return `[${innerText.trim().replace(/\s+/g, ' ')}](${href})`;
        });
        return markdown;
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

    global.Pipeline = { htmlToMarkdown, gridToMarkdown };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports) {
    module.exports = (typeof window !== 'undefined' ? window : globalThis).Pipeline;
}
