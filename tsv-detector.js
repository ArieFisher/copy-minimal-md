/**
 * Shared TSV-clipboard detection used by both entry points (cmd+shift+U and cmd+shift+O).
 *
 * "TSV clipboard" = text/html absent AND text/plain looks like tab-separated values.
 * When detected, we produce the "simulated" outputs (markdown table + simple HTML table)
 * and fan them out to any registered listeners.
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
        let markdown = '';
        markdown += '| ' + headerCols.join(' | ') + ' |\n';
        markdown += '| ' + headerCols.map(() => '---').join(' | ') + ' |\n';
        for (let i = 1; i < lines.length; i++) {
            const rowCols = lines[i].split('\t');
            while (rowCols.length < headerCols.length) rowCols.push('');
            rowCols.length = headerCols.length;
            markdown += '| ' + rowCols.join(' | ') + ' |\n';
        }

        let simpleHtml = '';
        if (typeof marked !== 'undefined') {
            simpleHtml = marked.parse(markdown).replace(/<th/gi, '<th style="font-weight: normal;"');
        } else {
            simpleHtml = buildSimpleHtml(headerCols, lines.slice(1));
        }

        return {
            markdown,
            simpleHtml,
            plainText,
            sourceType: 'Plain Text (TSV Conversion)'
        };
    }

    function buildSimpleHtml(headerCols, rows) {
        const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        let h = '<table>\n<thead>\n<tr>\n';
        for (const c of headerCols) h += '<th style="font-weight: normal;">' + esc(c) + '</th>\n';
        h += '</tr>\n</thead>\n<tbody>\n';
        for (const row of rows) {
            const cols = row.split('\t');
            while (cols.length < headerCols.length) cols.push('');
            cols.length = headerCols.length;
            h += '<tr>\n';
            for (const c of cols) h += '<td>' + esc(c) + '</td>\n';
            h += '</tr>\n';
        }
        h += '</tbody>\n</table>\n';
        return h;
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
