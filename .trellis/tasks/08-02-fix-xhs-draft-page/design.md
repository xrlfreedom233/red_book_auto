# Technical Design

## Boundaries

The change stays inside the existing browser-draft adapter and shared Compose runtime. It does not alter pipeline stage ordering, state schema, model generation, DingTalk, or the manual-publish boundary.

## Browser Readiness

After navigation and creator-host validation, the adapter waits for the first file input to reach Playwright's `attached` state. Hidden file inputs are valid upload controls, so visibility is not required. The wait uses the configured request timeout.

If attachment times out, the adapter re-checks the existing human-verification signals before classifying the result. A challenge therefore remains `human_verification`; an otherwise loaded but incompatible page remains recoverable `page_changed`. The normal outer failure handler captures the redacted screenshot in both cases.

No click is added before upload. This preserves the contract that the only automated button click is the exact save-draft action. Direct navigation remains pinned to `https://creator.xiaohongshu.com`.

## Container Runtime

Set `HOME=/tmp` in the shared `x-runtime.environment`. `/tmp` is already an isolated writable tmpfs while the container root remains read-only. Both `daily` and `login` inherit the setting, and the persistent browser session remains explicitly stored under `/data/browser-profile` through `launchPersistentContext`.

## Test Strategy

Extract and export a small upload-readiness helper with dependency behavior represented by a Playwright-like locator. Unit tests cover delayed successful attachment and timeout classification without external navigation. Existing source-level safety tests continue to enforce the one-button-action rule and forbidden private-browser behaviors. Compose rendering verifies the runtime setting.

## Rollback

Revert the helper call to the prior immediate locator check and remove `HOME` from the shared environment. No state or data migration is involved. Existing persistent profiles and generated episodes remain compatible.
