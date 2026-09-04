/**
 * pipeline.js
 *
 * Pure HTML → Markdown transformations extracted from content.js so they
 * can be unit/regression tested directly (no clipboard, no DOM injection).
 *
 * Exports `window.Pipeline = { htmlToEntries, htmlToMarkdown, htmlToSimpleHtml,
 * gridToEntries, gridToMarkdown, gridToSimpleHtml }`.
 *
 * Expected globals at call time:
 *   - Equivalents      (equivalents.js — the derivation both entries come from)
 *   - DOMParser        (browser global / jsdom)
 *
 * The full pipeline executes in two parts:
 *   1. Optional GridDetector pre-pass (in content.js) builds `gridResult`.
 *   2. htmlToEntries(html, { gridResult }) returns both clipboard entries.
 *
 * When there is no `text/html` clipboard payload but `gridResult` reconstructed
 * a table, call `gridToEntries` instead.
 *
 * Every copy has two entries, not just a table: the Markdown goes to text/plain
 * and the Simple HTML to text/html, so a paste into a rich-text editor lands the
 * copy's structure rather than the syntax that spells it. The Simple HTML is ''
 * only when the copy simplifies to nothing at all, which is content.js's signal
 * to write text/plain on its own.
 */
(function (global) {
    if (global.Pipeline) return;

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
     * Both clipboard entries for one copy, from one document.
     *
     * The grid repairs are the only thing this module does that the inspector
     * cannot: they need the live DOM, which only the content script has. They
     * change what the copy *is* — which cells it holds — so they run here, once,
     * before anything forks (tier 1 in docs/pipeline-placement.md).
     *
     * Everything after them is `Equivalents.fromHtml`, the same derivation the
     * inspector previews. Both entries come out of that one call, which is what
     * keeps them describing the same copy: a repair either reaches both or
     * reaches neither, and there is no second copy of the source repairs here to
     * fall behind the one in equivalents.js.
     */
    function htmlToEntries(htmlText, opts) {
        const gridResult = (opts && opts.gridResult) || null;

        const doc = new DOMParser().parseFromString(htmlText, 'text/html');
        const modified = applyGridRepairs(doc, gridResult);

        const { markdown, simpleHtml } = Equivalents.fromHtml(modified ? doc.body.innerHTML : htmlText);

        // A copy that simplifies to nothing — an empty payload, or markup that
        // was all wrappers and vendor tags — has no text/html entry to write.
        // '' is what content.js reads as "text/plain on its own"; a blank entry
        // would instead paste as nothing into a rich-text editor.
        return { markdown, simpleHtml: simpleHtml.trim() ? simpleHtml : '' };
    }

    /** The text/plain entry on its own, for callers with no use for the other. */
    function htmlToMarkdown(htmlText, opts) {
        return htmlToEntries(htmlText, opts).markdown;
    }

    /** The text/html entry on its own. '' when the copy simplifies to nothing. */
    function htmlToSimpleHtml(htmlText, opts) {
        return htmlToEntries(htmlText, opts).simpleHtml;
    }

    /**
     * Both clipboard entries for the path where the table came straight from
     * the DOM, because the clipboard carried no HTML to work from.
     *
     * A table read off the page is HTML like any other source, so it goes
     * through `Equivalents.fromHtml` — the same sanitize allowlist, the same
     * converter, the same escapes. A grid copy and a clipboard copy of the
     * same table then say the same thing.
     */
    function gridToEntries(gridResult) {
        if (!gridResult || !gridResult.tables || !gridResult.tables[0]) {
            return { markdown: '', simpleHtml: '' };
        }
        const { markdown, simpleHtml } = Equivalents.fromHtml(gridResult.tables[0].outerHTML);
        return { markdown, simpleHtml: simpleHtml.trim() ? simpleHtml : '' };
    }

    /** The text/plain entry on its own, for the grid path. */
    function gridToMarkdown(gridResult) {
        return gridToEntries(gridResult).markdown;
    }

    /** The text/html entry on its own, for the grid path. */
    function gridToSimpleHtml(gridResult) {
        return gridToEntries(gridResult).simpleHtml;
    }

    global.Pipeline = { htmlToEntries, htmlToMarkdown, htmlToSimpleHtml, gridToEntries, gridToMarkdown, gridToSimpleHtml };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports) {
    module.exports = (typeof window !== 'undefined' ? window : globalThis).Pipeline;
}
