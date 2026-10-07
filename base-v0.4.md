# Parrot 0.4 release scope

Parrot 0.4 integrates the V0.3.1 Motion conversion/runtime into a VS Code-inspired multi-file editor while preserving the official Scratch GUI.

## Editor shell

- Empty editor landing state before a folder is imported.
- Native folder import through Explorer, nested folders, collapse controls, and `.DS_Store` filtering.
- Local-only drag reordering, duplicates, and generated adjacent Python placement.
- SF Pro Text for the shell and vendored Microsoft VS Code icons for shell actions.
- Search and Settings remain placeholders.

## Files and views

- Multiple Scratch and Python programs in one project, bounded to eight open project files.
- Explicit one-to-one Scratch/Python connections with shared flat color markers.
- Editor View for one standalone file or one connected pair.
- Gapless Output View grids for one through eight stages with project-width paging.
- Tab controls for close, duplicate, generate adjacent Python, link/break, refresh, and execution where valid.

## Scratch and Python

- Official Scratch GUI with local costumes and a reliable Parrot-owned normal-screen action.
- Monaco source remains the exact Python source executed.
- Refresh regenerates one connected Python file from its live Scratch project.
- Independent bounded runtime sessions allow standalone files and multiple pairs to run concurrently.
- Run checklist selection pauses and resumes files independently; **Start running** restarts selected files.

## Compatibility boundary

The converter still supports the 43 opcodes defined by the V0.3.1 Motion phase. Other Scratch categories may appear in the official GUI but are not promised to convert. Durable filesystem writes, standalone packaging, learning content, accounts, collaboration, and hardened Python isolation remain future work.

## Verification

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

The converter suite covers all 43 supported opcodes. Seven deterministic parity projects compare Scratch and Python x/y/direction state for 1,200 coordinated frames each.
