# Phase 2 contracts — economy, multi-coop, collection

Extends CONTRACTS.md (still binding). main.js (integrator-owned) wires these.
Plain ESM, no new deps, methods 20-30 lines.

## src/sim/coop.js
- `class Coop`:
  - `constructor(scene, world, position /*{x,z}*/)` — builds makeCoop() mesh,
    registers obstacle (r 2.2), computes `door` world point. Draws a faint
    dashed range ring (radius `Coop.RANGE`) visible only when `.selected`.
  - static `RANGE = 20`, `MIN_SPACING = 26`, `CAPACITY = 4`, `COST = 250`
  - `.position` {x,z}, `.door` {x,z}, `.chickens` (array, push/remove by game)
  - `.product` (number, uncollected egg value), `.addProduct(v)`, `.collect()`
    → value taken (0 if none) + tiny egg-basket pop animation hook
  - `.setSelected(bool)`, `.dispose()`
  - `.inRange(x, z)` → bool (within RANGE of door)

## src/sim/feeder.js
- `class Feeder`:
  - `constructor(scene, world, position)` — small hopper prop (primitives+toon+
    ink, ~1.2 tall, cream+red), obstacle r 0.7. static `COST = 100`.
  - `.position`, `.hasFeed()` → always true for now (hook), `.dispose()`

## src/sim/collector.js
- `class Collector`:
  - `constructor(scene, world, coops /*live array ref*/)` — little farmhand
    (primitives+toon+ink, ~1.9 tall, straw hat, overalls). static `COST = 300`,
    `WAGE = 0` for now.
  - `.update(dt)` — endless route: walk (findPath, 2.0 u/s, leg scissor) to the
    coop with the most `.product`, `collect()` it (brief stoop animation,
    cha-ching via callback), then next; idle near barn if nothing to collect.
  - `.onCollect(value)` — callback set by main.js.
  - `.dispose()`

## src/ui/shop.js
- `class Shop`:
  - `constructor()` — DOM into `#hud`, bottom-right vertical stack of cartoon
    buttons (pointer-events: auto), each: icon glyph, label, price. Buttons:
    `buy-chicken $50`, `upgrade-patch $40` (shows current tier of selected
    chicken, disabled at max), `buy-mature $200`, `buy-feeder $100`,
    `buy-coop $250`, `hire-collector $300`.
  - `.onAction` — callback `(actionId) => {}` set by main.js.
  - `.setState({ money, selection, tiers })` — enable/disable buttons by
    affordability + context (e.g. upgrade-patch needs a selected chicken).
    Disabled = greyed + price red. Bounce on click.
  - `.toastRequirement(text)` proxy not needed — main.js uses HUD.toast.

## chicken.js additions (sim owner edits chicken.js, keep existing contract)
- `.tier` (0..3, default 0). `.setTier(n)` — grows its patch radius
  (4/5.5/7/9) via `patch.setRadius`; tier 3 = **mature**: instead of
  `starving` on a bare patch it enters `waiting` (sits, occasional pecks,
  patient cluck) until regrowth — never needs re-planting.
- `.mature` getter → tier === 3.
- `.useFeeder(feeder)` — when patch is bare and a feeder is assigned, walk to
  it, eat there (belly fills at same rate), and the NEXT egg is non-premium
  (`onEgg` receives `{ premium: false }`).
- `.onEgg` now receives `{ premium }`.
- `.setSelected(bool)` — subtle ink-ring highlight underfoot.

## main.js wiring (mine — FYI)
- Selection: click a chicken/coop to select (filter userData.isOutline).
- Shop actions; coop placement mode (ghost mesh follows cursor, green/red by
  MIN_SPACING + walkable, click to confirm).
- After 2nd coop exists: eggs no longer auto-sell — `coop.addProduct(value)`;
  clicking a coop collects; collector automates.
- Demo state: URL `?demo=midgame` seeds money 800, 3 coops, 9 chickens at
  mixed tiers with patches at varied drain, 2 feeders, 1 collector — used for
  screenshots and balancing. Deterministic (no Math.random at seed time).
