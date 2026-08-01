import { PipelineError } from "./errors.js";

const PANELS = new Set(["top", "bottom"]);
const PAGE_KINDS = new Set(["cover", "story"]);

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${label} must be an object`);
  return value;
}

function string(value, label, max = 5000) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) invalid(`${label} must be a non-empty string`);
  return value.trim();
}

function array(value, label, min = 0, max = Infinity) {
  if (!Array.isArray(value) || value.length < min || value.length > max) invalid(`${label} must contain ${min}..${max} items`);
  return value;
}

function number(value, label, min, max) {
  if (!Number.isFinite(value) || value < min || value > max) invalid(`${label} is outside ${min}..${max}`);
  return value;
}

function boolean(value, label) {
  if (typeof value !== "boolean") invalid(`${label} must be a boolean`);
  return value;
}

function invalid(message) {
  throw new PipelineError(message, { category: "validation", recoverable: false });
}

export function validateTopic(input) {
  const value = object(input, "topic");
  return {
    column: string(value.column, "topic.column", 80),
    title: string(value.title, "topic.title", 100),
    emotion: string(value.emotion, "topic.emotion", 100),
    scene: string(value.scene, "topic.scene", 100),
    conflict: string(value.conflict, "topic.conflict", 200),
    ending: string(value.ending, "topic.ending", 200),
    keywords: array(value.keywords, "topic.keywords", 2, 12).map((item, index) => string(item, `topic.keywords[${index}]`, 30))
  };
}

export function validateBubble(input, label = "bubble") {
  const value = object(input, label);
  if (!PANELS.has(value.panel)) invalid(`${label}.panel must be top or bottom`);
  const box = object(value.box, `${label}.box`);
  const tail = object(value.tail, `${label}.tail`);
  const text = string(value.text, `${label}.text`, 80);
  const panelBottom = value.panel === "top" ? 620 : 1270;
  if (box.x + box.width > 980 || box.y + box.height > panelBottom) invalid(`${label}.box must stay inside its panel safe area`);
  const charactersPerLine = Math.max(1, Math.floor((box.width - 40) / 44));
  const lineCount = Math.ceil([...text].length / charactersPerLine);
  if (lineCount * 52 > box.height - 28) invalid(`${label}.text does not fit inside its bubble box`);
  return {
    text,
    speaker: string(value.speaker, `${label}.speaker`, 20),
    panel: value.panel,
    box: {
      x: number(box.x, `${label}.box.x`, 100, 900),
      y: number(box.y, `${label}.box.y`, value.panel === "top" ? 100 : 754, value.panel === "top" ? 560 : 1214),
      width: number(box.width, `${label}.box.width`, 180, 500),
      height: number(box.height, `${label}.box.height`, 100, 260)
    },
    tail: {
      x: number(tail.x, `${label}.tail.x`, 100, 980),
      y: number(tail.y, `${label}.tail.y`, value.panel === "top" ? 100 : 754, value.panel === "top" ? 620 : 1270)
    }
  };
}

export function validatePage(input, index) {
  const value = object(input, `pages[${index}]`);
  if (!PAGE_KINDS.has(value.kind)) invalid(`pages[${index}].kind must be cover or story`);
  const pageNumber = number(value.number, `pages[${index}].number`, 0, 6);
  if ((index === 0 && (value.kind !== "cover" || pageNumber !== 0)) || (index > 0 && (value.kind !== "story" || pageNumber !== index))) {
    invalid(`pages[${index}] has an invalid kind or sequence number`);
  }
  return {
    number: pageNumber,
    kind: value.kind,
    upper: string(value.upper, `pages[${index}].upper`, 1000),
    lower: string(value.lower, `pages[${index}].lower`, 1000),
    prompt: string(value.prompt, `pages[${index}].prompt`, 3000),
    bubbles: array(value.bubbles, `pages[${index}].bubbles`, 0, 4).map((bubble, bubbleIndex) => validateBubble(bubble, `pages[${index}].bubbles[${bubbleIndex}]`))
  };
}

export function validateEpisode(input) {
  const value = object(input, "episode");
  const pages = array(value.pages, "episode.pages", 5, 7).map(validatePage);
  return {
    slug: string(value.slug, "episode.slug", 80),
    title: string(value.title, "episode.title", 100),
    brief: string(value.brief, "episode.brief", 1000),
    pages,
    publish: {
      title: string(object(value.publish, "episode.publish").title, "episode.publish.title", 20),
      body: string(value.publish.body, "episode.publish.body", 1000),
      tags: array(value.publish.tags, "episode.publish.tags", 1, 10).map((item, index) => string(item, `episode.publish.tags[${index}]`, 30))
    }
  };
}

export function validateQuality(input) {
  const value = object(input, "quality");
  return {
    automatic: array(value.automatic, "quality.automatic", 1, 50).map((item, index) => {
      const check = object(item, `quality.automatic[${index}]`);
      return { name: string(check.name, "check.name", 100), passed: boolean(check.passed, "check.passed"), detail: string(check.detail, "check.detail", 300) };
    }),
    manualReview: array(value.manualReview, "quality.manualReview", 1, 50).map((item, index) => string(item, `quality.manualReview[${index}]`, 200))
  };
}
