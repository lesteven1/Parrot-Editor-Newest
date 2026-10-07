# Parrot 0.4 product specification

## Purpose

Parrot helps learners translate concepts they know from Scratch into readable Python. It presents the official Scratch editor and Monaco side by side, lets users connect a Scratch project to one Python file, and provides comparable Scratch and Pygame stages.

Version 0.4 is an editor-workflow release. It brings the proven V0.3.1 Motion converter/runtime into a multi-file desktop shell without expanding the converter beyond its 43 supported opcodes.

## Product boundary

Included:

- Local folder import and bounded nested-folder discovery.
- Scratch and Python editing.
- Explicit Scratch/Python file connections.
- Editor and Output workspace modes.
- Independent and coordinated execution.
- Python regeneration from a connected live Scratch project.
- Offline Scratch costume assets.

Not included:

- General Scratch compatibility beyond the documented subset.
- Writing virtual files, connections, names, or Explorer ordering back to disk.
- Accounts, cloud storage, collaboration, lessons, or telemetry.
- Standalone application export.
- Hardened operating-system isolation for arbitrary Python.

## Application shell

The app opens to an empty light editor shell. The top bar keeps View and Run available at all times. Explorer, Search, and Settings are the only activity-bar destinations; Search and Settings are placeholders.

Explorer is the folder control surface. Its folder action opens a native folder picker. Importing a folder creates a project root and preserves nested folders. Folder disclosure hides all descendants without discarding them. `.DS_Store` does not appear. Closing a project removes it from the current in-memory workspace but does not delete it from disk.

The renderer may reorder sibling files for presentation. Dragging never moves files between folders or changes the desktop filesystem. Duplicated Scratch files and generated adjacent Python files appear immediately below the source in the same displayed folder.

## Files and connections

Parrot opens `.sb3` and `.py` files. Other files may appear in Explorer but are not editable in this release.

Opening the first file switches to Editor View. A matching `.sb3` and `.py` stem found in the same imported folder may be connected automatically. Users can also start linking from a file tab; compatible targets temporarily expose a **Link** action. A valid connection contains exactly one Scratch file and one Python file. Connecting or disconnecting never deletes either file.

Unconnected files show no connection marker. Connected pairs share one flat color marker in Explorer and on relevant file tabs. Python also has a separate flat green synchronization marker when its generated source matches the connected Scratch project.

Scratch tabs expose duplicate, generate-adjacent-Python, link/break, and close actions. Python tabs expose link/break, synchronization state, run/stop, refresh, and close actions where applicable. Refresh serializes the current Scratch VM project, validates and converts it in Electron, replaces the connected Monaco source, and updates its private runtime bundle.

## Workspace modes

### Editor View

Editor View displays a maximum of two files: one standalone file or one connected Scratch/Python pair. Scratch receives the full official GUI. Python receives Monaco. Each pane owns its own tab and runtime state. Closing a displayed tab leaves its file available in Explorer.

### Output View

Output View automatically displays project stages in file order. It is stage-only: no full Scratch workspace and no Monaco editor. Panels form a gapless row-major grid. One through eight panels use deterministic layouts; no more than eight are visible on one page. When additional project content is available, a right-side arrow advances by one project-width page.

Scratch output tabs include file type, filename, connection marker, green flag, stop, refresh where valid, and close. Python output tabs include file type, filename, connection marker, synchronization marker, start/stop, refresh, and close.

## Run model

Run is a checklist rather than a separate control board.

- Opening Run preselects files already running.
- In Editor View, currently displayed files are selected by default.
- In Output View, all files in displayed projects are selected by default.
- Selecting a paused file resumes it.
- Unselecting a running file pauses only that file and preserves its process/session state.
- **Start running** restarts all selected programs from their initial state.
- Stopping one file never stops a connected or adjacent file unless the user explicitly stops that file too.
- Independent files and multiple connected pairs may run concurrently within the bounded session limit.

Scratch's green flag and stop controls operate its own VM. Python start/stop controls operate its own supervised process. Coordinated execution for a connected pair advances Scratch and Python through the same numbered logical frames with one frame in flight and backpressure from the slower side.

## Scratch integration

Parrot embeds the official Scratch GUI with Code, Costumes, and Sounds. The complete local costume manifest and unique assets are bundled for offline-first use. The full editor scales to the available pane while preserving the Scratch stage's 4:3 geometry. Both Scratch stage size modes fill the available Parrot pane naturally.

When Scratch enters fullscreen, a Parrot-owned normal-screen action remains available so the user cannot become trapped in fullscreen.

## Converter scope

Supported blocks:

- Green-flag events.
- Forever, repeat, if, and if/else.
- Complete standard Scratch 3 sprite Motion.
- Key-pressed and touching sprite/edge sensing.
- Arithmetic, comparison, and Boolean operators.
- Variable report/set/change.
- Show and hide.

Unsupported blocks create explicit bounded warnings. Stage Motion blocks are skipped with a warning.

Generated Python imports the reusable `parrot` runtime, declares readable sprites and variables, registers asynchronous green-flag handlers, expresses project logic, and calls `project.run()`. It does not contain runtime classes, frame transport, serialized manifests, or embedded assets.

## Runtime and security boundary

Electron owns native selection, path resolution, `.sb3` validation, runtime manifests/assets, Python process handles, temporary paths, and save dialogs. The renderer receives opaque IDs and bounded typed payloads.

Before a workspace file is opened, Electron confirms it is still inside the imported root and that its size and modification time match the scan. Scratch archives are validated before conversion. Python is started with a fixed executable, fixed arguments, `shell: false`, a minimal environment, and bounded source, frame, and log sizes.

This supervision reduces accidental exposure and command injection. It is not a hardened sandbox for malicious local Python.

## Completion criteria

- All commands documented in the repository README pass.
- Folder import, nested collapse, `.DS_Store` filtering, and path containment work.
- Editor View and all one-through-eight Output View layouts behave deterministically.
- Connections remain one Scratch to one Python and color markers stay consistent.
- Independent pause/resume/stop/restart behavior works across simultaneous sessions.
- Scratch fullscreen always has an exit route and the full GUI fits supported panes.
- All 43 opcodes are covered and all seven deterministic parity projects match for 1,200 frames.
- Production bundles build with no new application-console errors at 1280x720 and 1920x1080.
