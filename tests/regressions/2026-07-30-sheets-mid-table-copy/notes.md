# Google Sheets copy taken from the middle of a table

**Reported:** 2026-07-30, from the Clipboard Inspector.

**Source:** a two-row, two-column drag out of the middle of a Google Sheet. The
selection does not include the sheet's header row, so every cell in the
clipboard payload is a `<td>` and the table carries no `<thead>`.

**Observed:** the derived Simple HTML wrapped the copy in `<thead>`/`<tbody>`
and rewrote the first row as `<th>` cells. That says the copy had a header row
when it did not — the first row is ordinary data that happened to be selected
first, and pasting that HTML propagates the false claim.

**Expected:** Simple HTML mirrors the copy — rows straight under `<table>`, all
`<td>`, no `<thead>`/`<tbody>`.

**Markdown is unaffected and stays as it was.** GFM has no table syntax without
a header row, so the first row is still promoted there; that promotion is now
confined to the Markdown pass instead of being baked into the shared document
both equivalents were serialized from.
