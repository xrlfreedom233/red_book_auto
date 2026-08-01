# Implementation Plan

1. Add an upload-control readiness helper in `automation/src/xhs-draft.js` that waits for the first file input to be attached within `REQUEST_TIMEOUT_MS`.
2. Preserve error ordering by checking human-verification signals after a readiness timeout, then emit the existing recoverable `page_changed` error when appropriate.
3. Replace the immediate upload-control count/visibility check in `saveDraft` with the readiness helper; do not add any publish or entry-button click.
4. Add focused unit tests for delayed attachment and timeout behavior while retaining all existing safety assertions.
5. Add `HOME=/tmp` to the shared Compose runtime so both login and daily draft execution inherit it.
6. Run the Node tests, lint, Compose config validation, and a source scan for forbidden publish/private-endpoint behaviors.
7. Review the diff for secrets, generated screenshots, or unrelated dirty-worktree files before committing only task-owned changes.

## Validation Commands

```bash
npm --prefix content/yi-er-bubu/automation test
npm --prefix content/yi-er-bubu/automation run lint
docker compose --env-file content/yi-er-bubu/deploy/server.env.example -f content/yi-er-bubu/deploy/compose.yaml config
rg -n 'getByRole\("button"|route\(|request\.post|context\.cookies|document\.cookie' content/yi-er-bubu/automation/src/xhs-draft.js
```

## Risk and Rollback Points

- A wait that is too broad could hide login/challenge pages until timeout; re-check verification indicators before page-change classification.
- A visible-only wait would reject valid hidden file inputs; require `attached`, not `visible`.
- Do not broaden navigation hosts or add any action containing the publish concept.
- Compose must retain `read_only`, tmpfs, no-new-privileges, and loopback-only noVNC exposure.
