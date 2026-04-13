---
trigger: always_on
---

1. Only make changes to feature branches. 

2. If no feature branch exists, create one before editing any files.

3. Before creating a feature branch, always run the following to (a) resync from the remote main before starting work, and, (b) remove references to remote branches that have been merged and deleted.

   ```bash
   git checkout main
   git pull origin main
   git fetch --prune
   ```

4. Before creating a new feature branch, delete any local branches that no longer exist on remote:
   ```bash
git fetch --prune
git branch -vv | grep ': gone]' | awk '{print $1}' | xargs git branch -d
   ```