# Table Selection Support: Structural Integrity & Grid Reconstruction

## Overview
This development cycle addressed a critical issue where partial user highlights of tables resulted in malformed or "jagged" Markdown output. The primary goal was to ensure that if a user selects a subset of a table, the resulting Markdown preserves the original grid structure (column alignment) by padding unselected areas with empty cells.

## Problem Statement
When a user selects part of a table (e.g., starting from the 2nd column of the 1st row and ending at the 3rd column of the 3rd row), the browser's native `text/html` clipboard payload only includes the highlighted cells. 

**Native Browser Copy Result:**
Row 1: [Cell 2, Cell 3, Cell 4] (3 columns)
Row 2: [Cell 1, Cell 2, Cell 3, Cell 4] (4 columns)

This "jagged" structure causes Markdown table renderers to misalign columns, as they expect a consistent number of pipes (`|`) per row.

## Implementation Details

### 1. The Bounding Box Strategy
Instead of relying solely on the clipboard's potentially malformed HTML, the extension now performs a **Pre-Copy DOM Analysis**:
- **Intersection Detection:** Using `Range.intersectsNode()`, the script identifies which specific `<td>` or `<th>` elements are touched by the user's selection.
- **Bounding Box Calculation:** It determines the `minRow`, `maxRow`, `minCol`, and `maxCol` index of all selected cells within a table.
- **Structural Reconstruction:** A new, perfectly rectangular `<table>` is built in memory. 
    - If a cell within the bounding box is selected, its contents are cloned.
    - If a cell is within the bounding box but *not* selected (e.g., a "hole" in the highlight), an empty `<td></td>` is injected to maintain alignment.

### 2. ARIA and Pseudo-Table Support
To handle modern web applications that avoid native `<table>` tags, the logic was extended to support ARIA-defined grids.

#### Support Matrix
| Grid Type | Mechanism | Status |
| :--- | :--- | :--- |
| **Native Table** | `<table>`, `<tr>`, `<td>` tags | **Fully Supported** |
| **ARIA Grid** | `role="grid"`, `role="row"`, `role="cell"` | **Supported** (via structured reconstruction) |
| **Pseudo-Table** | Nested `<div>`s with custom classes (e.g., Google Finance Beta) | **Partial** (Relies on plain-text fallback or future heuristics) |

## Technical Challenges Overcome

### Cross-Document Node Adoption
When reconstructing tables using `DOMParser`, nodes cloned from the live document must be explicitly adopted into the parser's document.
- **Fix:** Implemented `doc.adoptNode(clone)` to prevent "Wrong Document" errors during the HTML-to-Markdown conversion phase.

### Stale Clipboard Verification
The extension includes a safety check to ensure the clipboard content matches the user's selection. Partial table selections often cause this check to fail because the clipboard's plain-text representation (linear) starts at a different point than the user's visual highlight.
- **Fix:** Loosened the verification threshold for table-based copies (requiring 1 word match instead of 3) and expanded the search window to the full clipboard payload.

### Safety Guards (Layout Tables)
To avoid accidentally replacing complex layout tables or hidden structural elements in apps like Google Docs:
- **Guard:** The extension only replaces tables if the count of extracted DOM tables exactly matches the count of tables in the clipboard HTML.
- **Sanity Check:** Added a column-count threshold (2x) to ensure the DOM table and clipboard table have reasonably similar dimensions before replacement.

## Future Work
- **Heuristic Grid Detection:** For sites like Google Finance Beta that use custom class-based div grids without ARIA roles, implement a sibling-pattern detector to manually "re-grid" the data.
- **Colspan/Rowspan Mapping:** Improve the coordinate system to account for merged cells, which currently diverge from simple index-based `row.cells[c]` mapping.
