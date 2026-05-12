# synthetic-aria-grid

Seed fixture representing the canonical ARIA grid pattern used by the W3C APG, Adobe React Aria, MUI X DataGrid, CodePen demos, and Observable data tables: `role="grid"` with `role="row"` containing `role="columnheader"` / `role="gridcell"`.

This fixture pins the **current** GridDetector + content.js pipeline output for an ARIA grid where no `text/html` clipboard payload exists (the common case for div-based grids).

Pinned behavior: the ARIA grid is reconstructed as a native `<table>` and Turndown emits a GFM Markdown table.

When `npm run capture:fixtures` is run with network access, it will populate `2026-05-12-w3c-apg-grid`, `2026-05-12-react-aria-table`, etc. with real DOM captures. This synthetic fixture can stay as a deterministic baseline.
