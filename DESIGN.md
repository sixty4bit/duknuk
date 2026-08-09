# DUKNUK — Farm Tycoon (working title)

A Three.js farm tycoon where the core mechanic is the **patch**: a player-designated
grazing zone that visibly drains (lush green → thinning yellow → bare dirt) as an
animal eats it, and regrows the same way. Style target: golden-age American
theatrical cartoon (Looney-Tunes-*esque* — squash-and-stretch silhouettes, bold
outlines, saturated flat colors, painted-backdrop skies). **No actual WB assets,
characters, or names.**

## Core loop (chicken POV)

1. You start with one chicken and one coop.
2. Click land to assign the chicken a **patch** — a circular zone it eats inside.
3. The patch drains visually as the chicken eats; food regrows over time.
4. Chicken full → walks back to coop → lays an egg with a dramatic **BAWK**,
   then a **cha-ching** and a floating `$` over the coop. Money in.
5. Chicken exits coop hungry; if its patch is bare it stands on dirt with a sad
   thought-bubble (starving signal) until re-assigned or the patch regrows.
6. Clicking a patch shows a precision readout of remaining food (color-coded).

## Economy & upgrades (coop POV)

- **Patch size upgrade** (per chicken, several tiers). Max tier = **mature
  chicken**: fully automated — eats, lays, returns, waits for regrowth on its own.
- **Feeder**: purchasable; chicken visits it when its patch runs dry. Optimizes
  one chicken. Feed is a *buffer* for regrowth, not a replacement — patch-fed
  animals produce **premium product** (worth more than feeder-fed).
- **Buy chickens** at the coop (coop has a capacity limit).
- **Buy mature chickens** later — costs more than the sum of upgrading one.
- **More coops**: must be placed far apart (minimum spacing). Chickens have a
  max range from their coop — coop placement = territory control.

## The farm is a land-use puzzle (farm POV)

- Obstacles everywhere: barns, haystacks, fences, a pig lying in the path, other
  animals. Chickens **pathfind around** them.
- **Distance = danger = value**: the further a patch is from its coop, the higher
  the hawk-attack risk — but far land is untouched and lush (more food, faster
  eggs). Risk/reward on every patch placement.
- **Terrain types** scale the patch mechanic: lush grass (cows need big lush
  patches), scrub/rock (only goats can use it — bad land has value), water-edge
  (ducks need patches touching water), sheep patches regrow slowest but yield
  wool passively. Land itself is the scarce resource.
- Fertilizer upgrades boost regrowth.

## Animal progression: chickens → ducks → sheep → goats → cows

- Each tier needs its **building** first (pond for ducks, pen, paddock, barn),
  which is drastically more expensive — each new building is a stretch that
  "restarts" the game at a bigger scale.
- **The game controls expansion timing**: a **traveling salesman** NPC stops by
  to offer the next building only when you have ~**10× a coop's cost** (next
  building needs ~12×; both tunable). The animals appear in the world early —
  clicking one tells you that you can't control it without its building.
- Each tier: more expensive to maintain, higher product value, building has an
  animal cap.

## Collection subgame

- After your **second coop**, product stops auto-selling: you must **visit** each
  building to collect. Then hire a **collector** guy who walks a route through
  your layout to automate it. More buildings → more collectors. Collectors path
  through the obstacle course the player built — layout quality matters.

## Predators & protection

- Chicken hawk attacks scale with distance from coop. Random chicken deaths with
  flavor text — funny ("tried to cross the road") and sad ("eaten by a chicken
  hawk"). Dead chickens leave a coop under-capacity → efficiency loss until
  replaced.
- Protection chain: **rooster → guard dog → roaming guy with a shotgun → fully
  automated turret system** (escalating cost/coverage/absurdity).
- The **cat**: protects sheep & goats, but must be kept away from chickens &
  ducks (it *is* a predator to them). Protection uses the **patch device**: you
  paint a protection zone the same way you paint a grazing patch.

## Known gap (open design question)

POV graduates chicken → coop → farm well, then hits a wall. Late game needs a
mechanic. Candidates: grow-your-own-feed farming system; multi-farm/region play;
logistics between farms. TODO — revisit after tiers + collection are in.

## Presentation

- Three.js, toon/cel shading, bold outlines, squash-and-stretch procedural
  animation, painted-gradient sky, exaggerated cartoon physics on gags.
- Audio: dramatic bawk, cash-register cha-ching, ambient farm.
- Quality bar: a harsh critic agent compares screenshots side-by-side (blind)
  against RollerCoaster Tycoon and must prefer ours; iterate until it does and
  until it reads unmistakably as a golden-age theatrical cartoon.
