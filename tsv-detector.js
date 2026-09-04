/**
 * Shared TSV-clipboard detection used by both entry points (cmd+shift+U and cmd+shift+O).
 *
 * "TSV clipboard" = text/html absent AND text/plain looks like tab-separated values.
 * When detected, we produce the "simulated" outputs (markdown table + simple HTML table)
 * and fan them out to any registered listeners.
 *
 * `detect` builds the cells into a table with DOM methods and hands that table
 * to `Equivalents.fromHtml`, the derivation every other source goes through.
 * Two things follow. `textContent` escapes cell text as it writes it, so a
 * spreadsheet cell holding a tag comes out as the tag's characters. And a
 * spreadsheet copy says what a clipboard copy of the same table says, because
 * one derivation produces both.
 *
 * Expected globals at call time:
 *   - Equivalents  (equivalents.js)
 *   - DOMParser    (browser global / jsdom)
 *
 * `tsv-detector.js` loads before `equivalents.js`, which costs nothing:
 * `detect` runs long after every script is in place.
 */
(function (global) {
    function detect({ hasHtml, plainText }) {
        if (hasHtml) return null;
        if (!plainText) return null;

        const lines = plainText.trim().split(/\r?\n/);
        if (lines.length < 2) return null;

        const tabCount = (lines[0].match(/\t/g) || []).length;
        if (tabCount === 0) return null;

        const headerCols = lines[0].split('\t');
        const { markdown, simpleHtml } = Equivalents.fromHtml(buildTable(headerCols, lines.slice(1)));

        return {
            markdown,
            simpleHtml,
            plainText,
            sourceType: 'Plain Text (TSV Conversion)'
        };
    }

    /**
     * The cells as an HTML table: a header row from the first line, one body
     * row per line after it. Short rows are padded to the header's width and
     * long ones are cut to it, so every row has the same number of cells.
     */
    function buildTable(headerCols, rows) {
        const doc = new DOMParser().parseFromString('<table></table>', 'text/html');
        const table = doc.querySelector('table');

        const thead = doc.createElement('thead');
        const headRow = doc.createElement('tr');
        for (const text of headerCols) {
            const th = doc.createElement('th');
            th.textContent = text;
            headRow.appendChild(th);
        }
        thead.appendChild(headRow);
        table.appendChild(thead);

        const tbody = doc.createElement('tbody');
        for (const row of rows) {
            const cols = row.split('\t');
            while (cols.length < headerCols.length) cols.push('');
            cols.length = headerCols.length;

            const tr = doc.createElement('tr');
            for (const text of cols) {
                const td = doc.createElement('td');
                td.textContent = text;
                tr.appendChild(td);
            }
            tbody.appendChild(tr);
        }
        table.appendChild(tbody);

        return table.outerHTML;
    }

    const listeners = [];
    function addListener(fn) { listeners.push(fn); }
    async function fire(detection) {
        for (const fn of listeners) {
            try { await fn(detection); }
            catch (e) { console.error('TsvDetector listener failed:', e); }
        }
    }

    global.TsvDetector = { detect, addListener, fire };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports) {
    module.exports = (typeof window !== 'undefined' ? window : globalThis).TsvDetector;
}
