(function () {
    console.log('AriaPreview: Scanning page for selected cells...');

    // Strategy 1: Standard ARIA aria-selected="true" on role="cell/gridcell/columnheader/rowheader"
    // or on native <td>/<th> elements.
    const ARIA_SEL = [
        '[aria-selected="true"][role="cell"]',
        '[aria-selected="true"][role="gridcell"]',
        '[aria-selected="true"][role="columnheader"]',
        '[aria-selected="true"][role="rowheader"]',
        'td[aria-selected="true"]',
        'th[aria-selected="true"]',
    ].join(', ');

    // Strategy 2: CSS class heuristic for grids like Databricks that apply a "selected" class
    // instead of setting aria-selected. Requires role="cell" or role="gridcell" as a guard
    // so we don't match arbitrary elements that happen to have "selected" in their class.
    const CSS_SEL = [
        '[role="cell"][class*="selected"]',
        '[role="gridcell"][class*="selected"]',
    ].join(', ');

    let selectedCells = [...document.querySelectorAll(ARIA_SEL)];
    let strategy = 'aria-selected';

    if (selectedCells.length === 0) {
        selectedCells = [...document.querySelectorAll(CSS_SEL)];
        strategy = 'css-class';
        console.log('AriaPreview: aria-selected strategy found nothing — trying CSS class heuristic.');
    }

    console.log(`AriaPreview: Found ${selectedCells.length} selected cell(s) via "${strategy}".`);

    if (selectedCells.length === 0) {
        console.log('AriaPreview: No selected cells — sending null to background.');
        chrome.runtime.sendMessage({ type: 'aria-preview', data: null });
        return;
    }

    // Databricks (and similar grids) stamp data-row / data-col on every cell.
    // When present, use them for precise row grouping and column ordering instead of
    // relying on DOM parent-child relationships, which may be flattened or virtualised.
    const hasCoords = selectedCells.some(
        c => c.dataset.row !== undefined && c.dataset.col !== undefined
    );
    console.log(`AriaPreview: Cells have data-row/data-col coords: ${hasCoords}`);

    let rows; // Array<Array<Element>>, each inner array is one row in display order

    if (hasCoords) {
        // Group by data-row value, then sort each group by data-col.
        const rowMap = new Map();
        for (const cell of selectedCells) {
            const r = cell.dataset.row ?? '0';
            if (!rowMap.has(r)) rowMap.set(r, []);
            rowMap.get(r).push(cell);
        }
        for (const cells of rowMap.values()) {
            cells.sort((a, b) => Number(a.dataset.col) - Number(b.dataset.col));
        }
        rows = [...rowMap.entries()]
            .sort((a, b) => Number(a[0]) - Number(b[0]))
            .map(([, cells]) => cells);

        // Auto-include column headers for the selected column indices.
        // The user typically drags across data cells only, so the header row is not
        // part of the selection — but it's needed to produce a labelled Markdown table.
        const selectedCols = new Set(
            selectedCells.map(c => c.dataset.col).filter(v => v !== undefined)
        );
        const headerCells = [...document.querySelectorAll('[role="columnheader"]')]
            .filter(h => selectedCols.has(h.dataset.col));
        if (headerCells.length > 0) {
            headerCells.sort((a, b) => Number(a.dataset.col) - Number(b.dataset.col));
            rows.unshift(headerCells); // prepend as the header row
            console.log(`AriaPreview: Auto-included ${headerCells.length} column header(s) for cols [${[...selectedCols].join(', ')}].`);
        } else {
            console.log('AriaPreview: No matching role="columnheader" elements found — first data row will be promoted.');
        }
    } else {
        // Fall back to DOM parent-row grouping (role="row" or native <tr>).
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
        rows = [...rowMap.values()];
    }

    console.log(`AriaPreview: Grouped into ${rows.length} row(s).`);

    if (rows.length === 0) {
        console.log('AriaPreview: No rows after grouping — sending null to background.');
        chrome.runtime.sendMessage({ type: 'aria-preview', data: null });
        return;
    }

    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const tbody = document.createElement('tbody');
    let hasHeader = false;

    for (const cells of rows) {
        const tr = document.createElement('tr');
        let isHeaderRow = false;
        for (const cell of cells) {
            const isHeader = cell.getAttribute('role') === 'columnheader' || cell.tagName === 'TH';
            if (isHeader) isHeaderRow = true;
            const el = document.createElement(isHeader ? 'th' : 'td');
            el.textContent = cell.textContent.trim();
            tr.appendChild(el);
        }
        if (isHeaderRow) { hasHeader = true; thead.appendChild(tr); }
        else tbody.appendChild(tr);
    }

    // Turndown GFM requires a <thead> to emit a Markdown table.
    // If no header cells were found and auto-include didn't help, promote the first data row.
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

    const totalCells = rows.reduce((s, r) => s + r.length, 0);
    console.log(`AriaPreview: Table built — ${rows.length} rows, ${totalCells} cells (strategy: ${strategy}). Sending to background.`);
    console.log('AriaPreview: Table HTML:', table.outerHTML);

    chrome.runtime.sendMessage({
        type: 'aria-preview',
        data: { html: table.outerHTML, cellCount: totalCells, rowCount: rows.length, strategy },
    });
})();
