import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { postJson } from "./http.js";
import { PipelineError } from "./errors.js";

const endpoint = "https://ark.cn-beijing.volces.com/api/v3/chat/completions";

function extractJson(text) {
  const trimmed = text.trim().replace(/^```json\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch (cause) {
    throw new PipelineError("text model response was not valid JSON", { category: "validation", cause });
  }
}

export async function callStructuredText({ config, state, stageDir, system, prompt, validate, mockValue, checkpoint }) {
  if (!config.mock && !config.arkApiKey) throw new PipelineError("ARK API key is not configured", { category: "configuration" });
  if (state.counters.text >= config.maxTextCalls) {
    throw new PipelineError("daily text call budget exceeded", { category: "budget" });
  }
  state.counters.text += 1;
  await checkpoint?.();
  await mkdir(stageDir, { recursive: true });
  await writeFile(path.join(stageDir, "input.json"), `${JSON.stringify({ system, prompt }, null, 2)}\n`, { mode: 0o600 });

  let content;
  let raw;
  if (config.mock) {
    content = JSON.stringify(mockValue);
    raw = { mock: true, choices: [{ message: { content } }] };
  } else {
    raw = await postJson(endpoint, {
      timeoutMs: config.requestTimeoutMs,
      retries: config.maxRetries,
      headers: { authorization: `Bearer ${config.arkApiKey}` },
      body: {
        model: config.textModel,
        messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
        response_format: { type: "json_object" },
        stream: false
      }
    });
    content = raw?.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new PipelineError("text model response has no content", { category: "external" });
  }
  await writeFile(path.join(stageDir, "raw.json"), `${JSON.stringify(raw, null, 2)}\n`, { mode: 0o600 });
  const normalized = validate(extractJson(content));
  await writeFile(path.join(stageDir, "normalized.json"), `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600 });
  return normalized;
}
