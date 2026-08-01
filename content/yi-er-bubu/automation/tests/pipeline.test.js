import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config.js";
import { runPipeline } from "../src/pipeline.js";
import { readPngDimensions } from "../src/png.js";
import { generatePageImage } from "../src/seedream.js";

test("mock pipeline creates a complete pending-review package and is idempotent", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "yi-er-e2e-"));
  try {
    const config = await loadConfig({ mock: true, dailyRoot: root, enableXhsDraft: false });
    const first = await runPipeline(config, { date: "2026-08-02" });
    assert.equal(first.result, "success");
    assert.equal(first.reviewStatus, "pending_review");
    assert.equal(first.counters.text, 2);
    assert.equal(first.counters.image, 5);
    const outputFiles = Object.values(first.stages.renders.output);
    assert.equal(outputFiles.length, 5);
    for (const file of outputFiles) assert.deepEqual(await readPngDimensions(file), { width: 1080, height: 1440 });
    const second = await runPipeline(config, { date: "2026-08-02" });
    assert.equal(second.counters.text, 2);
    assert.equal(second.counters.image, 5);
    assert.equal(second.stages.topic.attempts, 1);
    const report = await readFile(path.join(root, "runs", "2026-08-02", "report.md"), "utf8");
    assert.match(report, /待审核/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("targeted quality rerun does not call models again", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "yi-er-rerun-"));
  try {
    const config = await loadConfig({ mock: true, dailyRoot: root });
    const first = await runPipeline(config, { date: "2026-08-03" });
    const second = await runPipeline(config, { date: "2026-08-03", rerun: "quality", resume: true });
    assert.deepEqual(second.counters, first.counters);
    assert.equal(second.stages.quality.attempts, 2);
    assert.equal(second.stages.renders.attempts, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("changed image-stage input discards stale per-page outputs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "yi-er-input-change-"));
  try {
    const config = await loadConfig({ mock: true, dailyRoot: root });
    config.maxImageCalls = 12;
    await runPipeline(config, { date: "2026-08-04" });
    config.imageModel = "changed-mock-model";
    const rerun = await runPipeline(config, { date: "2026-08-04" });
    assert.equal(rerun.counters.image, 10);
    assert.ok(Object.values(rerun.stages.images.output).every((file) => /candidate-2/.test(file)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("mock draft mode cannot fall through to an external creator URL", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "yi-er-mock-draft-"));
  try {
    const config = await loadConfig({ mock: true, dailyRoot: root, enableXhsDraft: true });
    const state = await runPipeline(config, { date: "2026-08-07" });
    assert.equal(state.result, "partial_failure");
    assert.equal(state.stages.xhsDraft.error.category, "configuration");
    assert.match(state.stages.xhsDraft.error.message, /URL is invalid/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("recorded failures redact credential-like values", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "yi-er-redaction-"));
  try {
    const config = await loadConfig({ mock: true, dailyRoot: root });
    const leak = async () => { throw new Error("token=do-not-record cookie=session-value"); };
    await assert.rejects(runPipeline(config, { date: "2026-08-08" }, { generatePageImage: leak }), /do-not-record/);
    const state = JSON.parse(await readFile(path.join(root, "runs", "2026-08-08", "state.json"), "utf8"));
    assert.doesNotMatch(state.stages.images.error.message, /do-not-record|session-value/);
    assert.match(state.stages.images.error.message, /\[redacted\]/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("image interruption resumes only pages without saved artifacts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "yi-er-interrupt-"));
  try {
    const config = await loadConfig({ mock: true, dailyRoot: root });
    let injected = false;
    const flakyImage = async (arguments_) => {
      if (arguments_.page.number === 2 && !injected) {
        injected = true;
        throw new Error("injected image interruption");
      }
      return generatePageImage(arguments_);
    };
    await assert.rejects(runPipeline(config, { date: "2026-08-05" }, { generatePageImage: flakyImage }), /injected image interruption/);
    const failedState = JSON.parse(await readFile(path.join(root, "runs", "2026-08-05", "state.json"), "utf8"));
    assert.deepEqual(Object.keys(failedState.stages.images.output), ["0", "1"]);
    const resumed = await runPipeline(config, { date: "2026-08-05", resume: true }, { generatePageImage: flakyImage });
    assert.equal(resumed.result, "success");
    assert.equal(resumed.counters.image, 5);
    assert.equal(resumed.stages.images.attempts, 2);
    assert.match(resumed.stages.images.output[2], /candidate-2/);
    assert.doesNotMatch(resumed.stages.images.output[0], /candidate/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
