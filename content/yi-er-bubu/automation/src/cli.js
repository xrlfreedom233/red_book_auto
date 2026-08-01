#!/usr/bin/env node
import { loadConfig } from "./config.js";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PipelineError } from "./errors.js";
import { runPipeline } from "./pipeline.js";
import { interactiveLogin } from "./xhs-draft.js";
import { STAGES } from "./state.js";

function usage() {
  return `用法：
  node src/cli.js run (--mock | --live) [--date YYYY-MM-DD] [--resume] [--rerun STAGE] [--xhs-draft]
  node src/cli.js login --live

默认不允许外部模型调用；必须显式选择 --mock 或 --live。`;
}

function shanghaiDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().startsWith(value);
}

export function parseArgs(argv) {
  const args = [...argv];
  const command = args[0] && !args[0].startsWith("-") ? args.shift() : "run";
  const options = { command, date: shanghaiDate(), resume: false, rerun: "", mock: false, live: false, enableXhsDraft: false };
  while (args.length) {
    const arg = args.shift();
    switch (arg) {
      case "--date": options.date = args.shift() ?? ""; break;
      case "--resume": options.resume = true; break;
      case "--rerun": options.rerun = args.shift() ?? ""; break;
      case "--mock": options.mock = true; break;
      case "--live": options.live = true; break;
      case "--xhs-draft": options.enableXhsDraft = true; break;
      case "--help": options.help = true; break;
      default: throw new PipelineError(`未知参数：${arg}`, { category: "usage" });
    }
  }
  if (!options.help && options.mock === options.live) throw new PipelineError("必须且只能选择 --mock 或 --live", { category: "usage" });
  if (command === "run" && !validDate(options.date)) throw new PipelineError("日期必须是有效的 YYYY-MM-DD", { category: "usage" });
  if (options.rerun && !STAGES.includes(options.rerun)) throw new PipelineError(`未知阶段：${options.rerun}`, { category: "usage" });
  if (!new Set(["run", "login"]).has(command)) throw new PipelineError(`未知命令：${command}`, { category: "usage" });
  if (command === "login" && options.mock) throw new PipelineError("交互式登录只支持 --live", { category: "usage" });
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const config = await loadConfig({ mock: options.mock, enableXhsDraft: options.enableXhsDraft });
  if (options.command === "login") {
    await interactiveLogin(config);
    return;
  }
  const state = await runPipeline(config, options);
  process.stdout.write(`${JSON.stringify({ date: state.date, runId: state.runId, result: state.result, reviewStatus: state.reviewStatus })}\n`);
  if (state.result !== "success") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.category ?? "error"}: ${error.message}\n`);
    if (error.category === "usage") process.stderr.write(`${usage()}\n`);
    process.exitCode = 1;
  });
}
