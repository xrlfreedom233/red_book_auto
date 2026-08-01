## Bug Analysis: Default video uploader selected for an image draft

### 1. Root Cause Category

- **Category**: E - Implicit Assumption, with D - Test Coverage Gap
- **Specific Cause**: The adapter assumed the first file input belonged to image notes. The real creator page defaults to `上传视频`; its first input accepts `.mp4,.mov,...` and is single-file. Unit tests modeled only one generic upload input and therefore could not expose the content-type distinction.
- **Follow-up Evidence**: The real DOM contains three visible `SPAN.title` nodes with exact text `上传图文`, so strict text uniqueness also fails. A semantic exact label must be combined with Playwright actionability, not raw node count.
- **Actionability Probe**: A live non-mutating trial-click probe returned `[false, false, true]`, confirming exactly one of the three duplicate labels can receive the content-type click.
- **Editor Evidence**: After image upload and title fill, the body is a contenteditable region identified by `输入正文描述，真诚有价值的分享予人温暖`; the safe final action is the white `暂存离开` button next to a forbidden red `发布` button.
- **DOM Probe**: The sole editor is `DIV.tiptap.ProseMirror[contenteditable=true][role=textbox]` with no placeholder or accessible label. `暂存离开` is absent from the ARIA button list, so role-based lookup cannot find it.
- **Overlay Evidence**: Filling the final hashtag opens a topic-suggestion panel above the footer. The panel persists after `fill` and prevents the safe draft action from passing actionability checks; a non-mutating `Escape` dismissal is required.

### 2. Why the First Fix Failed

1. Waiting for `attached` correctly fixed the skeleton-screen race but preserved the wrong `.first()` selection rule.
2. Source-level safety tests constrained publish clicks but did not model the safe content-type transition required before image upload.

### 3. Prevention Mechanisms

| Priority | Mechanism | Specific Action | Status |
|---|---|---|---|
| P0 | Architecture | Select a file input by explicit image `accept` contract, never DOM order | Done |
| P0 | Runtime safety | Require an exact, unambiguous `上传图文` transition and revalidate host afterward | Done |
| P0 | Runtime safety | Resolve duplicate exact labels with non-mutating trial clicks and require one actionable candidate | Done |
| P0 | Test coverage | Assert the upload locator carries an image `accept` contract and never uses a generic first input | Done |
| P1 | Documentation | Record creator SPA readiness and content-type contracts in the automation spec | Done |

### 4. Systematic Expansion

- **Similar Issues**: Title/body/save controls may also appear only after selecting the content type; their existing Playwright auto-waits remain bounded by library defaults and should be observed in the live rerun.
- **Design Improvement**: Treat external UI controls as semantic contracts (exact action name plus accepted file type), not DOM-order assumptions.
- **Process Improvement**: A live failure screenshot and sanitized locator error are required evidence before changing third-party selectors.

### 5. Knowledge Capture

- [x] Update `.trellis/spec/backend/automation-integration-contracts.md` with the two-action allowlist and image-input selection rule.
- [x] Add regression tests for semantic image-input selection.
- [ ] Confirm the real server run saves a draft without any publish action.
