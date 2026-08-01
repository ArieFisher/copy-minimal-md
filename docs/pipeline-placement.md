# Where a transformation belongs in the pipeline

Every conversion here is one pipeline with a fork in it: the repairs run on a
single shared document, then the path splits into a Markdown branch and a
Simple HTML branch, and each branch sanitizes its own copy and produces its
output. That shape gives a new transformation three possible homes, and the
placement is a design decision, not a convenience. The governing rule:

> **A transformation lives where the thing it fixes exists — in the richest
> representation that still contains the defect.**

## Tier 1 — before the fork, on the shared document

Ask: *must both outputs agree on this?*

Anything that changes what the copy **is** — its cells, its structure, its
content — goes here, because the two outputs are two renditions of one copy
and cannot be allowed to describe different things. If only one branch got a
jagged-table repair, the Markdown would report a different table than the
Simple HTML.

Residents: the source repairs (`inlineCellDivs`, `unwrapGoogleDocsBold`,
`reconstructAriaTables`), the grid repairs (`applyGridRepairs`).

## Tier 2 — after the fork, before the maker, on that branch's document

Ask: *is this structural, but the business of one output only?*

Still a DOM, so structural work is cheap and safe — but the change reaches a
single output. The header promotion lives here because GFM cannot write a
table without a header row while Simple HTML is under no such constraint;
promoting on the shared document would force Markdown's invention onto the
Simple HTML.

Residents: `promoteImplicitHeaders` (Markdown branch only), `simplifyTables`
(Simple HTML branch only; its comment explains why it must also run after
sanitize — every parse re-inserts `<tbody>`, so dropping it earlier just sees
it come back).

## Tier 3 — after the maker, on the output string

Ask: *is this a defect the maker itself created, in its own output syntax?*

By now the document is gone; only flat text remains. A defect that is *born*
in conversion — like the stray whitespace Turndown leaves inside link text —
does not exist in any DOM and can only be fixed here.

Resident: the link-whitespace regex after `turndown()`.

Use this tier last and keep it small. A string pass cannot tell content from
syntax — a regex over Markdown will match anything bracket-shaped, whether
Turndown wrote it or the user copied it. If the defect existed before the
maker ran, it belongs in tier 1 or 2, where a tree can be queried instead of
text pattern-matched. "Fix the output afterwards" applied to a tier-1 defect
is how a pipeline grows fragile.

## Content vs. spelling, the underlying distinction

Two payloads can differ as strings yet be the same thing — `<table><tr>` and
`<table><tbody><tr>` are two spellings of one table. A change to *content*
(what any reader of either output would see) must happen in tier 1. A change
to *spelling* (which markup writes down the unchanged thing) belongs in
tier 2 or 3, private to the output that prefers that spelling.
`Equivalents.isSameHtmlEntry` is this distinction applied in reverse: it
compares clipboard entries as parsed things, not strings, so a respelling by
the browser is not mistaken for a real difference.
