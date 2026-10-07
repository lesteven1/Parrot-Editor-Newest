# Parrot 0.4 design direction

The 0.4 interface uses a light, dense, VS Code-inspired shell around the official Scratch GUI and Monaco Editor.

## Shell rules

- Parrot-owned text uses SF Pro Text. Scratch GUI and Monaco keep their native typography.
- Parrot actions use the vendored Microsoft VS Code icon set under `src/renderer/src/assets/vscode-icons/`.
- Scratch green-flag and stop assets remain visually native to Scratch.
- The top bar always preserves View and Run and aligns naturally when macOS traffic lights disappear in fullscreen.
- Explorer and adjacent file-tab headers share a height and right action guide.
- Connection state uses flat color circles; Python synchronization uses a separate flat green circle.
- Hover targets cover the full intended action area without introducing animated layout shifts.

## Workspace rules

- Editor View shows one file or one connected pair and gives the official Scratch GUI the full available Scratch pane.
- Output View is stage-only, gapless, and uses deterministic grids for one through eight panels.
- Scratch stages retain 4:3 geometry and remain fully visible, including their right edge.
- Each file tab keeps identity and controls in one bar. Controls remain compact, aligned, accessible, and sourced from the same icon system.
- Closing or linking a file must not blank or remount another Scratch stage.

## Reference material

Historical PDFs, screenshots, and RTF briefs informed earlier phases but are not required to build the repository. The current product behavior is defined by `README.md`, `base-v0.4.md`, `docs/product-spec.md`, and `docs/technical-decisions.md`.
