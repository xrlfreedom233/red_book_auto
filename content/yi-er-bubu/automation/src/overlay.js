import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

function escapeXml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function lines(text, length = 8) {
  return [...text].reduce((result, character) => {
    const last = result.at(-1);
    if (!last || [...last].length >= length) result.push(character);
    else result[result.length - 1] += character;
    return result;
  }, []);
}

function bubbleSvg(bubble, index) {
  const { x, y, width, height } = bubble.box;
  const cx = x + width / 2;
  const bottom = y + height;
  const textLines = lines(bubble.text);
  const firstY = y + height / 2 - ((textLines.length - 1) * 26) + 14;
  const tailBaseLeft = Math.max(x + 28, Math.min(x + width - 68, bubble.tail.x - 28));
  const tailBaseRight = tailBaseLeft + 56;
  const pathData = [
    `M ${x + 24} ${y}`,
    `H ${x + width - 24} Q ${x + width} ${y} ${x + width} ${y + 24}`,
    `V ${bottom - 24} Q ${x + width} ${bottom} ${x + width - 24} ${bottom}`,
    `H ${tailBaseRight} L ${bubble.tail.x} ${bubble.tail.y} L ${tailBaseLeft} ${bottom}`,
    `H ${x + 24} Q ${x} ${bottom} ${x} ${bottom - 24}`,
    `V ${y + 24} Q ${x} ${y} ${x + 24} ${y} Z`
  ].join(" ");
  const spans = textLines.map((line, lineIndex) => `<tspan x="${cx}" y="${firstY + lineIndex * 52}">${escapeXml(line)}</tspan>`).join("");
  return `<g id="bubble-${index}"><path class="bubble" d="${pathData}"/><text class="dialogue" x="${cx}">${spans}</text></g>`;
}

export function createOverlaySvg(page, title) {
  const bubbles = page.bubbles.map(bubbleSvg).join("");
  const coverTitle = page.kind === "cover"
    ? `<rect x="190" y="1170" width="700" height="110" rx="30" fill="#fffaf2" stroke="#211b19" stroke-width="7"/><text class="title" x="540" y="1242">${escapeXml(title)}</text>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1440" viewBox="0 0 1080 1440">
<title>一二布布自动生成双横格叠层</title>
<defs><mask id="page-margins"><rect width="1080" height="1440" fill="white"/><rect x="64" y="72" width="952" height="582" rx="14" fill="black"/><rect x="64" y="726" width="952" height="582" rx="14" fill="black"/></mask></defs>
<style>.panel{fill:none;stroke:#211b19;stroke-width:10}.bubble{fill:#fff;stroke:#211b19;stroke-width:8;stroke-linejoin:round}.dialogue{font:700 44px 'Noto Sans CJK SC',sans-serif;fill:#171312;text-anchor:middle}.title{font:700 54px 'Noto Sans CJK SC',sans-serif;fill:#4b2d26;text-anchor:middle}</style>
<rect width="1080" height="1440" fill="#fff" mask="url(#page-margins)"/><rect class="panel" x="64" y="72" width="952" height="582" rx="14"/><rect class="panel" x="64" y="726" width="952" height="582" rx="14"/>${bubbles}${coverTitle}</svg>\n`;
}

export async function writeOverlay(file, page, title) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, createOverlaySvg(page, title), { flag: "wx" });
  return file;
}
