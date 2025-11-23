#!/usr/bin/env bun
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { analyze } from "../lib/analysis-engine";
import type {
  AnalysisResult,
  TraceMode,
  TraceStep,
  AnalysisError,
  SpeculationMode,
  SpecRunMode,
} from "../lib/analysis-schema";

const DEFAULT_TRACE_MODE: TraceMode = "bfs";
const DEFAULT_TARGET = "muasm_case";
const DEFAULT_SPEC_MODE: SpeculationMode = "discard";
const DEFAULT_SPEC_RUN_MODE: SpecRunMode = "light";

type CliOptions = {
  traceMode: TraceMode;
  speculationMode: SpeculationMode;
  specMode: SpecRunMode;
  windowSize?: number;
  specWindow?: number;
};

type ParsedArgs = {
  options: CliOptions;
  targets: string[];
};

type AnalyzeFn = (
  source: string,
  options: CliOptions,
) => Promise<AnalysisResult>;

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
  let specModeExplicit = false;
  const options: CliOptions = {
    traceMode: DEFAULT_TRACE_MODE,
    speculationMode: DEFAULT_SPEC_MODE,
    specMode: DEFAULT_SPEC_RUN_MODE,
  };
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
        if (value === "dfs") {
          options.traceMode = "single-path";
          break;
        }
        if (value === "bfs" || value === "single-path") {
          options.traceMode = value;
          break;
        }
        throw new Error(
          `--trace-mode は 'bfs' | 'single-path' | 'dfs'(エイリアス) を指定してください (got: ${value ?? ""})`,
        );
      }
      case "--speculation-mode": {
        const value = maybeValue ?? argv[++i];
        if (value === "discard" || value === "stack-guard") {
          options.speculationMode = value;
          break;
        }
        throw new Error(
          `--speculation-mode は 'discard' | 'stack-guard' を指定してください (got: ${value ?? ""})`,
        );
      }
      case "--spec-mode": {
        const value = maybeValue ?? argv[++i];
        if (value === "legacy-meta" || value === "light") {
          options.specMode = value;
          specModeExplicit = true;
          break;
        }
        throw new Error(
          `--spec-mode は 'legacy-meta' | 'light' のみを受け付けます。rollback 挙動は --speculation-mode で指定してください (got: ${value ?? ""})`,
        );
      }
      case "--spec-graph-mode": {
        const value = maybeValue ?? argv[++i];
        if (value === "legacy-meta" || value === "light") {
          options.specMode = value;
          specModeExplicit = true;
          break;
        }
        throw new Error(
          `--spec-graph-mode は 'legacy-meta' | 'light' を指定してください (got: ${value ?? ""})`,
        );
      }
      case "--spec-window": {
        const value = maybeValue ?? argv[++i];
        const parsed = Number.parseInt(value ?? "", 10);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          throw new Error("--spec-window は正の整数で指定してください");
        }
        options.specWindow = parsed;
        break;
      }
      case "--window-size": {
        const value = maybeValue ?? argv[++i];
        const parsed = Number.parseInt(value ?? "", 10);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          throw new Error("--window-size は正の整数で指定してください");
        }
        options.windowSize = parsed;
        if (!specModeExplicit) {
          options.specMode = "legacy-meta";
        }
        break;
      }
      case "--help": {
        printUsage();
        process.exit(0);
        break;
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
  --trace-mode <bfs|single-path|dfs>  解析の探索戦略 (default: bfs)。dfs は single-path のエイリアス。
  --speculation-mode <discard|stack-guard>
                                   rollback 挙動を指定 (default: discard)
  --spec-mode <legacy-meta|light>   グラフ/投機長管理モードを指定 (default: light)
  --spec-graph-mode <legacy-meta|light>
                                   --spec-mode のエイリアス。グラフ/長さ管理モードだけを切り替えたい場合に使用。
  --spec-window <n>                light モード時の投機長 (default: 20)
  --window-size <n>                legacy(meta) ビルダーの投機ウィンドウの大きさ (default: VCFG builder デフォルト)
  --help                           このヘルプを表示

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

async function runSingleCase(
  filePath: string,
  options: CliOptions,
  analyzeFn: AnalyzeFn = (source, opts) => analyze(source, opts),
): Promise<boolean> {
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
    const result = await analyzeFn(source, {
      traceMode: options.traceMode,
      speculationMode: options.speculationMode,
      windowSize: options.windowSize,
      specMode: options.specMode,
      specWindow: options.specWindow,
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

const importMeta = import.meta as ImportMeta & { main?: boolean };

if (importMeta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { parseArgs, runSingleCase };
