# Parrot contributor instructions

## Product boundary

Parrot 0.4 integrates the V0.3 Scratch-to-Python workflow into a VS Code-inspired multi-file editor. It imports native folders, presents nested Explorer trees, displays Scratch and Python side by side, supports explicit one-to-one file connections, and runs multiple independent or connected sessions.

The conversion boundary remains the 43 opcodes supported by Parrot Base V0.3.1.motion. The full Scratch GUI may display blocks outside that subset, but Parrot must not imply that every visible Scratch block converts. Broader block compatibility, durable filesystem editing, standalone packaging, cloud features, lessons, and hardened execution remain outside this phase.

## Stack

- Electron for the desktop process, native folder selection, workspace validation, and supervised Python execution.
- React and TypeScript for the renderer shell.
- Monaco Editor for learner-visible Python source.
- Official Scratch GUI, VM, Render, Storage, and SVG Renderer packages for Scratch editing and execution.
- A bundled `parrot.py` compatibility runtime backed by Pygame-CE.
- pnpm 11 as the package manager.

## Commands

- `corepack pnpm install` — install dependencies.
- `corepack pnpm dev` — launch the Electron development app.
- `corepack pnpm typecheck` — run strict TypeScript checks.
- `corepack pnpm workspace:check` — test focused shell and view behavior.
- `corepack pnpm tabs:check` — test tabs, connections, Run selection, and output layouts.
- `corepack pnpm explorer:check` — test folder scanning, nesting, filtering, and local ordering.
- `corepack pnpm scratch-gui:check` — test Scratch integration, fitting, fullscreen exit, and bundled costumes.
- `corepack pnpm python:check` — test Python discovery and concurrent session bounds.
- `corepack pnpm converter:check` — verify opcode coverage, conversion, runtime clocks, and parity.
- `corepack pnpm build` — typecheck and build production bundles.

## Conventions

- Keep Electron's renderer sandboxed with context isolation enabled and Node integration disabled.
- Expose the smallest possible typed preload API.
- Keep selected paths, runtime paths, and process handles out of the renderer; use opaque workspace, file, project, and session IDs.
- Scan folders in the main process. Enforce entry and depth bounds, ignore `.DS_Store`, reject path escape, and revalidate files before opening them.
- Treat Monaco source as untrusted project state and execute the exact visible text. Never interpolate it into a shell command.
- Keep runtime metadata and assets separate from learner source and private to the runtime session.
- Keep every Scratch GUI instance and Python process independently owned so one file cannot stop or blank another file's stage.
- Preserve one-to-one Scratch/Python connections. A connection may contain exactly one `.sb3` and one `.py` file.
- Renderer-only duplication, generation, and drag ordering must not write to or rearrange the user's imported folder.
- Keep Editor View limited to one file or one connected pair. Keep Output View stage-only, gapless, ordered, and bounded to eight visible panels per page.
- Add future opcodes through the focused event, statement, and reporter registries, with fixture coverage and runtime helpers only where Scratch semantics require them.
- Keep all shell text in SF Pro Text while leaving Scratch GUI and Monaco typography native.
- Use the vendored Microsoft VS Code icon set for Parrot shell actions and preserve its notices.

## Definition of done

Before calling work complete, verify:

1. `typecheck`, `workspace:check`, `tabs:check`, `explorer:check`, `scratch-gui:check`, `python:check`, `converter:check`, and `build` pass.
2. The app opens on an empty editor shell and imports folders only through Explorer.
3. Nested folders collapse correctly, `.DS_Store` stays hidden, and filesystem paths never reach the renderer.
4. Opening the first program selects Editor View. One standalone file or one connected pair can be displayed without remounting unrelated runtimes.
5. Output View displays every project file in order, shows no more than eight panels per page, and pages by one project width.
6. Linking accepts only one Scratch and one Python file; unlinking releases both without deleting either.
7. Duplicate and generated-adjacent files appear directly under their source in the same Explorer folder and remain renderer-only.
8. Run selection starts or resumes selected files, pauses only newly unselected files, and never stops an adjacent program implicitly.
9. Multiple standalone and connected programs can run concurrently with bounded independent sessions.
10. Monaco edits change the next Python run. Refresh regenerates from the connected live Scratch project and clearly replaces that Python source.
11. The official Scratch GUI keeps a visible exit-fullscreen action and fits its full editor and 4:3 stage inside both supported pane sizes.
12. All seven showcase projects cover all 43 supported opcodes without warnings; all seven deterministic parity projects match x/y/direction for 1,200 frames.
13. Python alone remains approximately 60 Hz; coordinated mode presents matching Scratch/Python numbered frames with backpressure.
14. Generated learner source contains project logic but no runtime classes, frame protocol, serialized manifest, or embedded assets.
15. Python can be paused, resumed, stopped, restarted, and exported without exposing a path or process handle; output and errors remain bounded.
16. Layout remains usable at 1280x720 and 1920x1080 with no new Electron or browser console errors.
