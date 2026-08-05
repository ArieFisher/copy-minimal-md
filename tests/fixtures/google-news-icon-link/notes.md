# Google News headline card, icon-only link

**Reported:** 2026-08-05.

**Source:** a captured `text/html` clipboard payload from a Google News
headline card (news.google.com). Trimmed of nothing; this is the payload as
copied.

**Observed:** the card's "see more headlines & perspectives" control reaches
both outputs as a link with no text — `[](https://news.google.com/stories/…)`
in the Markdown, `<a href="…"></a>` in the Simple HTML. Neither shows anything
on screen, so a URL sits in the output with nothing to click and no way to
tell it apart from a copy that lost something.

**Cause:** the control is an `<a>` whose only content is an inline `<svg>`
icon. `svg` is not in `ALLOWED_TAGS` (`pipeline.js`, `equivalents.js`), and
DOMPurify does not unwrap an SVG element the way it unwraps a disallowed HTML
tag — it removes the element and everything inside it. The anchor survives;
its contents do not.

**Expected:** the link is named from what the source already says about it —
`alt`, else `aria-label`, else `title`, else `image…` — so nothing invisible
reaches either output.
