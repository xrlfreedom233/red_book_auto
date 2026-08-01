export class PipelineError extends Error {
  constructor(message, { category = "internal", recoverable = false, cause } = {}) {
    super(message, { cause });
    this.name = "PipelineError";
    this.category = category;
    this.recoverable = recoverable;
  }
}

export function classifyHttpError(status, message = "external request failed") {
  if (status === 408 || status === 429 || status >= 500) {
    return new PipelineError(message, { category: "transient", recoverable: true });
  }
  if (status === 401 || status === 403) {
    return new PipelineError(message, { category: "authentication", recoverable: false });
  }
  return new PipelineError(message, { category: "external", recoverable: false });
}
