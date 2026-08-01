import { classifyHttpError, PipelineError } from "./errors.js";

export async function postJson(url, { body, headers = {}, timeoutMs, retries }) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs)
      });
      const text = await response.text();
      let payload;
      try {
        payload = text ? JSON.parse(text) : {};
      } catch (cause) {
        throw new PipelineError("external service returned invalid JSON", { category: "external", cause });
      }
      if (!response.ok) throw classifyHttpError(response.status, payload?.error?.message ?? payload?.message ?? `HTTP ${response.status}`);
      return payload;
    } catch (error) {
      lastError = error.name === "TimeoutError"
        ? new PipelineError("external request timed out", { category: "transient", recoverable: true, cause: error })
        : error;
      if (!lastError.recoverable || attempt === retries) throw lastError;
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
    }
  }
  throw lastError;
}
