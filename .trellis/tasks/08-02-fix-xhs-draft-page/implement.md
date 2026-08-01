# Implementation Plan

1. Add an exact `上传图文` content-type transition helper in `automation/src/xhs-draft.js`; fail safely if the target is missing or ambiguous.
2. Change upload readiness to wait for an image-accepting file input rather than the first file input, so the default video input is never selected.
3. Preserve error ordering by checking human-verification signals after readiness failures, then emit the existing recoverable `page_changed` error when appropriate.
4. Revalidate the creator URL after the content-type transition and before uploading.
5. Add focused unit tests for the exact action allowlist, video-input exclusion, delayed image attachment, and timeout behavior.
6. Keep `HOME=/tmp` in the shared Compose runtime so both login and daily draft execution inherit it.
7. Run the Node tests, lint, Compose config validation, and a source scan for forbidden publish/private-endpoint behaviors.
8. Review the diff for secrets, generated screenshots, or unrelated dirty-worktree files before committing only task-owned changes.

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
