import { mkdir, open, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { PipelineError } from "./errors.js";

export const STAGES = ["topic", "episode", "images", "overlays", "renders", "quality", "xhsDraft", "notification"];
const STAGE_STATUSES = new Set(["pending", "running", "passed", "failed", "skipped"]);
const RESULTS = new Set(["running", "success", "partial_failure", "failed"]);

export function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function newStage() {
  return { status: "pending", attempts: 0, inputDigest: "", output: "", error: null, updatedAt: null };
}

export function createState(date) {
  return {
    version: 1,
    date,
    runId: crypto.randomUUID(),
    result: "running",
    reviewStatus: "pending_review",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    counters: { text: 0, image: 0 },
    rejectedTopics: [],
    stages: Object.fromEntries(STAGES.map((stage) => [stage, newStage()]))
  };
}

function validateState(state, date) {
  if (!state || state.version !== 1 || state.date !== date || !state.stages) {
    throw new PipelineError("state file is corrupt or belongs to another date", { category: "state_corrupt", recoverable: false });
  }
  if (typeof state.runId !== "string" || !RESULTS.has(state.result) || state.reviewStatus !== "pending_review") {
    throw new PipelineError("state metadata is corrupt", { category: "state_corrupt", recoverable: false });
  }
  if (!state.counters || !Number.isSafeInteger(state.counters.text) || state.counters.text < 0 || !Number.isSafeInteger(state.counters.image) || state.counters.image < 0) {
    throw new PipelineError("state call counters are corrupt", { category: "state_corrupt", recoverable: false });
  }
  if (!Array.isArray(state.rejectedTopics)) throw new PipelineError("state rejected-topic list is corrupt", { category: "state_corrupt", recoverable: false });
  for (const stage of STAGES) {
    const value = state.stages[stage];
    if (!value || !STAGE_STATUSES.has(value.status) || !Number.isSafeInteger(value.attempts) || value.attempts < 0 || typeof value.inputDigest !== "string") {
      throw new PipelineError(`state stage ${stage} is corrupt`, { category: "state_corrupt", recoverable: false });
    }
  }
  return state;
}

export async function atomicWriteJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function loadOrCreateState(runDir, date) {
  const file = path.join(runDir, "state.json");
  try {
    return validateState(JSON.parse(await readFile(file, "utf8")), date);
  } catch (error) {
    if (error.code !== "ENOENT") {
      if (error instanceof PipelineError) throw error;
      throw new PipelineError("state file is not valid JSON", { category: "state_corrupt", cause: error });
    }
  }
  const state = createState(date);
  await atomicWriteJson(file, state);
  return state;
}

export async function saveState(runDir, state) {
  state.updatedAt = new Date().toISOString();
  await atomicWriteJson(path.join(runDir, "state.json"), state);
}

export async function acquireDateLock(runDir, { staleMs = 15 * 60 * 1000, heartbeatMs = 30 * 1000 } = {}) {
  await mkdir(runDir, { recursive: true });
  const lockFile = path.join(runDir, ".lock");
  let handle;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      handle = await open(lockFile, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`);
      break;
    } catch (error) {
      await handle?.close();
      handle = undefined;
      if (error.code !== "EEXIST") throw error;
      const age = Date.now() - (await stat(lockFile)).mtimeMs;
      if (age <= staleMs || attempt > 0) {
        throw new PipelineError("this date is already running", { category: "concurrent", recoverable: true });
      }
      const staleFile = `${lockFile}.stale-${crypto.randomUUID()}`;
      await rename(lockFile, staleFile).catch((renameError) => {
        if (renameError.code !== "ENOENT") throw renameError;
      });
      await rm(staleFile, { force: true });
    }
  }
  if (!handle) throw new PipelineError("could not acquire date lock", { category: "concurrent", recoverable: true });
  const heartbeat = setInterval(() => {
    const now = new Date();
    void utimes(lockFile, now, now).catch(() => {});
  }, heartbeatMs);
  heartbeat.unref();
  return async () => {
    clearInterval(heartbeat);
    await handle.close();
    await rm(lockFile, { force: true });
  };
}

export function invalidateFrom(state, target) {
  const index = STAGES.indexOf(target);
  if (index < 0) throw new PipelineError(`unknown rerun stage: ${target}`, { category: "usage" });
  for (const stage of STAGES.slice(index)) {
    const attempts = state.stages[stage].attempts;
    state.stages[stage] = { ...newStage(), attempts };
  }
  state.result = "running";
}

export function shouldRun(stageState, inputDigest, resume) {
  if (stageState.status === "passed" && stageState.inputDigest === inputDigest) return false;
  if (stageState.status === "failed" && !resume) {
    throw new PipelineError("a failed stage requires --resume or --rerun", { category: "resume_required", recoverable: true });
  }
  return true;
}
