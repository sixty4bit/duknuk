# Module contracts — phase 1

`src/main.js` (owned by integrator) wires these modules. Implement EXACTLY these
exports and signatures; internals are yours. Read `DESIGN.md` first. Plain ESM
JavaScript, `import * as THREE from 'three'`. No new npm dependencies. Methods
20–30 lines max; prefer small pure helpers.

World units: 1 unit ≈ 1 meter. Ground is the XZ plane, +Y up. The farm is a
square `world.size` × `world.size` centered on origin.

## src/art/toon.js
- `toonMaterial(color, { steps=4 } = {})` → `THREE.MeshToonMaterial` with a
  generated gradient map (DataTexture, NearestFilter). Cache gradient maps.
- `addOutline(object3d, { color=0x1a1208, thickness=0.035 } = {})` → adds
  inverted-hull outline meshes for every Mesh descendant (BackSide, scaled or
  normal-offset). Returns `object3d`.

## src/art/models.js
All builders return a `THREE.Group` with origin at ground contact, facing +Z,
built ONLY from primitives (sphere/box/cylinder/cone/lathe/shape) with
`toonMaterial` + `addOutline`. Real proportions don't matter — cartoon ones do:
big heads, bold silhouettes, chunky shapes readable at 50 m.
- `makeChicken()` — white hen ~0.9 tall. MUST set `group.userData.parts =
  { body, head, comb, wingL, wingR, legL, legR, tail }` (Object3D refs) for
  procedural animation.
- `makeEgg()` — ~0.25 tall, off-white.
- `makeCoop()` — red wooden coop ~3 wide, ramp + dark doorway. `userData.door`
  = Object3D at the doorway ground position.
- `makeBarn()` — big red gambrel barn ~10 wide, white trim + hayloft.
- `makeFence(length)` — post-and-rail fence along +X, centered.
- `makeHaystack()` — ~2.5 tall golden mound.
- `makePig()` — pink pig lying on its side, ~1.8 long, dozing (closed-eye line).
- `makeTree()` — cartoon broccoli-blob tree ~5 tall.
- `makeSalesman()` — placeholder OK for phase 1 (unused).

## src/world.js
- `class World`:
  - `constructor(scene)` — builds terrain (size 120), painted-gradient sky
    (big inverted sphere or scene fog+background), warm directional light +
    ambient, ground with subtle color variation, and places obstacles using
    `models.js`: 1 barn, fences along field edges, 3+ haystacks, 5+ trees,
    1 sleeping pig somewhere annoyingly central, decorative crops. No coop —
    main.js places it.
  - `.size` (number), `.scene`
  - `.obstacles` — array of `{ x, z, r }` blocking circles (registered as it
    places things; expose `addObstacle(x, z, r)` for main.js to add the coop).
  - `.isWalkable(x, z)` — true if inside bounds and not inside any obstacle.
  - `.groundHeightAt(x, z)` — 0 for now (keep the hook).

## src/sim/pathfind.js
- `findPath(world, from, to)` — `{x,z}` points → array of `{x,z}` waypoints
  from `from` to `to` avoiding `world.obstacles` (grid A*, cell ≈ 1, obstacle
  radii inflated by 0.4 agent radius; nearest-walkable fallback when an endpoint
  is blocked; straight-line smoothing pass). Must never throw; worst case
  returns `[to]`.

## src/sim/patch.js
- `class Patch`:
  - `constructor(scene, world, center, radius)` — circular grazing zone at
    `{x,z}`. Food is per-cell (grid across the disc, cell ≈ 1). Renders as a
    slightly-raised disc mesh whose per-cell color LERPs lush green → thinning
    yellow → bare dirt with food level (canvas texture or vertex colors), plus a
    hand-drawn-looking dashed boundary ring.
  - `.center`, `.radius`
  - `.eatAt(x, z, amount)` → food actually consumed (0 if cell empty). Depletes
    the nearest cell; updates visuals.
  - `.bestSpot(from)` → `{x,z}` of a food-rich cell near `from`, or `null` if
    the patch is bare.
  - `.fullness()` → 0..1 aggregate food.
  - `.update(dt)` — regrowth (~90 s bare→lush, tunable const) + visual refresh.
  - `.moveTo(center)` — re-center (player re-paints the patch).
  - `.setRadius(r)` — upgrade hook.
  - `.dispose()`.

## src/sim/chicken.js
- `class Chicken`:
  - `constructor(scene, world, coop)` — `coop` is `{ position: THREE.Vector3,
    door: {x,z} }`. Builds `makeChicken()` mesh.
  - `.assignPatch(patch)` — sets/replaces its grazing patch.
  - `.update(dt)` — FSM: `idle → walkToPatch → eat → walkHome → layEgg →
    walkToPatch…`. Eats via `patch.eatAt` at ~pecking cadence until `belly`
    (0..1) hits 1; bare patch → `starving` (sad thought-bubble sprite + slow
    wander inside patch) until regrowth or reassignment. Walks along
    `findPath` waypoints ~1.6 u/s. At coop door: brief inside pause, then
    `onEgg()` fires, egg mesh pops at door and fades, chicken exits hungry.
  - Procedural animation in `.update`: leg scissor + head bob while walking,
    squash-and-stretch peck while eating, wing flap + full-body squash on lay.
  - `.onEgg` — callback set by main.js.
  - `.position` → THREE.Vector3 (read-only use).
  - `.state` → string (for HUD/debug).

## src/economy.js
- `class Economy`:
  - `.money` (starts 0), `.eggPrice` (12), `.sellEgg({ premium=true } = {})` →
    value credited; premium=false (feeder-fed, later) sells at 70%.
  - `.canAfford(n)`, `.spend(n)` → bool success.
  - `.onChange` callback (money display refresh).

## src/ui/hud.js
DOM into `#hud` (pointer-events: none except where noted). Cartoon styling:
chunky rounded panels, cream fills, thick dark-brown borders, slight rotations.
- `class HUD`:
  - `constructor()` — money counter top-left (big `$` badge, bounces on
    change), hint line bottom-center ("Click the grass to plant a patch for
    your chicken").
  - `.setMoney(n)` — animated tick + bounce.
  - `.toast(text, { mood = 'fun' | 'sad' } = {})` — stacked pop-in/out toasts
    (death notices, salesman, etc.).
  - `.floatDollar(screenX, screenY)` — a `$` that floats up and fades (main.js
    projects the coop position to screen space).
  - `.patchReadout({ screenX, screenY, fullness })` — small meter bubble near
    cursor; auto-hides after ~2 s. Color-coded green→yellow→brown.
  - `.setHint(text)`.

## src/audio.js
WebAudio, all synthesized, no assets. Shared AudioContext, lazy-init on first
user gesture (browser autoplay rules — export `unlock()` and call it from any
pointerdown).
- `bawk()` — dramatic two-syllable hen squawk ("ba-GAWK": pitch-bent sawtooth
  + noise burst, comedic).
- `chaChing()` — cash register: metallic ding-ding + drawer thunk.
- `cluckSad()` — low descending cluck (starving signal).
- `unlock()`.

## Wiring notes (what main.js does — FYI, don't implement)
Angled tycoon camera + OrbitControls (pan/zoom clamped), raycast ground clicks:
click grass = move/plant the chicken's patch (also `patchReadout` when clicking
an existing patch), coop placed near the barn at start, one chicken, egg flow =
`chicken.onEgg → economy.sellEgg → audio.bawk/chaChing → hud.floatDollar`.
