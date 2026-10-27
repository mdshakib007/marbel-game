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

## Deploy to Vercel

The game is a static Vite site, so Vercel needs no configuration beyond the
included `vercel.json` (framework Vite, `npm run build`, output `dist/`).

- **From GitHub:** on vercel.com choose *Add New → Project*, import this
  repository, keep the detected settings and press *Deploy*. Every push to
  `main` then redeploys automatically.
- **From the terminal:** `npx vercel` (first time: log in and accept the
  defaults), then `npx vercel --prod` for the production URL.

Nothing else is required: there is no server, no database and no
environment variable. The Bangla/English auto-detection calls ipwho.is from
the browser over HTTPS, which works on a Vercel domain.

## How to play

1. **Opening** — both players lob their marble from the chalk line at the
   cave. Whoever ends closest to (or inside) the cave moves first.
2. **Without the power** you can only flick weakly: the marble does not go far.
   Get it into the cave to win the power. Entering the cave earns no points,
   but whoever enters the cave moves next (the marble is lifted to the rim,
   facing the opponent, and they shoot again).
3. **With the power** you flick hard. Use it to knock the computer's marble
   away so it cannot reach the cave.
4. **Points** — only the power scores. A hit by a player who has the power
   earns 1 point. A player without the power who hits a rival with the power
   earns 2 points, and the rival loses the power (and must enter the cave
   again). Two marbles without the power touching score nothing. A hit earns
   another shot.
5. **Safe in the cave** — a marble resting inside the cave is safe: touching
   it scores nothing unless it is knocked out of the cave.
6. **Breakage** — very rarely (0.001 %) a hit shatters one of the two marbles.
   Its owner lobs a fresh marble from the line, without the power.
7. **Winning** — choose a target score at the start (first to reach it wins)
   or play just for fun and end the game from the menu.

Whose turn it is shows on the player cards at the top (the active card
lights up); there are no pop-up notifications for hits or cave entries.

## Languages

The game is in English and Bangla. It picks Bangla for a browser set to
Bangla or for a connection from Bangladesh (a quick lookup of the public IP
at ipwho.is, skipped if it does not answer within a few seconds), English
otherwise. The switch at the top of the setup screen and the pause menu
overrides this, and the choice is remembered in the browser.

## Controls

| Action | Mouse / keyboard | Touch |
| --- | --- | --- |
| Aim and shoot | press on your marble, drag back (slingshot), release | same |
| Lob angle (opening throw) | mouse wheel while aiming, or ↑ / ↓ | slider |
| Position on the line | slider | slider |
| Look around | drag anywhere else, or right-drag; ← → to orbit | one-finger drag |

The camera may stand outside the low brick wall, so a marble lying at the
edge of the yard is still framed from behind; a wall that would block the
view fades out.
| Zoom | mouse wheel, + / − | pinch |
| Top view | T or the top-view button | button |
| Sound | M or the speaker button | button |
| Menu / pause | Esc or the menu button | button |

## Marbles

Three sizes — small (13 mm), medium (16 mm, the popular one) and big
(25 mm). Bigger marbles are heavier: they hit harder and are harder to move,
but a finger flicks them a little slower. Five glass styles (cat's eye,
swirl, galaxy, clear, opal) in eight colours for you. The computer always
plays a marble of the same size as yours, so the match is fair, but always
its own black glass marble with white bands, which is not on your menu, so
the two can never be confused.

## Physics notes

- Marbles are solid glass spheres with real mass (`4/3 π r³ × 2500 kg/m³`),
  linear velocity and spin.
- The yard is an uneven heightfield (seeded noise, choose a different "yard"
  in the setup): broad undulations, hand-span humps and hollows, and fine
  grain, all worn smoother near the cave; the cave is an analytic bowl one
  inch deep. The humps are what make a long shot a gamble: a full-power roll
  across the yard drifts a few centimetres off its line, more or less
  depending on the lie, so hitting from far away is never a sure thing. Bumps
  are scaled so no slope exceeds what a marble can rest on. A marble of
  radius `r` rolls on the offset surface of the terrain, so a big marble sits
  higher in the cave than a small one.
- Rolling resistance, kinetic friction during sliding (a flicked marble skids
  for a few centimetres before it rolls), quadratic air drag, restitution and
  "plowing" losses when a lobbed marble lands on dirt, marble–marble impulses
  with restitution and friction, brick walls around the yard.
- A flick never leaves exactly along the aim: every flick, yours or the
  computer's, scatters by a small random angle (about half a degree for a
  gentle nudge, two degrees at full power), on top of whatever the ground
  does to it afterwards. Lobs are not scattered.
- Everything else is deterministic; the computer plans its shots by
  simulating candidate flicks with the very same code and then adds a
  human-like aiming error depending on the difficulty.
- While marbles move the camera follows the fastest one, looking a little
  ahead of it and backing off with speed, so a hard hit and the marble it
  sends flying stay in view.

## Performance

The game picks a rendering tier for the device (`src/render/quality.js`).
Phones, machines with 4 GB or less, few cores or a weak GPU get the **low**
tier, which keeps the picture sharp (full pixel ratio up to 2, antialiasing)
but saves on shading: plain Lambert dirt, walls and lawn instead of full
PBR with environment lighting, tinted glass instead of real refraction,
1024 px hard shadows. Everything else gets **high** (refractive glass,
2048 px soft shadows). In both tiers the shadow map covers only a small box
that follows the marbles, so shadows are crisp whatever the map size; the
walls' shade is baked into the dirt. Shadows are redrawn only when a marble
has moved, the mini-map is drawn into a small texture only when a marble
moves, the render resolution steps down only after a sustained slow frame
rate (never below 1x), and when nothing moves the game draws every other
frame. Force a tier with `?quality=low` or `?quality=high`; the debug panel
(`?debug=1`) shows the tier, pixel ratio and frame rate.

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
src/i18n.js           English / Bangla strings and language detection
src/main.js           wires everything together
src/render/           three.js scene, marbles, effects, aim guide, camera
test/                 node:test suites for physics and rules
```
