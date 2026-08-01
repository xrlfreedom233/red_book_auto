import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { readPngDimensions } from "./png.js";
import { validateQuality } from "./contracts.js";

const forbidden = ["官方合作", "官方授权", "购买链接", "付费解锁"];

export async function runQualityChecks(episode, episodeDir, artifacts = {}) {
  const automatic = [];
  const expected = episode.pages.map((page) => `${String(page.number).padStart(2, "0")}.png`);
  automatic.push({ name: "page count", passed: expected.length >= 5 && expected.length <= 7, detail: `${expected.length} files expected` });
  for (const filename of expected) {
    const pageNumber = Number.parseInt(filename, 10);
    const file = artifacts.renders?.[pageNumber] ?? path.join(episodeDir, "output", filename);
    let dimensions = null;
    try {
      await access(file);
      dimensions = await readPngDimensions(file);
    } catch {}
    automatic.push({ name: `PNG ${filename}`, passed: dimensions?.width === 1080 && dimensions?.height === 1440, detail: dimensions ? `${dimensions.width}x${dimensions.height}` : "missing or invalid PNG" });
  }
  const copy = `${episode.title}\n${episode.publish.title}\n${episode.publish.body}\n${episode.publish.tags.join(" ")}`;
  const hit = forbidden.find((phrase) => copy.includes(phrase));
  automatic.push({ name: "rights and sales wording", passed: !hit, detail: hit ? `contains forbidden phrase: ${hit}` : "no forbidden phrase found" });
  automatic.push({ name: "page sequence", passed: episode.pages.every((page, index) => page.number === index), detail: "cover 00 followed by story pages" });
  for (const page of episode.pages) {
    const overlay = await readFile(artifacts.overlays?.[page.number] ?? path.join(episodeDir, "overlays", `${String(page.number).padStart(2, "0")}.svg`), "utf8");
    automatic.push({ name: `overlay ${page.number}`, passed: !page.bubbles.some((bubble) => !overlay.includes(bubble.text)), detail: "all contracted dialogue appears in SVG" });
  }
  return validateQuality({
    automatic,
    manualReview: [
      "逐页确认角色身份、造型与肢体结构",
      "确认气泡尾尖指向正确说话角色",
      "确认上下格动作、视线与场景连续",
      "逐字核对中文语义并确认无模型生成文字",
      "确认草稿整体符合待发布标准后再由用户手动发布"
    ]
  });
}
