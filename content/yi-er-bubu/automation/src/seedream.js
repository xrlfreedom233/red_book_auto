import { lstat, mkdir, open, readFile, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { postJson } from "./http.js";
import { PipelineError } from "./errors.js";
import { createMockPng, readPngDimensions } from "./png.js";

const endpoint = "https://ark.cn-beijing.volces.com/api/v3/images/generations";
const MAX_CHARACTER_SHEET_BYTES = 15 * 1024 * 1024;
const MIN_CHARACTER_SHEET_EDGE = 512;
const MAX_CHARACTER_SHEET_EDGE = 4096;

function redactDataUrls(value) {
  return JSON.parse(JSON.stringify(value, (_key, item) => (
    typeof item === "string" && /^data:image\/[a-z0-9.+-]+;base64,/i.test(item)
      ? "[redacted-image-data]"
      : item
  )));
}

async function assertReadOnly(file, metadata) {
  if ((metadata.mode & 0o222) === 0) return;
  let writable;
  try {
    writable = await open(file, "r+");
  } catch (error) {
    if (error.code === "EACCES" || error.code === "EROFS") return;
    throw error;
  }
  await writable.close();
  throw new PipelineError("character sheet must be read-only", { category: "configuration" });
}

export async function loadCharacterReference(config) {
  const file = config.characterSheetFile ?? path.join(config.referenceRoot, config.characterSheetName ?? "character-sheet.png");
  let metadata;
  try {
    metadata = await lstat(file);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new PipelineError(`required character sheet is missing: ${path.basename(file)}`, { category: "configuration" });
    }
    throw error;
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new PipelineError("character sheet must be a regular non-symlink PNG file", { category: "configuration" });
  }
  if (metadata.size < 100 || metadata.size > MAX_CHARACTER_SHEET_BYTES) {
    throw new PipelineError("character sheet file size must be between 100 bytes and 15 MiB", { category: "configuration" });
  }
  await assertReadOnly(file, metadata);
  const bytes = await readFile(file);
  const dimensions = await readPngDimensions(file);
  if (!dimensions || dimensions.width < MIN_CHARACTER_SHEET_EDGE || dimensions.height < MIN_CHARACTER_SHEET_EDGE || dimensions.width > MAX_CHARACTER_SHEET_EDGE || dimensions.height > MAX_CHARACTER_SHEET_EDGE) {
    throw new PipelineError("character sheet must be a 512..4096 pixel PNG", { category: "configuration" });
  }
  return {
    file,
    filename: path.basename(file),
    bytes: bytes.length,
    width: dimensions.width,
    height: dimensions.height,
    digest: crypto.createHash("sha256").update(bytes).digest("hex"),
    dataUrl: `data:image/png;base64,${bytes.toString("base64")}`
  };
}

export async function generatePageImage({ config, state, page, output, checkpoint, characterReference, request = postJson }) {
  const reference = config.mock ? null : (characterReference ?? await loadCharacterReference(config));
  if (!config.mock && !config.arkApiKey) throw new PipelineError("ARK API key is not configured", { category: "configuration" });
  if (state.counters.image >= config.maxImageCalls) throw new PipelineError("daily image call budget exceeded", { category: "budget" });
  state.counters.image += 1;
  await checkpoint?.();
  await mkdir(path.dirname(output), { recursive: true });
  const prompt = `${page.prompt}\n上下双格治愈系漫画，无文字、无气泡、无水印、无签名，预留气泡安全区。`;
  await writeFile(`${output}.input.json`, `${JSON.stringify({
    prompt,
    page: page.number,
    characterReference: reference ? { filename: reference.filename, bytes: reference.bytes, width: reference.width, height: reference.height, digest: reference.digest } : { mock: true }
  }, null, 2)}\n`, { mode: 0o600 });
  if (config.mock) {
    await createMockPng(output);
    await writeFile(`${output}.raw.json`, `${JSON.stringify({ mock: true, page: page.number })}\n`, { mode: 0o600 });
    return output;
  }
  const raw = await request(endpoint, {
    timeoutMs: config.requestTimeoutMs,
    retries: config.maxRetries,
    headers: { authorization: `Bearer ${config.arkApiKey}` },
    body: { model: config.imageModel, prompt, image: reference.dataUrl, response_format: "b64_json", size: "2K", watermark: false }
  });
  await writeFile(`${output}.raw.json`, `${JSON.stringify(redactDataUrls(raw), null, 2)}\n`, { mode: 0o600 });
  const encoded = raw?.data?.[0]?.b64_json;
  if (typeof encoded !== "string") throw new PipelineError("image response has no base64 image", { category: "external" });
  const image = Buffer.from(encoded, "base64");
  if (image.length < 100) throw new PipelineError("image response was empty", { category: "external" });
  await writeFile(output, image, { flag: "wx" });
  return output;
}
