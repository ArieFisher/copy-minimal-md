(function () {
    const CELL_SEL = [
        '[aria-selected="true"][role="cell"]',
        '[aria-selected="true"][role="gridcell"]',
        '[aria-selected="true"][role="columnheader"]',
        '[aria-selected="true"][role="rowheader"]',
        'td[aria-selected="true"]',
        'th[aria-selected="true"]',
    ].join(', ');

    const selectedCells = [...document.querySelectorAll(CELL_SEL)];

    if (selectedCells.length === 0) {
        chrome.runtime.sendMessage({ type: 'aria-preview', data: null });
        return;
    }

    // Group by parent row (role="row" or <tr>), preserving DOM order
    const rowMap = new Map();
    for (const cell of selectedCells) {
        const row = cell.closest('[role="row"], tr');
        if (!row) continue;
        if (!rowMap.has(row)) rowMap.set(row, []);
        rowMap.get(row).push(cell);
    }

    if (rowMap.size === 0) {
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

    // Promote first data row to header so Turndown GFM renders a Markdown table
    if (!hasHeader && tbody.firstChild) {
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

    chrome.runtime.sendMessage({
        type: 'aria-preview',
        data: { html: table.outerHTML, cellCount: totalCells, rowCount: rowMap.size },
    });
})();
