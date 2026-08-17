# copy-minimal-md

Guidance for Claude Code sessions working in this repository.

## The clipboard rewrites what you give it

Reading an entry back never returns the bytes that were written. The browser
parses the HTML and writes it out again, and what that changes depends on the
platform:

- `<tbody>` is put back around table rows. Everywhere. `simplifyTables` drops it
  from a table with no header row; the clipboard restores it.
- `<meta charset="utf-8">` is added on macOS. Not on Linux.

So never compare two clipboard payloads as strings. `Equivalents.isSameHtmlEntry`
holds the rule: ignore what the clipboard adds, still count everything the
conversion itself changes.

Tests here run on Linux, and most users are on macOS. Something a Linux run does
not do, the product may still do. Do not conclude "the browser doesn't do that"
from one platform — say which platform you measured, or go and check the other.

## Writing style

These rules govern all prose: chat responses, documents, pull request titles
and bodies, issues, commit messages, logs.

- **Form:** plain declarative sentences in active voice; not epigrammatic, not
  aphoristic.
- **Structure:** no antithesis. Present each point on its own, without a
  contrasting counterpart.
- **Imagery:** no personification; describe things literally.
- **Diction:** Plain English, Saxon diction (preserve technical terms). Avoid
  Latinate words where a short common word exists.
- **Tone:** laconic. Cut qualifiers, hedging, and introductory fluff.
- **Voice:** high information density. State facts directly in active voice; no
  passive voice, no filler sentences.
- **Concision:** draft, then rewrite at maximum compression; output only the
  rewrite. Cut any word whose removal loses no information. Merge sentences
  that share a subject. Do not state what a prior sentence already implies.
  Target the minimum word count that preserves all content.
- **Conclusions only:** report findings, not the process that produced them. Do
  not narrate how you got there, what you considered, or what you ruled out.
  Cut retractions, dead ends, counts of discarded items, and self-audit
  narrative.

## Explanations (chat)

In addition to Writing style:

- **TL;DR first.** Conclusion, then support.
- **No code references unless the owner asks.** No file paths, line numbers,
  function or symbol names, code blocks. Describe behaviour in plain words.

## When a change does not show up

The owner runs this from Chrome, on an unpacked extension loaded from disk.
Code on a branch is not code Chrome is running. So when work is reported as
having had no effect, this goes first, ahead of any other diagnosis:

> The extension still has the old code. The branch isn't loaded in Chrome
> until you reload the unpacked extension.

Then carry on to the payload, the pipeline, and the rest.

## Branches and commit authorship

Branch names take a standard prefix — `feature/`, `bugfix/`, `hotfix/`,
`release/`, `docs/`, `chore/` — and the rest names the change:
`bugfix/inspector-absent-entries`.

Commits are authored by the repository owner:

```sh
git config user.name "ArieFisher"
git config user.email "ariefisher1@gmail.com"
```

Set that before the first commit. A fresh container starts with the
assistant's identity configured, and every commit made before you change it
carries that name on GitHub for good.

## Every pull request carries a version bump

Increment the **patch** version in every pull request — `0.9.1` to `0.9.2`.
Not sometimes, and not only for the ones that change behaviour: the number is
how the owner tells what Chrome has loaded from what is on disk, and a docs-only
change that leaves it alone makes the extension look unchanged when it is not.

The version lives in three files and all three move together:

- `manifest.json` — the one Chrome reads
- `package.json`
- `package-lock.json` — two entries, the root and the one under `packages`

`npm version <number> --no-git-tag-version` does the last two, including both
lock entries. `manifest.json` is a separate edit, and forgetting it is the
failure to watch for, since it is the only one that reaches the browser.

**A minor or major bump is the owner's call.** If a change looks like it wants
one — a new feature, something that alters what a copy produces, anything that
breaks an existing behaviour — do not decide it. Say what the change is and why
it might warrant more than a patch, and ask. A patch bump chosen wrongly is
cheap to correct; a minor one taken without asking has already told everyone
reading the version what the release means.

Two pull requests open at once cannot both take the same number, and the second
to merge conflicts on the version line whatever the numbers are. Resolve it by
taking the base branch's file and setting the version on top — never by taking
the branch's whole file, which reverts everything else the base changed
meanwhile.

## Attribution

