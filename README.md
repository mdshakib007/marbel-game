# Marbel — the cave game

A browser game of the classic Bangladeshi childhood marble game: lob your
marble at the cave, flick it in to win the **power**, then knock your rival's
marble away. Version 1 is single player against a computer opponent.

Built with [three.js](https://threejs.org) and a custom physics engine
(no physics library) so that marbles roll, slide, bounce, drop into the cave
and skip over it the way real glass marbles do on packed dirt.

## Run it

```bash
npm install
npm run dev        # then open http://localhost:5173
```

Other commands:

```bash
npm test           # headless physics + rules tests (node:test)
npm run build      # production build into dist/
npm run preview    # serve the production build
```

Add `?debug=1` to the URL for a debug panel (force a marble to break on the
next hit, teleport both marbles next to the cave, give yourself the power,
let the computer play both sides, slow motion).

## How to play

1. **Opening** — both players lob their marble from the chalk line at the
   cave. Whoever ends closest to (or inside) the cave moves first.
2. **Without the power** you can only flick weakly: the marble does not go far.
   Get it into the cave to win the power.
3. **With the power** you flick hard. Use it to knock the computer's marble
   away so it cannot reach the cave.
4. **Points** — any contact with the other marble scores by how hard the hit
   was: soft touch 1, solid hit 2, hard hit 3, smash 4. If the victim had the
   power they lose it (and 1 point, if they have any) and must enter the cave
   again. A scoring hit also earns you another shot.
5. **Safe in the cave** — a marble resting inside the cave is safe: touching
   it scores nothing unless it is knocked out of the cave. At the start of its
   owner's turn it is lifted to the rim, facing the opponent.
6. **Breakage** — very rarely (0.001 %) a hit shatters one of the two marbles.
   Its owner lobs a fresh marble from the line, without the power.
7. **Winning** — choose a target score at the start (first to reach it wins)
   or play just for fun and end the game from the menu.

## Controls

| Action | Mouse / keyboard | Touch |
| --- | --- | --- |
| Aim and shoot | press on your marble, drag back (slingshot), release | same |
| Lob angle (opening throw) | mouse wheel while aiming, or ↑ / ↓ | slider |
| Position on the line | slider | slider |
| Look around | drag anywhere else, or right-drag; ← → to orbit | one-finger drag |
| Zoom | mouse wheel, + / − | pinch |
| Top view | T or the top-view button | button |
| Sound | M or the speaker button | button |
| Menu / pause | Esc or the menu button | button |

## Marbles

Three sizes — small (13 mm), medium (16 mm, the popular one) and big
(25 mm). Bigger marbles are heavier: they hit harder and are harder to move,
but a finger flicks them a little slower. Five glass styles (cat's eye, swirl,
galaxy, clear, opal) in eight colours.

## Physics notes

- Marbles are solid glass spheres with real mass (`4/3 π r³ × 2500 kg/m³`),
  linear velocity and spin.
- The yard is an uneven heightfield (seeded noise, choose a different "yard"
  in the setup) with a worn dish around the cave; the cave is an analytic bowl
  one inch deep. A marble of radius `r` rolls on the offset surface of the
  terrain, so a big marble sits higher in the cave than a small one.
- Rolling resistance, kinetic friction during sliding (a flicked marble skids
  for a few centimetres before it rolls), quadratic air drag, restitution and
  "plowing" losses when a lobbed marble lands on dirt, marble–marble impulses
  with restitution and friction, brick walls around the yard.
- Everything is deterministic; the computer plans its shots by simulating
  candidate flicks with the very same code and then adds a human-like aiming
  error depending on the difficulty.

## Project layout

```
index.html            page and HUD markup
src/config.js         all tunable constants (sizes, physics, scoring, AI levels)
src/terrain.js        heightfield + cave, offset surface for a rolling sphere
src/physics.js        marble dynamics, collisions, sleeping
src/game.js           rules and turn flow (no DOM / three.js)
src/ai.js             computer player (simulation-based planner)
src/audio.js          synthesised sound effects
src/input.js          pointer / wheel / keyboard
src/ui.js             HUD, setup, menus, toasts
src/main.js           wires everything together
src/render/           three.js scene, marbles, effects, aim guide, camera
test/                 node:test suites for physics and rules
```
