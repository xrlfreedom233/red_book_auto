# Technical Design

## Boundaries

The change stays inside the existing browser-draft adapter and shared Compose runtime. It does not alter pipeline stage ordering, state schema, model generation, DingTalk, or the manual-publish boundary.

## Browser Readiness

After navigation and creator-host validation, the adapter enumerates exact text targets named `上传图文`. The creator currently renders three duplicate `SPAN.title` nodes, so DOM count and visibility are insufficient. Playwright trial clicks identify candidates that are visible, stable, enabled, and able to receive pointer events without performing the action. The adapter clicks only when exactly one candidate is actionable. It then waits for a file input whose `accept` attribute explicitly includes an image MIME type or supported image extension to reach Playwright's `attached` state. Hidden file inputs are valid upload controls, so visibility is not required. The waits use the configured request timeout, with each non-mutating trial bounded to three seconds.

If attachment times out, the adapter re-checks the existing human-verification signals before classifying the result. A challenge therefore remains `human_verification`; an otherwise loaded but incompatible page remains recoverable `page_changed`. The normal outer failure handler captures the redacted screenshot in both cases.

The body editor is selected through the observed unique `div.tiptap.ProseMirror[contenteditable="true"][role="textbox"]` contract; the visible placeholder is not an element attribute. Hashtags leave the topic-suggestion overlay active after programmatic fill, so one `Escape` keypress dismisses that non-draft overlay before actionability checks. The bottom action region appears in the full-page failure screenshot but not in the pre-screenshot text lookup, indicating scroll-dependent rendering; the adapter scrolls to the document bottom without clicking before resolving the action. The `暂存离开` control is not exposed as an ARIA button, so both approved actions reuse the exact-text plus unique-actionability mechanism. Safe failure messages include only exact-target and actionable counts. The click allowlist contains only `上传图文` and the exact white draft action `暂存离开`. It never targets the red `发布` action, `发布笔记`, any other publish action, or a private endpoint. Direct navigation remains pinned to `https://creator.xiaohongshu.com` and is revalidated after the content-type transition.

## Container Runtime

Set `HOME=/tmp` in the shared `x-runtime.environment`. `/tmp` is already an isolated writable tmpfs while the container root remains read-only. Both `daily` and `login` inherit the setting, and the persistent browser session remains explicitly stored under `/data/browser-profile` through `launchPersistentContext`.

## Test Strategy

Extract small content-type and upload-readiness helpers with dependency behavior represented by Playwright-like locators. Unit tests cover the exact image-mode transition, rejection of ambiguous/missing targets, selection of an image-accepting input instead of the default video input, delayed attachment, and timeout classification. Source-level safety tests enforce the two-action allowlist and forbidden private-browser behaviors. Compose rendering verifies the runtime setting.

## Rollback

Revert the helper call to the prior immediate locator check and remove `HOME` from the shared environment. No state or data migration is involved. Existing persistent profiles and generated episodes remain compatible.
