import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config.js";
import { createMockPng } from "../src/png.js";
import { generatePageImage, loadCharacterReference } from "../src/seedream.js";
import { createState } from "../src/state.js";
import { runPipeline } from "../src/pipeline.js";

const page = { number: 1, prompt: "暖色双格厨房场景" };

async function liveFixture(root) {
  const referenceRoot = path.join(root, "references");
  await mkdir(referenceRoot, { recursive: true });
  const config = await loadConfig({ mock: false, dailyRoot: path.join(root, "daily"), referenceRoot });
  config.arkApiKey = "test-only-key";
  config.dingTalkWebhook = "";
  return { config, referenceRoot };
}

test("live Seedream requires its character sheet before consuming image budget", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "yi-er-reference-missing-"));
  try {
    const { config } = await liveFixture(root);
    const state = createState("2026-08-10");
    await assert.rejects(generatePageImage({
      config,
      state,
      page,
      output: path.join(root, "result.png"),
      request: async () => { throw new Error("request must not run"); }
    }), /character sheet is missing/);
    assert.equal(state.counters.image, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("validated read-only PNG is attached as the single image field without entering sidecar logs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "yi-er-reference-valid-"));
  try {
    const { config, referenceRoot } = await liveFixture(root);
    const sheet = path.join(referenceRoot, "character-sheet.png");
    await createMockPng(sheet, 1080, 1440);
    await chmod(sheet, 0o444);
    const reference = await loadCharacterReference(config);
    const responseImage = await readFile(sheet);
    let requestBody;
    const output = path.join(root, "result.png");
    const state = createState("2026-08-10");
    await generatePageImage({
      config,
      state,
      page,
      output,
      characterReference: reference,
      request: async (_url, options) => {
        requestBody = options.body;
        return { echoedImage: options.body.image, data: [{ b64_json: responseImage.toString("base64") }] };
      }
    });
    assert.match(requestBody.image, /^data:image\/png;base64,/);
    assert.equal(Object.hasOwn(requestBody, "images"), false);
    assert.equal(state.counters.image, 1);
    const sidecar = await readFile(`${output}.input.json`, "utf8");
    assert.doesNotMatch(sidecar, /data:image|base64/);
    assert.match(sidecar, /character-sheet\.png/);
    const raw = await readFile(`${output}.raw.json`, "utf8");
    assert.doesNotMatch(raw, /data:image/);
    assert.match(raw, /\[redacted-image-data\]/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("configured equivalent name must remain a plain PNG filename", async () => {
  await assert.rejects(loadConfig({ mock: true, characterSheetName: "../outside.png" }), /plain PNG filename/);
  const config = await loadConfig({ mock: true, characterSheetName: "yi-er-character-sheet.png" });
  assert.equal(config.characterSheetName, "yi-er-character-sheet.png");
});

test("invalid PNG dimensions fail before budget accounting", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "yi-er-reference-small-"));
  try {
    const { config, referenceRoot } = await liveFixture(root);
    const sheet = path.join(referenceRoot, "character-sheet.png");
    await createMockPng(sheet, 100, 100);
    await chmod(sheet, 0o444);
    const state = createState("2026-08-10");
    await assert.rejects(generatePageImage({ config, state, page, output: path.join(root, "result.png") }), /512\.\.4096/);
    assert.equal(state.counters.image, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("truncated PNG data fails before budget accounting", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "yi-er-reference-corrupt-"));
  try {
    const { config, referenceRoot } = await liveFixture(root);
    const sheet = path.join(referenceRoot, "character-sheet.png");
    const valid = path.join(root, "valid.png");
    await createMockPng(valid, 1080, 1440);
    const bytes = await readFile(valid);
    await writeFile(sheet, bytes.subarray(0, 100));
    await chmod(sheet, 0o444);
    const state = createState("2026-08-10");
    await assert.rejects(generatePageImage({ config, state, page, output: path.join(root, "result.png") }), /512\.\.4096/);
    assert.equal(state.counters.image, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("mock generation remains independent of references and requests", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "yi-er-reference-mock-"));
  try {
    const config = await loadConfig({ mock: true, dailyRoot: root, referenceRoot: path.join(root, "missing") });
    const state = createState("2026-08-10");
    await generatePageImage({
      config,
      state,
      page,
      output: path.join(root, "result.png"),
      request: async () => { throw new Error("request must not run"); }
    });
    assert.equal(state.counters.image, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("live pipeline preflight leaves all model counters at zero when reference is missing", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "yi-er-reference-preflight-"));
  try {
    const { config } = await liveFixture(root);
    await assert.rejects(runPipeline(config, { date: "2026-08-10" }), /character sheet is missing/);
    const state = JSON.parse(await readFile(path.join(root, "daily", "runs", "2026-08-10", "state.json"), "utf8"));
    assert.deepEqual(state.counters, { text: 0, image: 0 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
