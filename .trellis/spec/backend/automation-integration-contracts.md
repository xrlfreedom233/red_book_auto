# Automation Integration Contracts

> Executable contracts for recoverable content jobs that call external models, render files, automate browser drafts, and send notifications.

## Scenario: Recoverable Daily Content Automation

### 1. Scope / Trigger

Apply this specification when a job in `content/yi-er-bubu/automation/` or a future equivalent:

- consumes paid or quota-limited external APIs;
- persists multi-stage file output;
- uses Docker secrets or browser profiles;
- drives a third-party browser UI;
- sends operational notifications.

The goal is to prevent duplicate charges, stale output reuse, credential leakage, and unintended third-party actions. The state file is the job's source of truth; UI screenshots, logs, and notifications are evidence, not state.

### 2. Signatures

Supported operator commands must preserve these behavioral signatures:

```text
node src/cli.js run [--date YYYY-MM-DD] [--resume] [--rerun <stage>] [--mock]
node src/cli.js login
docker compose run --rm daily [run options]
```

- `run` executes one date-scoped job under an exclusive date lock.
- `--resume` continues from the first non-passed stage.
- `--rerun <stage>` invalidates that stage and all downstream stages, never upstream output.
- `--mock` must not read production secrets, browser sessions, or external URLs.
- `login` may initialize a persistent browser profile but must not publish content.

Stage status is restricted to:

```text
pending | running | passed | failed | skipped
```

State writes use a temporary sibling plus atomic rename. A successful same-date invocation with unchanged input digests returns the existing run identity without consuming a model budget.

### 3. Contracts

#### Persistent data

```text
daily/runs/YYYY-MM-DD/state.json       # single state source of truth
daily/history/topics.jsonl             # idempotent topic history
daily/episodes/YYYY-MM-DD-<slug>/      # immutable/candidate artifacts
browser-profile/                       # isolated Chromium session volume
references/character-sheet.png         # read-only live image reference
```

Every stage records status, attempt count, input digest, safe output paths, timestamps, and a redacted error category. Changed input digests clear stale stage output and invalidate downstream stages.

#### Environment and secrets

| Key | Requirement | Contract |
|---|---|---|
| `ARK_API_KEY` / Docker secret | Live model mode | Never log, persist, or place in process arguments |
| `DINGTALK_WEBHOOK` / Docker secret | Live notification mode | HTTPS endpoint; never include in notification body |
| `DINGTALK_SECRET` / Docker secret | Optional signed robot | HMAC-SHA256 over `<timestamp>\n<secret>`, then raw Base64 and URL encoding once |
| `CHARACTER_SHEET_NAME` | Optional | Plain PNG basename under the read-only reference root |
| `MAX_TEXT_CALLS`, `MAX_IMAGE_CALLS` | Required limits | Non-negative integer budgets validated before execution |
| `MAX_RETRIES` | Optional | Non-negative integer; zero must disable retries |
| `TZ` / cron `CRON_TZ` | Scheduled mode | `Asia/Shanghai` for the 09:00 daily trigger |

The live character sheet must be a regular non-symlink PNG, read-only to the runtime user, 100 bytes–15 MiB, 512–4096 pixels on each axis, with valid PNG chunks, CRCs, `IDAT`, terminal `IEND`, and no trailing data. Only its basename, dimensions, size, and SHA-256 may be persisted. Its in-memory data URL may be sent in the supported single `image` field and must be redacted from responses and errors.

#### Browser draft boundary

Live browser navigation is pinned to HTTPS on `creator.xiaohongshu.com`; every redirect is revalidated. Mock browser mode is restricted to loopback. The automation may upload images, fill copy, and click only the exact “保存草稿” action. It must not contain a publish-button selector, replay a private endpoint, extract cookies/signatures, bypass challenges, or infer success from an ambiguous page.

#### External response boundaries

- Validate credentials and local reference files before incrementing call budgets.
- Increment the budget immediately before an external model attempt.
- Retry only classified transient network, rate-limit, and bounded server errors.
- Treat DingTalk HTTP 200 with nonzero business `errcode` as failure.
- Notification failure is recorded separately and must not rewrite the content/draft result.
- Persisted errors and screenshots must redact tokens, cookies, authorization headers, data URLs, and common credential fields.

### 4. Validation & Error Matrix

| Condition | Required result |
|---|---|
| Same date, same digests, prior success | Reuse run; zero new model calls |
| Active non-stale date lock | Fail fast as concurrent execution |
| Stale lock beyond configured threshold | Recover lock, record recovery, continue safely |
| Malformed state/counters/attempts | Reject state; do not call external services |
| Missing/invalid credential | Fail before incrementing its budget |
| Missing/writable/symlink/corrupt character sheet | Fail before image budget/network |
| 401/403 or quota exhaustion | Non-retryable failure |
| 429, timeout, bounded 5xx | Limited backoff retry within budget |
| Model JSON violates contract | Stop stage; never feed raw output downstream |
| Changed character-sheet SHA-256 | Invalidate image stages and downstream output |
| Browser leaves pinned host or sees challenge | Stop, capture redacted evidence, never publish |
| Draft result is ambiguous | Mark draft failed/partial; require manual upload |
| DingTalk HTTP 200 with `errcode != 0` | Notification failure, content state preserved |

### 5. Good / Base / Bad Cases

- **Good:** A 09:00 job validates secrets and the read-only character sheet, generates five pages, saves a draft, records `pending_review`, and sends a signed DingTalk message. A second same-date invocation returns the same run ID without model calls.
- **Base:** Generation succeeds but the browser login expired. The publish package remains intact and pending review, draft status fails with a safe screenshot, and DingTalk tells the operator to log in or upload manually.
- **Bad:** A job accepts a stale `passed` image after its reference SHA changes, logs a data URL, retries an authentication failure, follows a redirect to another host, or searches for a “发布” button. These behaviors violate this specification.

### 6. Tests Required

Unit and integration tests must assert:

1. atomic state replacement, corrupt-state rejection, stale-lock recovery, and concurrent-lock rejection;
2. same-date idempotency and downstream-only invalidation;
3. call counters stay zero for missing credentials and invalid/corrupt reference PNGs;
4. retry zero is honored and transient/non-transient errors are classified;
5. reference SHA participates in image-stage digests and data URLs are redacted;
6. mock mode uses loopback only and performs no external request;
7. live browser hosts and redirects are pinned, only “保存草稿” is clickable, and no private publish endpoint or publish selector exists;
8. DingTalk signs exactly once, checks business `errcode`, and preserves the content outcome on notification failure;
9. mock end-to-end runs twice with one run ID and produces the required 1080×1440 PNG set;
10. repository, logs, fixtures, image layers, and process arguments contain no credential material.

### 7. Wrong vs Correct

#### Wrong

```js
// Charges before local preflight and trusts an unvalidated browser destination.
budget.imageCalls += 1;
await request({ image: await fs.readFile(referencePath, "base64") });
await page.goto(config.url);
await page.getByText("发布").click();
```

#### Correct

```js
const reference = await validateReadOnlyCharacterSheet(referenceRoot, fileName);
assertAllowedCreatorUrl(config.url);
budget.assertImageAvailable();
budget.imageCalls += 1;
await request({ image: reference.dataUrl });
await page.getByRole("button", { name: "保存草稿", exact: true }).click();
```

Validation precedes budget consumption, the external host is pinned, sensitive image data stays in memory, and the browser action is explicitly limited to saving a draft.
