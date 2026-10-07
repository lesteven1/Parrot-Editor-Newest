# Base V0.3.1.motion Scratch-to-Python examples

These generated projects exercise the selected Scratch editor, converter, and both runtimes:

1. `arrow-key-walker.sb3` — both outputs start Walker at `(0, 0)` and move it five Scratch units per frame while the left/right arrow keys are held.
2. `repeat-move.sb3` — both outputs start Walker at x `-200`, then animate 20 horizontal steps of 20 units to finish at x `200`.
3. `target-visibility.sb3` — Walker remains visible away from Target and hides whenever its rendered pixels touch Target.
4. `variables-and-operators.sb3` — exercises variables, x/y reporters, arithmetic, comparisons, and Boolean nesting; both outputs finish with `score = 12` and Walker at `(-40, 0)`.
5. `edge-reset.sb3` — Walker goes to x `220`, detects the stage edge, then returns to x `0` and remains visible.
6. `motion-complete.sb3` — covers movement, direction wrapping, target menus, cooperative glides, pointing, all rotation styles, edge bounce, and the direction reporter.
7. `available-blocks-showcase.sb3` — combines all 43 blocks currently supported by Parrot in one interactive project. Move the default Scratch cat with all four arrow keys while the Apple curves and bounces around the stage; movement and collisions update the visible score monitor.

Rebuild the binary fixtures with `pnpm examples:build`. Run `pnpm converter:check` to confirm that the seven projects cover all 43 supported opcodes, convert without warnings, produce bounded Motion state, and render live Pygame frames at both clocks.

## Long-run parity projects

`examples/parity/` contains deterministic `.sb3` projects used by the real Scratch VM/Pygame comparison harness:

1. `long-turn-move-bounce.sb3` — repeatedly turns 15 degrees, moves 20 steps, and bounces at an edge, matching the reported reproduction.
2. `long-vector-costume-bounce.sb3` — repeats that path with an irregular SVG costume so edge detection exercises Scratch Render's actual convex hull.
3. `long-coordinate-reporters.sb3` — combines x/y setters, changers, reporters, comparisons, and conditional resets.
4. `long-target-rotation.sb3` — combines point-towards, turning, movement, edge bounce, and rotation style.
5. `long-glide-cycle.sb3` — continuously glides between fixed coordinates to expose accumulated clock drift.
6. `long-target-glide.sb3` — combines target menus, go-to, direction, movement, target gliding, and left turns.
7. `long-idle-key-loop.sb3` — reproduces an arrow-key forever loop whose false conditions request no redraw; scheduled right/left input verifies both movement and idle frames.

Run `pnpm parity:check` for a focused test. It loads every project into the actual Scratch VM/Render stack, converts and runs it in Python/Pygame, then compares Walker's x, y, and direction after every one of 1,200 coordinated frames. `pnpm converter:check` includes the same parity pass. To diagnose one local project, set `PARROT_PARITY_PROJECT` to its `.sb3` path; the focused run also schedules right/left arrow input.
