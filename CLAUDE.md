# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SNI Visualizer is a research prototype for static analysis and visualization of Speculative Non-Interference (SNI) in MuASM programs. It combines VCFG (Virtual Control Flow Graph) with abstract interpretation to detect information leakage through speculative execution.

The system consists of three core components:
- **Web UI** (Next.js 16 + React 19): Visualizes analysis results with VCFG and abstract state display
- **VCFG Builder**: Parses MuASM and generates StaticGraph (currently only "light" mode with spec-begin metanodes)
- **SNI Engine**: Abstract interpretation engine that detects Leak violations

## Common Commands

### Development
```bash
bun install              # Install dependencies
bun dev                  # Start Next.js dev server at http://localhost:3000
bun build                # Build Next.js for production
```

### Testing
```bash
bun test                 # Run all tests with Vitest
bun test <path>          # Run specific test file
```

### Linting and Formatting
```bash
bun lint                 # Lint with Biome
bun lint:fix             # Fix linting issues
bun format               # Format code with Biome
```

### CLI Analysis
```bash
# Run all MuASM test cases (default: traceMode=bfs, specWindow=20)
bun run muasm:run

# Run with custom spec window
bun run muasm:run --spec-window 8

# Run with DFS (single-path) mode
bun run muasm:run --trace-mode single-path

# Run specific file or directory
bun run muasm:run path/to/file.muasm

# Show help
bun run scripts/run-muasm.ts --help
```

Test cases are located in `muasm_case/` with subdirectories:
- `muasm_case/handmade/`: Hand-crafted test cases
- `muasm_case/spectector_case/`: Cases from Spectector
- `muasm_case/Others/`: Additional test cases

## Repository Structure

```
app/                     # Web UI (Next.js pages and features)
  (analysis)/           # Main analysis page with visualization
    features/           # Feature modules (visualization, editor, controls, etc.)
lib/
  analysis-schema/      # Single source of truth for types (AnalysisResult, StaticGraph, etc.)
  analysis-engine/      # Facade that orchestrates VCFG Builder → SNI Engine
vcfg-builder/           # VCFG generation from MuASM source
  lib/                  # Core graph building logic
  tests/                # Unit and integration tests
sni-engine/             # Abstract interpretation and SNI verification
  lib/
    analysis/           # Main analysis orchestration
    core/               # State operations, lattice, observations
    semantics/          # Instruction semantics (apply, eval, parse)
  tests/                # Comprehensive test suite
muasm-ast/              # MuASM AST type definitions
scripts/                # CLI tools (run-muasm.ts)
```

## Architecture

### Component Responsibilities

**lib/analysis-schema/** (Shared Contract)
- Defines the contract between all components
- Core types: `AnalysisResult`, `StaticGraph`, `GraphNode`, `GraphEdge`, `ExecutionTrace`, `AbstractState`
- Schema version: Currently 1.2.0
- **Never modify these types without understanding cross-component impact**

**vcfg-builder/** (Static Structure)
- Input: MuASM source code (string)
- Output: `StaticGraph` (nodes + edges)
- Parses MuASM to AST and builds control flow graph
- Currently only supports "light" mode (spec-begin metanodes only, no rollback/spec-end)
- Each node has `type: "ns" | "spec"` to distinguish normal vs speculative paths

**sni-engine/** (Dynamic Analysis)
- Input: `StaticGraph` + `AnalyzeOptions` (traceMode, specWindow)
- Output: `AnalysisResult` (trace, violations, final result)
- Runs abstract interpretation over the graph
- Maintains abstract state (registers, memory, observations) with security lattice (Low/High/Leak)
- Two trace modes:
  - `bfs`: Breadth-first exploration
  - `single-path`: Single path exploration (DFS-like)
- Uses specWindow to limit speculative execution depth in light mode

**lib/analysis-engine/** (Facade)
- Coordinates VCFG Builder → SNI Engine pipeline
- Catches and formats errors for UI consumption
- Entry point for both Web UI and CLI

**app/** (Presentation)
- Pure visualization and user interaction
- Two-pane layout: left (controls/VCFG), right (editor/state viewer)
- Uses React Flow + ELK for graph layout
- **Never add analysis logic here** - UI should only consume `AnalysisResult`

### Key Boundaries

**Static vs Dynamic**: vcfg-builder creates the "map" (static structure), sni-engine computes the "journey" (dynamic properties like which paths were taken and variable values).

**UI vs Engine**: UI treats the engine as a black box function `analyze(code) -> Result`. The engine knows nothing about React, DOM, or how results are displayed.

**Schema as Contract**: All inter-component data flows through types defined in `lib/analysis-schema/`. Changing these affects all components.

## Testing Strategy

- **Unit tests**: Each component (vcfg-builder, sni-engine) has comprehensive unit tests
- **Integration tests**: `lib/analysis-engine/tests/` validates the full pipeline
- **Test location**: Tests live in `tests/` subdirectories within each component
- **Test framework**: Vitest with globals enabled
- **Path alias**: `@` resolves to project root (configured in vitest.config.ts and tsconfig.json)

When writing tests:
- Use `import { describe, it, expect } from "vitest"` or rely on globals
- Place tests close to the code they test
- Use the `@/` path alias for imports

## MuASM Language

MuASM is a simple assembly-like language for testing speculative execution security. Key instructions:
- `load dest, src`: Load value from memory/register
- `store dest, src`: Store value to memory
- `beq reg, imm, label`: Branch if equal
- `fence`: Memory fence
- `spec`: Begin speculation
- Comments: `//` or `#`

The VCFG builder parses MuASM into a structured AST (`muasm-ast/`) and attaches it to graph nodes as `instructionAst` for the SNI engine to use.

## Current Analysis Parameters

- **traceMode**: `bfs` (breadth-first) or `single-path` (single path)
- **specWindow**: Speculation depth limit (default: 20)
- **VCFG mode**: Currently fixed to "light" (spec-begin metanodes only)

Note: Policy input UI is not yet implemented (can be set via code/CLI).

## Important Documentation

- `doc/architecture.md`: Detailed component responsibilities and boundaries
- `doc/project.md`: Project overview and document map
- `doc/theory/`: Theoretical background (SNI definitions, proofs)
- `README.md`: User-facing overview and setup instructions

## Development Notes

- **Runtime**: This project uses Bun as the runtime and package manager
- **Framework**: Next.js 16 with React 19 (using React Server Components where appropriate)
- **Styling**: Tailwind CSS 4 with custom animations
- **Graph visualization**: @xyflow/react with ELK layout algorithm
- **Code quality**: Biome for linting and formatting (not ESLint/Prettier)
- **Japanese comments**: Many comments and documentation are in Japanese - this is intentional as the research team works in Japanese

When adding new features:
1. Check if it affects the schema (`lib/analysis-schema/`) - if so, update all consumers
2. Keep analysis logic in vcfg-builder/sni-engine, not in the UI
3. Add tests for new functionality
4. Follow existing patterns for state management and data flow
