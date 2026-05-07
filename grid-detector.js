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
 * Returns true if `node` intersects any range in `selection`.
 */
function _intersectsSelection(node, selection) {
    for (let i = 0; i < selection.rangeCount; i++) {
        if (selection.getRangeAt(i).intersectsNode(node)) return true;
    }
    return false;
}

function _log(msg) {
    console.log(`GridDetector Trace: ${msg}`);
}

// ---------------------------------------------------------------------------
// Strategy 1: Native <table> elements
// ---------------------------------------------------------------------------

const NativeTableStrategy = {
    canHandle(selection) {
        _log("Checking NativeTableStrategy...");
        const tables = document.querySelectorAll('table');
        for (const t of tables) {
            if (_intersectsSelection(t, selection)) {
                _log(`Found intersecting native <table>: ${t.id || t.className || 'unnamed'}`);
                return true;
            }
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

            _log(`[native] Identified table range: rows ${minRow}–${maxRow}, cols ${minCol}–${maxCol}`);
            return newTable;
        }).filter(Boolean);

        return resultTables.length > 0 ? { type: 'native', tables: resultTables } : null;
    }
};

// ---------------------------------------------------------------------------
// Strategy 2: ARIA Grid (role="grid" / "table" / "treegrid")
//
// Also handles "hybrid" DOMs where the ARIA root contains native <tr>/<td>/<th>
// elements without explicit role="row"/role="cell" attributes. The browser
// treats these as implicit row/cell roles; we match them the same way.
// ---------------------------------------------------------------------------

const AriaGridStrategy = {
    canHandle(selection) {
        _log("Checking AriaGridStrategy...");
        const roots = document.querySelectorAll('[role="table"], [role="grid"], [role="treegrid"]');
        for (const t of roots) {
            if (_intersectsSelection(t, selection)) {
                _log(`Found intersecting ARIA grid: role="${t.getAttribute('role')}"`);
                return true;
            }
        }
        return false;
    },

    extract(selection) {
        const ARIA_CELL_ROLES = '[role="cell"], [role="gridcell"], [role="columnheader"], [role="rowheader"]';
        const roots = document.querySelectorAll('[role="table"], [role="grid"], [role="treegrid"]');

        for (const root of roots) {
            if (!_intersectsSelection(root, selection)) continue;

            // Match explicit ARIA rows AND native <tr> elements.  Filter out
            // <tr>s that live inside a native <table> — those belong to
            // NativeTableStrategy (e.g. hidden chart-accessibility tables).
            const ariaRows = Array.from(
                root.querySelectorAll('[role="row"], tr')
            ).filter(el => {
                if (el.tagName !== 'TR') return true;
                const t = el.closest('table');
                // Discard TRs that belong to a nested table *inside* the ARIA root.
                // Keep TRs that belong directly to the ARIA root (or to an ancestor layout table).
                return !t || !root.contains(t) || t === root;
            });

            let minRow = Infinity, maxRow = -1, minCol = Infinity, maxCol = -1;

            for (let r = 0; r < ariaRows.length; r++) {
                // For native <tr>, use .cells (direct <td>/<th> children only).
                // For ARIA rows, query by role attribute.
                const ariaCells = ariaRows[r].tagName === 'TR'
                    ? ariaRows[r].cells
                    : ariaRows[r].querySelectorAll(ARIA_CELL_ROLES);
                // TODO: Revisit <td colspan="2">. Currently spans are ignored and treated as single cells.
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
                const ariaCells = ariaRow.tagName === 'TR'
                    ? ariaRow.cells
                    : ariaRow.querySelectorAll(ARIA_CELL_ROLES);
                const tr = document.createElement('tr');
                let isHeaderRow = false;

                for (let c = minCol; c <= maxCol; c++) {
                    const ariaCell = ariaCells[c];
                    const isSelected = ariaCell && _intersectsSelection(ariaCell, selection);
                    const isHeader = ariaCell && (
                        ariaCell.getAttribute('role') === 'columnheader' ||
                        ariaCell.tagName === 'TH'
                    );
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

            _log(`[aria] Reconstructed table range: rows ${minRow}–${maxRow}, cols ${minCol}–${maxCol}`);
            return { type: 'aria', tables: [newTable] };
        }

        return null;
    }
};

// ---------------------------------------------------------------------------
// Strategy 3: Heuristic Div Grid (no ARIA roles — e.g. Google Finance Beta)
// ---------------------------------------------------------------------------
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
    _strategies: [NativeTableStrategy, AriaGridStrategy, HeuristicDivStrategy],

    /**
     * Tries each strategy in priority order and returns the first match.
     *
     * @param {Selection} selection  The current window.getSelection() object.
     * @returns {{ type: 'native'|'aria'|'heuristic', tables: HTMLTableElement[] } | null}
     */
    extract(selection) {
        if (!selection || selection.rangeCount === 0) {
            _log("Abort: No selection or rangeCount is 0.");
            return null;
        }
        _log("Starting grid extraction...");
        for (const strategy of this._strategies) {
            if (strategy.canHandle(selection)) {
                const result = strategy.extract(selection);
                if (result) {
                    _log(`Match found using strategy: ${result.type}`);
                    return result;
                }
            }
        }
        _log("No grid strategies matched the current selection.");
        return null;
    }
};

})(typeof window !== 'undefined' ? window : globalThis);
