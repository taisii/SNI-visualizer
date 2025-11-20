#!/usr/bin/env bun
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { analyze } from "../lib/analysis-engine";
import type {
  TraceMode,
  TraceStep,
  AnalysisError,
} from "../lib/analysis-schema";

const DEFAULT_TRACE_MODE: TraceMode = "bfs";
const DEFAULT_TARGET = "muasm_case";

type CliOptions = {
  traceMode: TraceMode;
  windowSize?: number;
};

type ParsedArgs = {
  options: CliOptions;
  targets: string[];
};

async function main() {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
    return;
  }
  const { options, targets } = parsed;
  const targetList = targets.length > 0 ? targets : [DEFAULT_TARGET];
  const files = await collectMuasmFiles(targetList);
  if (files.length === 0) {
    console.error("MuASM ファイルが見つかりませんでした。");
    process.exit(1);
  }

  let hadFailure = false;
  for (const filePath of files) {
    const ok = await runSingleCase(filePath, options);
    if (!ok) hadFailure = true;
  }

  if (hadFailure) {
    process.exit(1);
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const options: CliOptions = { traceMode: DEFAULT_TRACE_MODE };
  const targets: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      targets.push(arg);
      continue;
    }

    const [flag, maybeValue] = arg.includes("=")
      ? ((): [string, string | undefined] => {
          const [k, v] = arg.split("=", 2);
          return [k, v];
        })()
      : [arg, undefined];

    switch (flag) {
      case "--trace-mode": {
        const value = maybeValue ?? argv[++i];
        if (value !== "bfs" && value !== "single-path") {
          throw new Error(
            `--trace-mode は 'bfs' または 'single-path' を指定してください (got: ${value ?? ""})`,
          );
        }
        options.traceMode = value;
        break;
      }
      case "--window-size": {
        const value = maybeValue ?? argv[++i];
        const parsed = Number.parseInt(value ?? "", 10);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          throw new Error("--window-size は正の整数で指定してください");
        }
        options.windowSize = parsed;
        break;
      }
      case "--help": {
        printUsage();
        process.exit(0);
      }
      default:
        throw new Error(`未知のフラグです: ${flag}`);
    }
  }

  return { options, targets };
}

function printUsage() {
  console.log(`MuASM ケース実行スクリプト
Usage: bun run scripts/run-muasm.ts [options] [file|dir ...]

Options:
  --trace-mode <bfs|single-path>  解析の探索戦略 (default: bfs)
  --window-size <n>               投機ウィンドウの大きさ (default: VCFG builder デフォルト)
  --help                          このヘルプを表示

引数を省略すると muasm_case/ 以下の全 .muasm を実行します。`);
}

async function collectMuasmFiles(targets: string[]): Promise<string[]> {
  const collected = new Set<string>();
  for (const raw of targets) {
    const resolved = path.resolve(raw);
    try {
      const stats = await fs.stat(resolved);
      if (stats.isDirectory()) {
        await collectFromDir(resolved, collected);
      } else if (stats.isFile() && resolved.endsWith(".muasm")) {
        collected.add(resolved);
      }
    } catch (err) {
      console.error(`パスを解決できませんでした: ${raw}`);
      console.error(err);
    }
  }
  return Array.from(collected).sort();
}

async function collectFromDir(dir: string, acc: Set<string>) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await collectFromDir(fullPath, acc);
      } else if (entry.isFile() && entry.name.endsWith(".muasm")) {
        acc.add(fullPath);
      }
    }),
  );
}

async function runSingleCase(filePath: string, options: CliOptions): Promise<boolean> {
  const relPath = path.relative(process.cwd(), filePath) || filePath;
  console.log(`\n=== ${relPath} ===`);

  let source: string;
  try {
    source = await fs.readFile(filePath, "utf8");
  } catch (err) {
    console.error("ファイルを読み込めませんでした", err);
    return false;
  }

  try {
    const result = await analyze(source, {
      traceMode: options.traceMode,
      windowSize: options.windowSize,
    });
    printAnalysisResult(
      result.trace.steps ?? [],
      result.result,
      result.traceMode,
      result.error,
    );
    // エラーが含まれている場合は失敗扱いにする
    if (result.error) {
      return false;
    }
    return true;
  } catch (err) {
    console.error("解析に失敗しました", err);
    return false;
  }
}

function printAnalysisResult(
  steps: TraceStep[],
  outcome: string,
  traceMode: TraceMode,
  error?: AnalysisError,
) {
  console.log(`result     : ${outcome}`);
  console.log(`trace mode : ${traceMode}`);
  console.log(`steps      : ${steps.length}`);
  const violation = steps.find((s) => s.isViolation);
  if (violation) {
    console.log(
      `violation  : step ${violation.stepId} @ node ${violation.nodeId || "(entry)"} (${violation.executionMode})`,
    );
  } else {
    console.log("violation  : none");
  }

  if (error) {
    console.log(`error.type : ${error.type}`);
    console.log(`error.msg  : ${error.message}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
