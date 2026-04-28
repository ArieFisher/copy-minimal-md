---
trigger: always_on
---

# Git Workflow

1. **Only make changes on feature branches.** Never edit files directly on `main`.

2. **If no feature branch exists, create one before editing any files.**

3. **Before creating a feature branch, refresh `main` and prune stale local branches.**
   Requires a clean working tree — commit or stash any in-progress work first; this
   workflow refuses to touch `main` with a dirty index.

   ```bash
   git checkout main
   git pull --prune --ff-only origin main

   # Delete local branches whose upstream was removed on origin.
   # -D (force) is used because GitHub's squash-merge leaves branches looking
   # "unmerged" locally even though their PR shipped; the ": gone]" marker
   # is the trustworthy signal they're done.
   git for-each-ref --format='%(refname:short) %(upstream:track)' refs/heads/ \
     | awk '$2 == "[gone]" {print $1}' \
     | xargs -r git branch -D
   ```

4. **"Commit all changes" command.** When the USER says to 'commit all changes', first stage all unstaged changes (`git add .`) and then commit them. If on `main`, create a feature branch first to adhere to rule #1.
