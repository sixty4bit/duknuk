# Late-game proposal: Grow-Your-Own-Feed

*Status: proposed 2026-08-13, awaiting carl-fyffe's call. Companion to DESIGN.md's
"Known gap" section.*

## The wall

The POV ladder — chicken → coop → whole-farm land use — tops out once the player
runs several coops, a collector, guardians, and (soon) higher animal tiers. At
that point money accumulates with nothing structural to spend it on, and the
map's land stops being contested: every mechanic so far spends *attention*, and
a mature farm mostly runs itself. The late game needs a system that makes LAND
scarce again and gives big money a purpose, without abandoning the single-farm
stage every piece of art, camera and control work is built on.

## The two candidates, honestly

**Multi-farm / logistics** scales the fantasy up: buy the neighbor's land, route
wagons between farms. But it forfeits our strongest asset — one intimate,
staged, golden-age cartoon frame — for map screens and abstraction, and it
needs a pile of new tech (region map, second-farm sim, routing UI) before the
first minute of it is playable. It's a sequel's opening move, not this game's
third act.

**Grow-your-own-feed** scales the fantasy *down into the dirt we already have*,
and it is the recommendation.

## The mechanic

Feed becomes real. Feeders stop conjuring feed from nowhere: they draw from a
**silo**, and the silo is filled by **crop patches** the player paints — the
patch device again, exactly as Carl's depletion design already frames grazing
("the feeder should be used once per full loop of a mature patch" makes feed
demand a real, recurring sink).

- **Crop patch** = a painted zone that runs the grazing patch *in reverse*: it
  fills cell-by-cell from bare dirt → sprouts → golden grain (same per-cell
  canvas tech, same drawn-boundary language, inverted flow). Fully grown, it
  sits until harvested.
- **Harvest**: click a ripe patch to scythe it yourself (RCT-style attention
  spend), or hire a **farmhand** — the collector pattern — who mows ripe
  patches on rounds. Harvest hauls to the silo with a satisfying grain-pour.
- **Silo**: one buyable building, upgradeable capacity. Feeders within range
  drain it per feeder-meal; an empty silo means feeders stop working and the
  bare-patch pressure comes back — the mid-game safety net now has a supply
  chain behind it.
- **Animal tiers hook**: each tier (ducks → sheep → goats → cows) wants its own
  crop type on its own terrain (per DESIGN.md's terrain-typed patches), so the
  land-use puzzle compounds: grazing zones, protection zones, and now crop
  zones compete for the same dirt. That's the late game: the whole farm becomes
  a hand-painted zoning argument.

## Why this one

It reuses what's proven (patch painting, cell-by-cell drain/regrow visuals,
collector-style workers, shop chains), it deepens the decision the game is
already about (what is this square of grass FOR?), it keeps the camera on the
farm where the art bar lives, and every beat of it is a cartoon gag waiting to
happen — scythes, grain avalanches, a cow staring into an empty feeder. Cost
is modest: no new rendering tech, one new building model, one worker variant,
one patch-mode variant.

Multi-farm stays on the shelf as the post-1.0 horizon if DUKNUK earns one.
