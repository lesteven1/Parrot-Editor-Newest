# Parrot 0.4 technical decisions

## Process boundary

Electron remains responsible for capabilities that should not exist in the renderer: native folder selection, canonical path handling, workspace records, Scratch archive validation, conversion bundles, Python processes, temporary runtime directories, and native export dialogs.

The BrowserWindow keeps context isolation and renderer sandboxing enabled with Node integration disabled. Preload exposes a minimal typed `ParrotApi`. Selected paths and process handles are never returned. Workspace, file, runtime-project, and process session identifiers are opaque.

## Workspace import

`src/main/workspace-store.ts` scans a selected folder into a bounded tree. The scan:

- resolves the canonical root;
- ignores `.DS_Store`;
- limits visible entries to 5,000 and nesting to 32 levels;
- classifies `.sb3`, `.py`, and other files;
- records size and modification time;
- pairs same-stem Scratch/Python files found in one folder;
- stores real paths only in the main process.

Opening a file re-resolves its canonical path, verifies containment under the imported root, and checks that size and modification time did not change. A changed file requires reimport. This prevents a stale renderer ID from resolving to a replaced or escaped path.

Explorer collapse, drag ordering, virtual duplicates, and generated-adjacent placement are renderer state. They intentionally do not mutate the user's folder. This keeps the 0.4 filesystem boundary simple and recoverable.

## Editor state and file connections

The focused renderer owns projects, tabs, visible file IDs, connection records, synchronization state, and per-tab runtime objects. A connection is atomic and always contains one Scratch tab and one Python tab. Reconnecting releases previous partners first. Closing a file disconnects its partner but does not remove the partner.

Runtime identity is keyed to the file tab rather than the connection. Linking or unlinking therefore does not remount Scratch's WebGL renderer or replace unrelated stage state. Every Scratch tab owns its VM/render lifecycle; every running Python tab owns a supervised session ID.

Editor View derives at most one selected file or one connected pair. Output View derives ordered stage panels from the full project and uses fixed one-through-eight grid templates. Pagination advances by one project-width boundary rather than an arbitrary pixel increment.

## Scratch GUI integration

`ScratchGuiAdapter` is the integration boundary for official Scratch GUI packages. It exposes the local Code, Costumes, and Sounds editor while Parrot retains ownership of surrounding tabs and controls.

Stage fitting always preserves 4:3 geometry. The full Scratch surface scales into tall and wide panes, and Parrot provides its own normal-screen action whenever Scratch fullscreen is active. Scratch instances are released on tab teardown so WebGL resources do not leak, but snapshot or connection updates for the same tab do not reload the VM.

The complete costume metadata and unique asset set live under `resources/scratch-library/`. Development and production resolve thumbnails and selected costumes through the same offline-first asset store. The fetch script is maintenance tooling; normal use and production builds do not depend on downloading the library at runtime.

## Conversion pipeline

The declarative converter under `src/main/converter/` remains the source of Python generation:

- `archive.ts` validates and parses `.sb3` archives.
- `runtime-manifest.ts` separates runtime metadata and bounded assets.
- `block-input.ts` resolves Scratch field/input serialization.
- `block-traversal.ts` walks linked stacks and detects invalid references or cycles.
- `events.ts`, `statements.ts`, and `reporters.ts` contain focused opcode registries.
- `python-generator.ts` composes readable learner source.
- `index.ts` coordinates parse, generation, and runtime-bundle results.

New opcode support must stay explicit in the product boundary, use the appropriate registry, add runtime helpers only where Python cannot preserve Scratch semantics directly, and include generated fixture coverage.

## Exact-source execution

Monaco text is authoritative. A Python start request contains the exact visible source, display name, opaque runtime-project ID, and clock mode. Electron resolves the private bundle and creates a mode-0700 temporary session containing source, the fixed launcher, `parrot.py`, manifest, and bounded assets.

Python is invoked with an argument array and `shell: false`; learner source is never shell input. Runtime paths are redacted before IPC. Stop removes the private session after escalating through protocol stop, TERM, and KILL when necessary.

Python discovery prefers an explicitly configured candidate, removes duplicates, and verifies that the selected interpreter can import Pygame. Concurrent sessions are independently tracked and bounded.

## Pause, resume, restart, and stop

The Run checklist distinguishes selection from restart:

- adding a paused running session to the selection changes its clock back to active;
- removing a running session changes only that session to paused;
- **Start running** intentionally stops/recreates selected sessions;
- a single-file stop targets only that file's VM or process.

Clock mode is authoritative. A late Python `started` event must not overwrite a user-requested paused state. When a process stops, its internal clock state resets so a later run starts cleanly.

Connected execution uses one universal coordinator. It captures one input snapshot for frame N, requests Python frame N, advances Scratch once with the same snapshot, and presents the pair before requesting N+1. Only one frame is in flight. Geometry is transmitted once when required for Scratch-compatible fencing and bounce behavior.

## Update Code

Refresh is valid only for a connected Scratch/Python pair whose Scratch VM is ready. It stops the affected execution, serializes the current live Scratch project, validates and converts that snapshot in Electron, and replaces only the connected Python tab's source and runtime bundle. Other pairs and standalone files remain untouched.

Editing either side marks generated Python stale. A successful refresh marks it current. The synchronization marker is separate from the connection color because the two states answer different questions.

## Verification strategy

Fast Node test suites cover pure workspace, Explorer, tab, connection, run-selection, view-layout, Scratch integration, and Python discovery behavior. Converter checks run every generated example through both clocks and verify all 43 supported opcodes. The parity harness runs seven deterministic projects in the real Scratch VM/Render stack and Python/Pygame for 1,200 coordinated frames each.

The production build packages the official Scratch GUI, vendored shell icons, and the local costume library. Build-time warnings from upstream Scratch bundles about dynamic evaluation are dependency diagnostics; application code keeps the renderer sandbox boundary in place.

## Known security limitation

Opaque IDs, validation, bounded messages, fixed process spawning, isolated runtime directories, and cleanup reduce exposure. They do not make editable Python safe against a hostile local author. A hardened OS sandbox and signed packaged runtime remain future work.