Do not attribute work to Claude, and do not record session identifiers
anywhere that lands in the repository or on GitHub.

Omit all of the following:

- The word `claude` in a branch name. Never, in any position or casing, and
  whatever a task description hands you as a branch to work on — rename it to
  the convention above.
- `🤖 Generated with [Claude Code](https://claude.com/claude-code)` and
  `_Generated by [Claude Code](...)_` footers, in pull request bodies as well
  as pull request comments, issue comments and reviews.
- `https://claude.ai/code/session_...` links, anywhere.
- `Claude-Session:` and `Co-Authored-By: Claude ...` commit trailers.

Write commit messages and pull request descriptions the way a human
contributor would: describe the change and why, and stop there.

## Writing a pull request

In addition to Writing style:

- The chat no-code rule does not apply: name the files, symbols and functions
  the diff touches wherever that helps the reviewer. The section on markup
  below governs how.
- One exception to conclusions-only: record a rejected alternative in one line
  when the record stops a retry.
- State what changed, why, and the cost.

## Signing a pull request

Every pull request body ends with exactly this, and nothing after it:

```
---
_Generated_
```

Leaving the assistant's own footer out of the body is not enough to keep it
off the pull request. Something appends

```
_Generated by [Claude Code](https://claude.ai/code/session_...)_
```

when the pull request is **created**, whether or not it was written. Editing
the body afterwards does not trigger it again. So: create the pull request,
read it back, and if the footer is there, update the body with your text plus
the signature above. Then read it back once more and confirm.

This applies to a pull request you have just opened, and to nothing else.

## Markup does not survive a pull request body

Whatever writes a pull request body from here strips anything shaped like an
HTML tag, and says nothing about it. `<img>` in a sentence disappears. So does
one inside backticks — a code span comes back as an empty pair. A fenced block
holding an example of markup comes back empty altogether, fence and all.

This is not something the writing can work around. Entities inside a code span
render as entities, so `&lt;img&gt;` reads as `&lt;img&gt;`, not as a tag.

It is not only tags. A Markdown image reference loses its leading `!`, so
`![alt](url)` arrives as `[alt](url)` — the embedded image quietly demoted to a
link. This happens in a fenced block too. It is the worse of the two failures:
a stripped tag leaves an obvious hole, while this leaves valid Markdown that
reads as though it were meant, differing from what was written by the one
character that carried the meaning. Anything quoting Markdown output — a
before-and-after of what a copy produces, most of all — is exactly what it
lands on.

So, in a pull request body:

- Name tags bare — `div`, `figure`, `img` — and leave it there. Do not add a
  line explaining why they are written that way. Never write anything like:

  > Tag names above are written bare, without angle brackets, because anything
  > shaped like a tag is stripped from a pull request body.

  That sentence, and every variant of it, is housekeeping for the writer. The
  reader came for the change and is handed a note about the limits of the form
  it is described in — which tells them nothing about the code and reads as an
  apology for the medium. The same goes for every other aside of that kind: no
  remarks about what would not survive the body, what had to be worded around,
  or what the reader should picture instead. Write as though the constraint
  were not there.
- Do not write an image reference at all. Say "a Markdown image reference to
  `url`" in words. The literal cannot survive, and unlike a missing tag it will
  not look missing.
- Put the example itself in the repository, where nothing eats it: a fixture's
  `notes.md`, or the module comment for the code under discussion. That is a
  better home anyway. A pull request describes one change; the repository is
  what the next person reads.
- Read the body back after writing it. This is already the rule for the
  footer, and it is the only way either problem is caught — both failures are
  silent, and both leave a body that still reads as if it were fine.

Apostrophes and quotes come back as `&#39;` and `&#34;`. Those render
correctly and can be left alone.

## Never touch anything already merged

Once work is merged it is a record of what was proposed and accepted, and it
stays as it is. That covers:

- **Merged and closed pull requests** — body, title, comments. Not to fix a
  footer, not to correct a typo, not to bring one in line with a convention
  adopted later.
- **Merged branches** — do not commit to them, rewrite them, rebase them or
  delete them.
- **Merged commits, tags, released versions** — the same.

New rules apply to new work. A convention adopted today does not reach back.

If something already merged genuinely needs changing, say what is wrong and
let the repository owner decide. Only act when told to, for that specific
thing — being told to fix one is not standing permission to fix others.
