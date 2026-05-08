(function () {
    console.log('AriaPreview: Scanning page for aria-selected="true" cells...');

    const CELL_SEL = [
        '[aria-selected="true"][role="cell"]',
        '[aria-selected="true"][role="gridcell"]',
        '[aria-selected="true"][role="columnheader"]',
        '[aria-selected="true"][role="rowheader"]',
        'td[aria-selected="true"]',
        'th[aria-selected="true"]',
    ].join(', ');

    const selectedCells = [...document.querySelectorAll(CELL_SEL)];
    console.log(`AriaPreview: Found ${selectedCells.length} aria-selected cell(s).`);

    if (selectedCells.length === 0) {
        console.log('AriaPreview: No selected cells — sending null to background.');
        chrome.runtime.sendMessage({ type: 'aria-preview', data: null });
        return;
    }

    // Group cells by their parent row element (role="row" or native <tr>), preserving DOM order.
    const rowMap = new Map();
    for (const cell of selectedCells) {
        const row = cell.closest('[role="row"], tr');
        if (!row) {
            console.warn('AriaPreview: Cell has no recognisable parent row — skipping.', cell);
            continue;
        }
        if (!rowMap.has(row)) rowMap.set(row, []);
        rowMap.get(row).push(cell);
    }
    console.log(`AriaPreview: Grouped into ${rowMap.size} row(s).`);

    if (rowMap.size === 0) {
        console.log('AriaPreview: No rows after grouping — sending null to background.');
        chrome.runtime.sendMessage({ type: 'aria-preview', data: null });
        return;
    }

    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const tbody = document.createElement('tbody');
    let hasHeader = false;

    for (const [, cells] of rowMap) {
        const tr = document.createElement('tr');
        let isHeaderRow = false;
        for (const cell of cells) {
            // role="columnheader" or a native <th> counts as a header cell.
            const isHeader =
                cell.getAttribute('role') === 'columnheader' || cell.tagName === 'TH';
            if (isHeader) isHeaderRow = true;
            const el = document.createElement(isHeader ? 'th' : 'td');
            el.textContent = cell.textContent.trim();
            tr.appendChild(el);
        }
        if (isHeaderRow) { hasHeader = true; thead.appendChild(tr); }
        else tbody.appendChild(tr);
    }

    // Turndown GFM requires a <thead> to emit a Markdown table.
    // If no header cells were found, promote the first data row.
    if (!hasHeader && tbody.firstChild) {
        console.log('AriaPreview: No header row detected — promoting first data row to <thead>.');
        const firstRow = tbody.firstChild;
        const headerTr = document.createElement('tr');
        for (const cell of firstRow.cells) {
            const th = document.createElement('th');
            th.textContent = cell.textContent;
            headerTr.appendChild(th);
        }
        thead.appendChild(headerTr);
        firstRow.remove();
        hasHeader = true;
    }

    if (hasHeader) table.appendChild(thead);
    table.appendChild(tbody);

    const totalCells = [...rowMap.values()].reduce((s, c) => s + c.length, 0);
    console.log(`AriaPreview: Table built — ${rowMap.size} rows, ${totalCells} cells. Sending to background.`);
    console.log('AriaPreview: Table HTML:', table.outerHTML);

    chrome.runtime.sendMessage({
        type: 'aria-preview',
        data: { html: table.outerHTML, cellCount: totalCells, rowCount: rowMap.size },
    });
})();
