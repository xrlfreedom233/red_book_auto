import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { acquireDateLock, createState, invalidateFrom, loadOrCreateState, saveState, shouldRun } from "../src/state.js";

test("state writes atomically and rejects corrupt data", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "yi-er-state-"));
  try {
    const state = createState("2026-08-02");
    state.stages.topic.status = "passed";
    await saveState(root, state);
    assert.equal(JSON.parse(await readFile(path.join(root, "state.json"), "utf8")).stages.topic.status, "passed");
    await writeFile(path.join(root, "state.json"), "not json");
    await assert.rejects(loadOrCreateState(root, "2026-08-02"), /valid JSON/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("date lock excludes concurrent invocation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "yi-er-lock-"));
  try {
    const release = await acquireDateLock(root);
    await assert.rejects(acquireDateLock(root), /already running/);
    await release();
    const releaseAgain = await acquireDateLock(root);
    await releaseAgain();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("date lock reclaims a stale lease after an interrupted process", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "yi-er-stale-lock-"));
  try {
    await writeFile(path.join(root, ".lock"), "abandoned\n");
    const old = new Date(Date.now() - 60_000);
    await utimes(path.join(root, ".lock"), old, old);
    const release = await acquireDateLock(root, { staleMs: 1000, heartbeatMs: 1000 });
    await release();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("state validation rejects corrupt counters that could bypass call budgets", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "yi-er-counter-state-"));
  try {
    const state = createState("2026-08-02");
    state.counters.text = "0";
    await writeFile(path.join(root, "state.json"), JSON.stringify(state));
    await assert.rejects(loadOrCreateState(root, "2026-08-02"), /counters are corrupt/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rerun invalidates target and downstream only", () => {
  const state = createState("2026-08-02");
  for (const stage of Object.values(state.stages)) stage.status = "passed";
  invalidateFrom(state, "quality");
  assert.equal(state.stages.renders.status, "passed");
  assert.equal(state.stages.quality.status, "pending");
  assert.equal(state.stages.quality.attempts, 0);
  assert.equal(state.stages.notification.status, "pending");
  assert.equal(shouldRun({ status: "passed", inputDigest: "a" }, "a", false), false);
  assert.throws(() => shouldRun({ status: "failed", inputDigest: "a" }, "a", false), /--resume/);
});
