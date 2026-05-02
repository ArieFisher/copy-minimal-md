/**
 * grid-detector.js
 *
 * Detects structured data grids in the user's current DOM selection and
 * reconstructs them as proper <table> elements BEFORE the clipboard copy fires.
 *
 * Strategies (tried in priority order):
 *   1. NativeTableStrategy   — standard <table>, <tr>, <td> elements
 *   2. AriaGridStrategy      — divs/spans with role="grid/table/row/cell"
 *   3. HeuristicDivStrategy  — repeating sibling-div patterns (no ARIA roles)
 *
 * Return shape (all strategies):
 *   null                               → strategy did not match
 *   { type: string, tables: Element[] } → one or more reconstructed <table> elements
 *
 * content.js is responsible for the post-copy injection step (Option A):
 *   • 'native' tables: swap the browser's jagged clipboard HTML for our reconstructed ones.
 *   • 'aria' / 'heuristic' tables: serialize to HTML and feed directly into Turndown,
 *     bypassing the clipboard HTML (which is absent or unusable for these grid types).
 */

(function (global) {
    if (global.GridDetector) return;

    // ---------------------------------------------------------------------------
    // Shared utilities
    // ---------------------------------------------------------------------------

    /**
     * Pre-extracts the ranges from `selection` into a plain array.
     * Call once per trigger, then pass the result to _intersectsRanges.
     * Avoids repeated getRangeAt() allocations inside per-node hot loops.
     */
    function _extractRanges(selection) {
        const ranges = [];
        for (let i = 0; i < selection.rangeCount; i++) ranges.push(selection.getRangeAt(i));
        return ranges;
    }

    /**
     * Returns true if `node` intersects any of the pre-extracted ranges.
     */
    function _intersectsSelection(node, selection) {
        for (let i = 0; i < selection.rangeCount; i++) {
            if (selection.getRangeAt(i).intersectsNode(node)) return true;
        }
        return false;
    }

    /** Variant that accepts a pre-built ranges array (see _extractRanges). */
    function _intersectsRanges(node, ranges) {
        for (const range of ranges) {
            if (range.intersectsNode(node)) return true;
        }
        return false;
    }

    // ---------------------------------------------------------------------------
    // Strategy 1: Native <table> elements
    // ---------------------------------------------------------------------------

    const NativeTableStrategy = {
        canHandle(selection) {
            const tables = document.querySelectorAll('table');
            for (const t of tables) {
                if (_intersectsSelection(t, selection)) return true;
            }
            return false;
        },

        extract(selection) {
            const allTables = document.querySelectorAll('table');
            const intersecting = Array.from(allTables).filter(t => _intersectsSelection(t, selection));
            if (intersecting.length === 0) return null;

            const resultTables = intersecting.map(table => {
                let minRow = Infinity, maxRow = -1, minCol = Infinity, maxCol = -1;

                for (let r = 0; r < table.rows.length; r++) {
                    const row = table.rows[r];
                    for (let c = 0; c < row.cells.length; c++) {
                        if (_intersectsSelection(row.cells[c], selection)) {
                            if (r < minRow) minRow = r;
                            if (r > maxRow) maxRow = r;
                            if (c < minCol) minCol = c;
                            if (c > maxCol) maxCol = c;
                        }
                    }
                }

                if (minRow === Infinity) return null;

                const newTable = document.createElement('table');
                for (let r = minRow; r <= maxRow; r++) {
                    const row = table.rows[r];
                    if (!row) continue;
                    const newRow = document.createElement('tr');
                    for (let c = minCol; c <= maxCol; c++) {
                        const cell = row.cells[c];
                        const isSelected = cell && _intersectsSelection(cell, selection);
                        const newCell = document.createElement(cell && cell.tagName === 'TH' ? 'th' : 'td');
                        if (isSelected) newCell.innerHTML = cell.innerHTML;
                        newRow.appendChild(newCell);
                    }
                    newTable.appendChild(newRow);
                }

                console.log(`GridDetector [native]: rows ${minRow}–${maxRow}, cols ${minCol}–${maxCol}`);
                return newTable;
            }).filter(Boolean);

            return resultTables.length > 0 ? { type: 'native', tables: resultTables } : null;
        }
    };

    // ---------------------------------------------------------------------------
    // Strategy 2: ARIA Grid (role="grid" / "table" / "treegrid")
    // ---------------------------------------------------------------------------

    const AriaGridStrategy = {
        canHandle(selection) {
            const roots = document.querySelectorAll('[role="table"], [role="grid"], [role="treegrid"]');
            for (const t of roots) {
                if (_intersectsSelection(t, selection)) return true;
            }
            return false;
        },

        extract(selection) {
            const CELL_ROLES = '[role="cell"], [role="gridcell"], [role="columnheader"], [role="rowheader"]';
            const roots = document.querySelectorAll('[role="table"], [role="grid"], [role="treegrid"]');

            for (const root of roots) {
                if (!_intersectsSelection(root, selection)) continue;

                const ariaRows = root.querySelectorAll('[role="row"]');
                let minRow = Infinity, maxRow = -1, minCol = Infinity, maxCol = -1;

                for (let r = 0; r < ariaRows.length; r++) {
                    const ariaCells = ariaRows[r].querySelectorAll(CELL_ROLES);
                    for (let c = 0; c < ariaCells.length; c++) {
                        if (_intersectsSelection(ariaCells[c], selection)) {
                            if (r < minRow) minRow = r;
                            if (r > maxRow) maxRow = r;
                            if (c < minCol) minCol = c;
                            if (c > maxCol) maxCol = c;
                        }
                    }
                }

                if (minRow === Infinity) continue;

                const newTable = document.createElement('table');
                let thead = null;
                const tbody = document.createElement('tbody');

                for (let r = minRow; r <= maxRow; r++) {
                    const ariaRow = ariaRows[r];
                    if (!ariaRow) continue;
                    const ariaCells = ariaRow.querySelectorAll(CELL_ROLES);
                    const tr = document.createElement('tr');
                    let isHeaderRow = false;

                    for (let c = minCol; c <= maxCol; c++) {
                        const ariaCell = ariaCells[c];
                        const isSelected = ariaCell && _intersectsSelection(ariaCell, selection);
                        const isHeader = ariaCell && ariaCell.getAttribute('role') === 'columnheader';
                        if (isHeader) isHeaderRow = true;
                        const cell = document.createElement(isHeader ? 'th' : 'td');
                        if (isSelected && ariaCell) cell.textContent = ariaCell.textContent.trim();
                        tr.appendChild(cell);
                    }

                    if (isHeaderRow) {
                        if (!thead) thead = document.createElement('thead');
                        thead.appendChild(tr);
                    } else {
                        tbody.appendChild(tr);
                    }
                }

                // Turndown GFM requires a <thead> to render a Markdown table.
                // If no role="columnheader" cells were found, promote the first data row.
                if (!thead && tbody.firstChild) {
                    thead = document.createElement('thead');
                    const firstDataRow = tbody.firstChild;
                    const headerTr = document.createElement('tr');
                    Array.from(firstDataRow.cells).forEach(cell => {
                        const th = document.createElement('th');
                        th.textContent = cell.textContent;
                        headerTr.appendChild(th);
                    });
                    thead.appendChild(headerTr);
                    firstDataRow.remove();
                }

                if (thead) newTable.appendChild(thead);
                newTable.appendChild(tbody);

                console.log(`GridDetector [aria]: rows ${minRow}–${maxRow}, cols ${minCol}–${maxCol}`);
                return { type: 'aria', tables: [newTable] };
            }

            return null;
        }
    };

    // ---------------------------------------------------------------------------
    //  Strategy 3: Orphan ARIA Row Grid (role="row" cells with no role="grid" root)
    // ---------------------------------------------------------------------------
    // Databricks and similar virtualised data grids emit role="row"/"cell"/"columnheader"
    // elements but omit a wrapping role="grid" or role="table" element.
    // AriaGridStrategy therefore never fires; execCommand('copy') then triggers the
    // site's own handler which writes SQL or other unexpected content rather than TSV.
    // This strategy detects the pattern using the browser text selection, extracts the
    // data rows directly from the DOM, and returns type='orphan-aria' so content.js can
    // skip execCommand entirely and synthesise Markdown from the pre-extracted table.
    // ---------------------------------------------------------------------------

    const OrphanAriaRowStrategy = {
        _CELL_SEL: '[role="cell"], [role="gridcell"], [role="columnheader"], [role="rowheader"]',
        _GRID_SEL: '[role="grid"], [role="table"], [role="treegrid"]',
        _cachedOrphanRows: null,

        _orphanRows() {
            if (this._cachedOrphanRows) return this._cachedOrphanRows;
            this._cachedOrphanRows = Array.from(document.querySelectorAll('[role="row"]')).filter(row =>
                !row.closest(this._GRID_SEL) && !!row.querySelector(this._CELL_SEL)
            );
            return this._cachedOrphanRows;
        },

        canHandle(selection) {
            // Cache is populated here and reused by extract(); cleared at end of extract().
            for (const row of this._orphanRows()) {
                if (_intersectsSelection(row, selection)) return true;
            }
            this._cachedOrphanRows = null; // canHandle returned false — clear cache
            return false;
        },

        extract(selection) {
            const allOrphanRows = this._orphanRows(); // reuses cache from canHandle
            try {
            if (allOrphanRows.length === 0) return null;

            const selectedRows = allOrphanRows.filter(row => _intersectsSelection(row, selection));
            if (selectedRows.length === 0) return null;

            // Find the common ancestor of all selected data rows using the browser's
            // native Range algorithm, then broaden one level to reach sibling header
            // rows (e.g. Databricks sticky header row lives outside the scroll container).
            const spanRange = document.createRange();
            spanRange.setStartBefore(selectedRows[0]);
            spanRange.setEndAfter(selectedRows[selectedRows.length - 1]);
            let dataAncestor = spanRange.commonAncestorContainer;
            // commonAncestorContainer may be a text node; normalize to an element.
            if (dataAncestor.nodeType !== Node.ELEMENT_NODE) {
                dataAncestor = dataAncestor.parentElement;
            }
            const gridContainer = dataAncestor.parentElement || dataAncestor;

            // Safety net: if the container resolved all the way to the document root,
            // querying from here would match unrelated rows across the whole page.
            if (gridContainer === document.body || gridContainer === document.documentElement) {
                console.warn('GridDetector [orphan-aria]: grid container resolved to document root; aborting.');
                return null;
            }

            // Use a Set for O(1) membership checks instead of O(n) Array.includes().
            const selectedRowSet = new Set(selectedRows);
            const headerRows = Array.from(gridContainer.querySelectorAll('[role="row"]')).filter(row =>
                row.querySelector('[role="columnheader"]') &&
                !selectedRowSet.has(row) &&
                !row.closest(this._GRID_SEL)
            );

            const colCount = selectedRows.reduce((max, row) =>
                Math.max(max, row.querySelectorAll(this._CELL_SEL).length), 0
            );
            if (colCount === 0) return null;

            const newTable = document.createElement('table');
            const thead = document.createElement('thead');
            const tbody = document.createElement('tbody');

            for (const row of headerRows) {
                const cells = row.querySelectorAll(this._CELL_SEL);
                const tr = document.createElement('tr');
                for (let c = 0; c < Math.min(cells.length, colCount); c++) {
                    const th = document.createElement('th');
                    // Databricks sets aria-label on columnheader cells; prefer it over
                    // textContent which includes icon SVG text.
                    th.textContent = (cells[c].getAttribute('aria-label') || cells[c].textContent).trim();
                    tr.appendChild(th);
                }
                thead.appendChild(tr);
            }

            for (const row of selectedRows) {
                const cells = row.querySelectorAll(this._CELL_SEL);
                const tr = document.createElement('tr');
                for (let c = 0; c < Math.min(cells.length, colCount); c++) {
                    const td = document.createElement('td');
                    td.textContent = cells[c].textContent.trim();
                    tr.appendChild(td);
                }
                tbody.appendChild(tr);
            }

            if (!thead.hasChildNodes() && tbody.firstChild) {
                const firstDataRow = tbody.firstChild;
                const headerTr = document.createElement('tr');
                Array.from(firstDataRow.cells).forEach(cell => {
                    const th = document.createElement('th');
                    th.textContent = cell.textContent.trim();
                    headerTr.appendChild(th);
                });
                thead.appendChild(headerTr);
                firstDataRow.remove();
            }

            if (thead.hasChildNodes()) newTable.appendChild(thead);
            if (tbody.hasChildNodes()) newTable.appendChild(tbody);

            console.log(`GridDetector [orphan-aria]: ${selectedRows.length} data rows, ${headerRows.length} header rows, ${colCount} cols`);
            return { type: 'orphan-aria', tables: [newTable] };
            } finally {
                this._cachedOrphanRows = null; // always clear cache, even on error
            }
        }
    };

    // ---------------------------------------------------------------------------
    // Strategy 4: Heuristic Div Grid (no ARIA roles — e.g. Google Finance Beta)
    // Detection approach (not yet implemented):
    //   • The selection's common ancestor container has display:grid or display:flex
    //     with more than one column (inspectable via getComputedStyle).
    //   • All direct children of that container share the same element type and
    //     each contain the same number of child elements (label + value pairs).
    //   • The clipboard text/plain is a flat run-on string with no tabs or newlines,
    //     alternating between short label strings and short value strings.
    // ---------------------------------------------------------------------------

    const HeuristicDivStrategy = {
        canHandle(_selection) {
            return false; // placeholder — not yet implemented
        },

        extract(_selection) {
            return null; // placeholder
        }
    };

    // ---------------------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------------------

    global.GridDetector = {
        _strategies: [NativeTableStrategy, AriaGridStrategy, OrphanAriaRowStrategy, HeuristicDivStrategy],

        /**
         * Tries each strategy in priority order and returns the first match.
         *
         * @param {Selection} selection  The current window.getSelection() object.
         * @returns {{ type: 'native'|'aria'|'orphan-aria'|'heuristic-WIP', tables: HTMLTableElement[] } | null}
         *   'native'       — standard <table> elements
         *   'aria'         — divs/spans with a wrapping role="grid/table/treegrid"
         *   'orphan-aria'  — role="row" cells with no wrapping grid root (e.g. Databricks)
         *   'heuristic-WIP'— repeating sibling-div patterns; not yet implemented (always null)
         */
        extract(selection) {
            if (!selection || selection.rangeCount === 0) return null;
            for (const strategy of this._strategies) {
                if (strategy.canHandle(selection)) {
                    const result = strategy.extract(selection);
                    if (result) return result;
                }
            }
            return null;
        }
    };

})(typeof window !== 'undefined' ? window : globalThis);
