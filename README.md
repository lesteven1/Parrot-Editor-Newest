# Parrot 0.4

Parrot is a local desktop editor that helps Scratch learners move from blocks to readable Python. It combines the official Scratch GUI, Monaco Editor, and a supervised Pygame-CE runtime in one VS Code-inspired workspace.

Version 0.4 focuses on the editor workflow: import a project folder, inspect nested files, open a connected Scratch/Python pair, update generated Python from the live Scratch project, and run programs independently or together. The converter remains intentionally limited to the 43 opcodes supported by the V0.3.1 Motion phase; Parrot does not claim full Scratch-to-Python compatibility.

## What is included

- A native folder picker and Explorer with nested folders, collapse controls, local drag reordering, and `.DS_Store` filtering.
- The official Scratch GUI with its local costume library and a Parrot-owned exit-fullscreen control.
- Monaco Editor for learner-visible Python. The exact source shown in Monaco is the source Electron executes.
- Editor View for one file or one connected Scratch/Python pair.
- Output View for up to eight stage panels, with project-width paging when more content is available.
- Explicit one-to-one connections between one `.sb3` file and one `.py` file, shown with flat color markers.
- Tab actions for duplicating Scratch projects, generating adjacent Python, linking or unlinking compatible files, refreshing generated Python, and closing files.
- A Run checklist that can start, pause, resume, restart, and stop files without coupling unrelated runtime sessions.
- Independent Scratch and Python execution plus coordinated frame-by-frame comparison for a connected pair.
- A reusable Python runtime that keeps scheduling, rendering, input, collision behavior, assets, and frame transport out of learner source.

Search, Settings, and the top-level View surface that is not part of the Editor/Output toggle remain placeholders by design.

## Supported conversion scope

Parrot currently converts this bounded Scratch subset:

- Events: green flag.
- Control: forever, repeat, if, and if/else.
- Motion: the complete standard Scratch 3 sprite Motion category.
- Sensing: key pressed and touching sprite/edge.
- Operators: arithmetic, comparisons, and Boolean operators.
- Variables: reporter, set, and change.
- Looks: show and hide.

Unsupported blocks produce explicit warnings. Motion blocks attached to the Stage are skipped rather than given invented semantics. Other blocks may be visible in Scratch GUI, but visibility does not mean conversion support.

## Requirements

- Node.js with Corepack.
- pnpm 11 (declared in `package.json`).
- Python 3 with Pygame-CE for Python output.
- macOS is the primary tested desktop target for the current Electron shell.

Install and run:

```bash
corepack pnpm install
python3 -m pip install pygame-ce
corepack pnpm dev
```

If `pnpm` is already installed, the `corepack` prefix is optional.

## Using the editor

1. Start Parrot. The initial window is an empty editor shell.
2. Select Explorer and use the folder button to import a folder from your computer.
3. Open an `.sb3` or `.py` file. Existing same-name Scratch/Python files in one folder are paired automatically; files can also be linked from their tabs.
4. Use View to switch between Editor View and Output View.
5. Use Run to select files. Selecting a paused file resumes it; unselecting a running file pauses only that file. **Start running** restarts the selected programs from their initial state.
6. Use Refresh on a connected Python tab to regenerate Python from the current Scratch VM project. This intentionally replaces that Monaco document.

Creating, duplicating, linking, and drag-reordering files currently changes Parrot's in-memory workspace only. It does not rename, move, or create files in the imported desktop folder.

## Verification

Run the full project checks before shipping:

```bash
corepack pnpm typecheck
corepack pnpm workspace:check
corepack pnpm tabs:check
corepack pnpm explorer:check
corepack pnpm scratch-gui:check
corepack pnpm python:check
corepack pnpm converter:check
corepack pnpm build
```

`converter:check` verifies all 43 supported opcodes and includes seven deterministic Scratch/Python parity projects. Each parity project compares x, y, and direction for 1,200 coordinated frames.

## Architecture

```text
native folder selection
  -> main-process workspace scan and validation
  -> opaque workspace/file identifiers
  -> Scratch GUI + Monaco editor sessions
  -> declarative Scratch block conversion
  -> readable Python project logic
  -> private manifest/assets + bundled parrot.py runtime
  -> supervised Python/Pygame process and bounded frame stream
```

Electron owns filesystem access, imported project records, runtime bundles, native dialogs, and Python processes. The sandboxed renderer receives typed data and opaque IDs rather than selected paths or process handles. Runtime compatibility lives in `src/main/python/parrot.py`; learner source contains project logic only.

This is supervised local execution, not a hardened security sandbox for hostile Python. Do not run untrusted learner source without an operating-system isolation layer.

## Repository layout

- `src/main/` — Electron main process, workspace store, converter, and Python supervision.
- `src/preload/` — the minimal typed renderer API.
- `src/renderer/` — React shell, Explorer, Scratch integration, Monaco, stages, and runtime coordination.
- `src/shared/` — IPC and project types shared across process boundaries.
- `resources/scratch-library/` — bundled offline Scratch costume assets.
- `examples/` — generated conversion and deterministic parity fixtures.
- `scripts/` — fixture builders and automated verification.
- `docs/` — product behavior and technical decisions.
- `design/` — current interface design direction and source-reference notes.

## Project boundary

Parrot 0.4 is an editor integration milestone. Broader Scratch category conversion, durable writes back to imported folders, packaged application distribution, accounts, cloud sync, collaboration, lessons, and a hardened Python sandbox remain future work.

See [the product specification](docs/product-spec.md), [technical decisions](docs/technical-decisions.md), and [0.4 release scope](base-v0.4.md) for more detail.
