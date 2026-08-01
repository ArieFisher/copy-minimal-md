# Plan: restore line breaks lost from div-based pages

Status: agreed in discussion, not yet implemented. Do the steps in this order.

## Problem

The DOMPurify allowlists (`pipeline.js` and `equivalents.js`, `ALLOWED_TAGS`)
omit `div` and the other generic block containers. DOMPurify unwraps a
disallowed tag and splices its children inline, so on a div-based prose page
(e.g. Google News) every block boundary is erased before Turndown runs.
Turndown itself already treats `div`, `figure`, `section`, etc. as block
elements and would emit the line breaks unaided — the loss happens entirely
in the sanitize step.

## Steps

1. **Regression fixture first, before any code change.** Build it from the
   Google News payload in the issue (a fully div-based prose page — the
   existing fixtures are all table-shaped and would not catch this). Assert
   the Markdown keeps line breaks between the blocks. It should fail against
   the current code.

2. **Pin the table invariant with a test.** One fixture containing both a
   table with divs inside cells and prose divs outside the table, asserting:
   cell contents stay on one line, prose gets line breaks. This is what makes
   step 3 safe: after the allowlist change, the td-div → span repair
   (`pipeline.js`, `inlineCellDivs` in `equivalents.js`) is the guard that
   keeps block breaks out of table cells, and this test is what stops anyone
   deleting or reordering that repair without noticing.

3. **Allowlist the block containers** — `div`, `section`, `article`,
   `figure`, `figcaption`, `header`, `footer`, `main`, `aside` — in **both**
   `ALLOWED_TAGS` lists (`pipeline.js` and `equivalents.js`; they are
   duplicated and must stay in sync). Turndown has no syntax for these tags,
   so they never appear in the Markdown output — they only contribute the
   paragraph breaks.

4. **Upgrade the repair comments.** The td-div repair's comment currently
   reads as a Google Sheets nicety. Rewrite it to say what it now is: divs
   inside cells must be inlined *before* sanitize, because with `div`
   allowlisted this repair is what keeps block breaks out of table cells.

5. **Simple HTML: accept the bare divs (option 1).** With `div` allowlisted,
   `toSimpleHtml` output contains attribute-free nested `<div>` wrappers.
   Accept that for now — it is what preserves breaks on paste, and it keeps
   the two outputs derived from one shared document. Revisit flattening
   (unwrap scaffolding divs whose children are all block-level) only if the
   output bothers in practice; if implemented, it belongs as a post-pass on
   the sanitized tree, alongside `simplifyTables` — see the pre/post
   comparison in the discussion.
