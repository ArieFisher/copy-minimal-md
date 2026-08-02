# Google News headline card — wrapper divs left behind by sanitize

**Reported:** 2026-08-02, from a copy of a Google News headline card.

**Observed.** The Simple HTML carried a chain of divs around nothing:

```html
<div>
  <div>
    <div>
      <div></div>
      <div></div>
    </div>
  </div>
</div>
```

**Why.** These are not empty in the copy. That chain is Google's "More" menu:
five divs around a `<button>`. `button` is not in `ALLOWED_TAGS`, so sanitize
drops it — and only then is the chain a set of wrappers around nothing.
Allowlisting `div` (commit `7523fb7`) is what let the wrappers survive to be
seen; before that, sanitize unwrapped them along with everything else.

The consequence is that a collapse pass cannot run on the shared repaired
document, where those divs still look occupied. It has to run after sanitize,
on each branch — which is where `collapseContainers` sits.

**Expected.** The wrappers go. What holds content stays, including the
`<figure>`, which has no text of its own but carries the article thumbnail.
Two divs remain around the headline block and both are load-bearing: the outer
holds the header row *and* the `<figure>`, the inner holds the header row *and*
the headline link.

**Known cosmetic leftover.** `<div>7 hours ago\n  <hr>` keeps the source's
newline and indent before the `<hr>`. That whitespace is inside a text node
that also carries content, and `dropDeadWhitespace` only removes text nodes
that are whitespace throughout — trimming inside a mixed node would put the
pass in the business of editing content, next door to the intra-cell `<br>`
rule it must not disturb. It renders as nothing.

**Input.** Taken from the inspector's Source pane, so it arrives pretty-printed
rather than as the single line the clipboard actually holds. That makes it the
harder case: every wrapper removed leaves indentation behind, which is what
`dropDeadWhitespace` is for.
