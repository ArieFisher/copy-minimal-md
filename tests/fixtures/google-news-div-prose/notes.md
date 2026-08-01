# Google News headline card, div-based prose

**Reported:** 2026-08-01.

**Source:** a captured `text/html` clipboard payload from a Google News
headline card (news.google.com) — a div-based prose layout with no `<table>`
anywhere. Trimmed of nothing; this is the payload as copied.

**Observed:** `htmlToMarkdown` glues the source name, the headline link, the
timestamp and the byline onto a single paragraph line, separated only by
whatever inline whitespace happened to sit between the original elements —
in the worst case, nothing at all.

**Cause:** DOMPurify's `ALLOWED_TAGS` (`pipeline.js`, `equivalents.js`) has no
entry for `div` or the other generic block containers (`section`, `article`,
`figure`, `header`, `footer`, `main`, `aside`). DOMPurify does not drop a
disallowed tag — it unwraps it and splices its children into the parent — so
every div boundary in this fixture disappears before Turndown ever sees the
document. Turndown itself already treats `div` (and the rest) as block
elements and emits `\n\n` around them; the loss happens entirely in sanitize.

**Expected:** the source, headline, timestamp and byline each land on their
own line.
