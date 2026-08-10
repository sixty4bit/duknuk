import * as THREE from 'three'
import { toonMaterial, addOutline, INK_WEIGHT } from '../art/toon.js'

// Tunable: seconds for a fully-bare cell to regrow to fully-lush.
export const REGROW_SECONDS = 90

const CELL_SIZE = 1
const BUCKET_LEVELS = 64
const BEST_SPOT_MIN_FOOD = 0.08
const DISTANCE_WEIGHT = 0.12
const PIXELS_PER_CELL = 24
const MAX_CANVAS = 512
const RENDER_Y = 0.03
// The patch boundary is the core mechanic's affordance and has to read as a
// closed drawn shape, not a stray line — so it takes INK_WEIGHT.DECAL, the
// exact same weight (and, by omitting `color` below, the exact same default
// ink colour) world.js gives the road and the pond edge via the identical
// `flat: true` mechanism (see buildPathMesh / the water addOutline call in
// world.js). One consistent ink hierarchy across every ground shape in the
// frame, rather than a bespoke weight/colour that only this shape used.
// Drawn via addOutline's `flat: true` path, which traces the literal open-edge
// boundary of the disc geometry itself — see the addOutline call in
// _buildVisuals. Because the ring is built FROM the disc's own geometry (not a
// separately-shaped wall), fill and ring can never disagree about where the
// patch ends: no coincident second shape to drift out of sync, no depth-order
// fight against the ground decals it may sit over (decalMaterial's
// polygonOffset already wins against both the road and the terrain — see
// toon.js). Depth test stays on via that same mechanism — real geometry
// standing on the patch (chickens, the pig) still occludes it.

// Lush must read as TALLER, DENSER grass, not a brighter one: a lit lawn in
// this frame runs ~0x86c057-0xb2d668 (HSV V~0.75-0.84 / S~0.45-0.57), and a
// full patch used to push value/saturation ABOVE that range to read as the
// "reward" state. On an actual rendered frame that reads as a light leak, not
// grass — an unshaded blob glowing hotter than everything around it, which is
// the opposite of what golden-age flats do with depth of foliage (thicker
// grass goes DARKER, because more blades means less bare dirt scattering
// light back up). #6ead4e sits at V≈0.68 / S≈0.55: a shade under the field's
// own value range on the same saturation the field already uses, so it reads
// as the same grass standing taller and catching its own shadow, not a
// different, brighter material. The blade ticks in _paintGrassStrokes (drawn
// densest exactly where a cell is lushest) carry the rest of the "taller
// grass" read. Grazed-out still fades through dusty gold to dark umber. Tuned
// against the *decoded* (sRGB colorSpace) texture output, not raw canvas hex
// — see the colorSpace assignment in _buildVisuals.
const LUSH = new THREE.Color('#6ead4e')
const THIN = new THREE.Color('#cf9f2e')
const BARE = new THREE.Color('#96652f')

// Depletion must read as *shrinkage*, not a slow tint shift: the per-cell
// food value t (0..1) is eased through this power curve before it is compared
// against the band cut points below, so losing only the first ~18% of a
// cell's food (t drops from 1 to BAND_LUSH_MIN's t-equivalent, ~0.82) already
// posterizes it out of the lush band — cells nearest the rim (eaten first)
// drop out of "lush" fast, so the lush core visibly retreats inward from the
// boundary instead of the whole disc fading together.
const DEPLETION_CURVE_POWER = 2

function easedFood(t) {
  return Math.pow(Math.max(0, t), DEPLETION_CURVE_POWER)
}

// Posterized into 3 flat, hard-stepped bands — lush / thinning / bare — the
// same cel-shaded language as every toon ramp in the frame (see toon.js's
// 2-4-step gradient maps), instead of a continuous LERP between named colors.
// A cell's fullness is quantized to one of exactly three colors HERE, before
// a single pixel is painted, so a cell boundary between two food levels is
// always a hard step in the canvas data itself — never a blend for a blur
// pass to soften into a gradient. That is what makes depletion read as a
// drawn boundary advancing across flat shapes rather than a photographic
// smear sitting inside the green.
const BAND_LUSH_MIN = 0.6
const BAND_THIN_MIN = 0.25

function foodColor(t, target = new THREE.Color()) {
  const e = easedFood(t)
  if (e >= BAND_LUSH_MIN) return target.copy(LUSH)
  if (e >= BAND_THIN_MIN) return target.copy(THIN)
  return target.copy(BARE)
}

// Grass-stroke overlay tuning — same visual language as world.js's
// buildGroundTexture (short hand-drawn ticks, tonal variation), but per-cell
// and food-driven instead of a static repeating tile. Cells below
// GRASS_STROKE_MIN_FOOD paint as bare dirt with no ticks at all — depletion
// is meant to read as texture loss, not just a hue shift. Densest ticks on
// the lushest (darkened) band are also what sells "taller grass" rather than
// leaning on fill brightness alone — see the LUSH color comment above.
const GRASS_STROKE_MIN_FOOD = 0.05
const GRASS_MAX_STROKES_PER_CELL = 6
// Steeper than DEPLETION_CURVE_POWER so blade texture thins out and drops
// to zero earlier than the color itself finishes its lush->bare transition —
// depletion reads as shrinkage *plus* texture loss stacking on top of each
// other, not a single slow tint shift standing in for both.
const GRASS_STROKE_FALLOFF_POWER = 3.5
// Strokes are tinted darker than the cell's own fill so they read as blades
// catching shadow, not a different material. 0.8 = "~20% darker"; the tones
// below spread a little variation around that so strokes in the same cell
// aren't a single flat repeated value (mirrors buildGroundTexture's 3-tone
// array).
const GRASS_STROKE_DARKEN = 0.8
const GRASS_STROKE_TONES = [0.85, 1, 1.15]
// Target tick size in *world units*, matched to buildGroundTexture's own
// ~0.14-0.3u long / ~0.04-0.07u wide marks so a patch's grass and the
// surrounding field's grass read as the same brush. Multiplied by pxPerCell
// (px per 1 world unit, since CELL_SIZE = 1) to land in canvas space.
const GRASS_STROKE_LEN_MIN = 0.14
const GRASS_STROKE_LEN_SPREAD = 0.16
const GRASS_STROKE_WIDTH_MIN = 0.04
const GRASS_STROKE_WIDTH_SPREAD = 0.03

// Deterministic per-seed RNG (same LCG shape as world.js's local helper) so a
// cell's tick *positions* stay fixed across redraws — only how many of them
// are drawn changes with food, which reads as grass filling in / wearing away
// rather than the whole patch re-jittering every tick.
function seededRand(seed) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}

// A cell's fill must read as a hand-drawn irregular blob, not a literal
// pixel-art square: ctx.fillRect stamped one axis-aligned CELL_SIZE box per
// cell, so every grazed-out patch came out as a staircase of 8-bit blocks —
// the only rigid grid anywhere in an otherwise all-flat-shapes frame, and
// exactly where depletion is supposed to read as a drawn boundary advancing.
// POLY_RADIUS_MIN is picked so two ADJACENT cells' blobs always overlap even
// at minimum jitter (0.6 + 0.6 = 1.2 cells > the 1-cell spacing between
// centers): same-band neighbors still read as one contiguous flat shape,
// full coverage, no stray gaps — the irregularity only shows up as wobble
// exactly at a BAND boundary, where the two overlapping blobs disagree on
// color and whichever painted second wins the overlap.
const POLY_RADIUS_MIN = 0.6
const POLY_RADIUS_SPREAD = 0.3
const POLY_VERT_MIN = 6
const POLY_VERT_SPREAD = 3
const POLY_ANGLE_JITTER = 0.35
// Distinct multiplier from the one _paintGrassStrokes keys its own seed off
// (2654435761, Knuth's) so a cell's fill wobble and its blade-tick jitter
// don't visually lock-step — two different-looking noise fields from the
// same deterministic LCG shape, not one pattern doing double duty.
const POLY_SEED_MULT = 2246822519

// Pixel-space vertices of one cell's blob, seeded off the cell's own (i, j)
// so the shape is stable across redraws (regrowth/depletion only changes
// which band's color fills it, never the outline itself) — same contract as
// the seeded stroke positions in _paintGrassStrokes.
function cellBlobPoints(i, j, px, seed) {
  const rnd = seededRand(seed)
  const count = POLY_VERT_MIN + Math.floor(rnd() * POLY_VERT_SPREAD)
  const cx = (i + 0.5) * px
  const cy = (j + 0.5) * px
  const points = []
  for (let v = 0; v < count; v++) {
    const base = (v / count) * Math.PI * 2
    const angle = base + (rnd() - 0.5) * POLY_ANGLE_JITTER
    const r = (POLY_RADIUS_MIN + rnd() * POLY_RADIUS_SPREAD) * px
    points.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r])
  }
  return points
}

// Boundary sample points, evenly spaced around a plain circle. Both the fill
// disc and the ink-outline rim are built from these exact points, so they can
// never drift apart — the fill can neither bleed past nor fall short of the
// line. The point at s=0 and s=segments are numerically identical (t=0 and
// t=2*PI computed from the same formula), so the loop the disc geometry and
// the ink ring both trace closes explicitly rather than approximately.
//
// This used to carry a low-frequency "scallop" plus a smaller high-frequency
// wobble to read as hand-drawn. In practice that per-vertex jitter was what
// broke the ink ring: `addOutline`'s `flat: true` path finds the boundary by
// counting how many triangles touch each welded edge, and welding keys on a
// ROUNDED position (see toon.js's `q()`), so any of the wobble's own numeric
// noise landing near a rounding boundary could flip an edge's count and drop
// it from the loop — the "runs down the left arc and stops" defect. A plain
// circle removes that whole failure class and matches the flat ink weight
// everything else on the ground plane uses; the boundary no longer needs to
// look hand-inked on its own; the ink LINE (INK_WEIGHT.DECAL, drawn by
// addOutline) is what carries that read, the same as the road and the pond.
function buildOutline(radius, segments = 72) {
  const points = []
  for (let s = 0; s <= segments; s++) {
    const t = (s / segments) * Math.PI * 2
    points.push([Math.cos(t) * radius, Math.sin(t) * radius])
  }
  return points
}

// Flat triangle fan across the boundary, built directly in the group's local
// XZ plane (no object rotation trick). UVs mirror THREE.CircleGeometry's own
// mapping so the canvas texture lands the same way it did before.
function buildDiscGeometry(radius, points) {
  const positions = [0, 0, 0]
  const uvs = [0.5, 0.5]
  const uvDiameter = radius * 2
  for (const [cx, cz] of points) {
    positions.push(cx, 0, cz)
    uvs.push(cx / uvDiameter + 0.5, cz / uvDiameter + 0.5)
  }
  const segments = points.length - 1
  const index = []
  for (let s = 0; s < segments; s++) {
    // Wound so computeVertexNormals lands on +Y (up) — center, far, near.
    index.push(0, s + 2, s + 1)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.setIndex(index)
  geo.computeVertexNormals()
  return geo
}

export class Patch {
  constructor(scene, world, center, radius) {
    this.scene = scene
    this.world = world
    this.center = { x: center.x, z: center.z }
    this.radius = radius
    this.group = new THREE.Group()
    const gh = world.groundHeightAt(this.center.x, this.center.z)
    this.group.position.set(this.center.x, gh + RENDER_Y, this.center.z)

    this._buildGrid()
    this._buildVisuals()
    this._redrawTexture()
    this._syncBuckets()
    scene.add(this.group)
  }

  _buildGrid() {
    const raw = Math.max(3, Math.ceil((this.radius * 2) / CELL_SIZE))
    this._cols = raw | 1 // force odd so there's a centered cell
    const n = this._cols * this._cols
    this._food = new Float32Array(n)
    this._buckets = new Float32Array(n)
    const half = (this._cols - 1) / 2
    for (let j = 0; j < this._cols; j++) {
      for (let i = 0; i < this._cols; i++) {
        const lx = (i - half) * CELL_SIZE
        const lz = (j - half) * CELL_SIZE
        const active = Math.hypot(lx, lz) <= this.radius
        this._food[j * this._cols + i] = active ? 1 : -1
      }
    }
  }

  _buildVisuals() {
    const px = Math.max(4, Math.min(MAX_CANVAS / this._cols, PIXELS_PER_CELL))
    this._pxPerCell = Math.floor(px)
    const size = this._cols * this._pxPerCell
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    this._canvas = canvas
    this._ctx = canvas.getContext('2d')
    this._texture = new THREE.CanvasTexture(canvas)
    // Canvas bytes are sRGB-encoded (same as the ground texture in
    // world.js). Without this, three r180's NoColorSpace default treats them
    // as linear and re-encodes on output, washing out and inverting the
    // apparent lush/grazed value ramp.
    this._texture.colorSpace = THREE.SRGBColorSpace

    // Fill and rim share one boundary so they're guaranteed coincident — no
    // bleed on either side. Kept on the instance so _paintFill can clip the
    // per-cell fill to this exact curve instead of the square cell grid's own
    // jagged approximation of a circle.
    const outline = buildOutline(this.radius)
    this._outline = outline

    // Same shading path as the ground beneath it (toon-lit, not unlit) so
    // "lush" and "grazed" land the same value/saturation logic as the field.
    //
    // polygonOffsetFactor/Units match world.js's road/rut decals (buildPathMesh)
    // exactly, not just "some negative bias": those decals resolve who wins
    // the ground purely by comparing equal offsets against actual world
    // height (see buildWagonRuts — ruts sit higher than the road and win with
    // the *same* offset the road uses). The disc previously carried a weaker
    // -1/-1 bias than the road's -2/-2, so the artificial offset could beat
    // the disc's real height advantage (RENDER_Y=0.03 vs the road's y≈0.02)
    // and the fill vanished under the road — the critic's "hose with nothing
    // attached" regression. Matching the road's own offset restores height as
    // the tiebreaker, so the disc's extra 0.01 legitimately wins.
    const mat = toonMaterial(0xffffff, {
      steps: 3,
      map: this._texture,
      transparent: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    })
    this._discMesh = new THREE.Mesh(buildDiscGeometry(this.radius, outline), mat)
    this._discMesh.renderOrder = 5
    this.group.add(this._discMesh)

    // Boundary ring via addOutline's `flat: true` path (toon.js) — the same
    // mechanism world.js uses to ink the road/rut edge and the pond edge onto
    // a flat ground decal, at the same INK_WEIGHT.DECAL and (by omitting
    // `color`) the same default ink colour those use. This traces the LITERAL
    // open-edge boundary of the disc geometry just built (buildDiscGeometry's
    // outer rim edges, each used by exactly one fan triangle), so the ring is
    // not a second shape that could drift out of sync with the fill — it IS
    // the fill's own edge. Its decal material (toon.js) carries a
    // polygonOffset far deeper than either the disc's or the road's, tuned
    // specifically to beat both the decal it rims and the terrain under it,
    // so it wins against the road even on arcs where the fill's own offset
    // match above only ties.
    addOutline(this._discMesh, { pixels: INK_WEIGHT.DECAL, flat: true })
  }

  _disposeVisuals() {
    if (this._discMesh) {
      this.group.remove(this._discMesh)
      // Traverses the disc mesh AND its addOutline-added flat ink-ring child
      // — each shell owns its own material/geometry (see toon.js), so both
      // must be disposed here.
      this._discMesh.traverse((o) => {
        o.geometry?.dispose()
        o.material?.dispose()
      })
    }
    this._texture?.dispose()
  }

  _cellIndexAt(x, z) {
    const half = (this._cols - 1) / 2
    let i = Math.round((x - this.center.x) / CELL_SIZE + half)
    let j = Math.round((z - this.center.z) / CELL_SIZE + half)
    i = Math.min(this._cols - 1, Math.max(0, i))
    j = Math.min(this._cols - 1, Math.max(0, j))
    return j * this._cols + i
  }

  _cellWorldPos(i, j) {
    const half = (this._cols - 1) / 2
    return { x: this.center.x + (i - half) * CELL_SIZE, z: this.center.z + (j - half) * CELL_SIZE }
  }

  _syncBuckets() {
    for (let k = 0; k < this._food.length; k++) {
      const f = this._food[k]
      this._buckets[k] = f < 0 ? -1 : Math.round(f * BUCKET_LEVELS)
    }
  }

  _redrawTexture() {
    this._paintFill()
    this._paintGrassStrokes()
    this._texture.needsUpdate = true
  }

  // Canvas-space path tracing the same boundary the disc geometry and ink rim
  // are built from, in the same pixel coordinates _paintFill draws cells in
  // (see the i*px/j*px mapping there). Clipping fill to this means the
  // visible edge is always that smooth curve, never the square cell grid's
  // own stair-stepped approximation of a circle.
  _outlineClipPath() {
    const half = (this._cols - 1) / 2
    const px = this._pxPerCell
    const path = new Path2D()
    this._outline.forEach(([cx, cz], idx) => {
      const x = (cx / CELL_SIZE + half) * px
      const y = (cz / CELL_SIZE + half) * px
      if (idx === 0) path.moveTo(x, y)
      else path.lineTo(x, y)
    })
    path.closePath()
    return path
  }

  // Path2D for one cell's blob, in the same pixel coordinates _paintFill
  // paints in. Seeded off the cell's own grid index with POLY_SEED_MULT (not
  // _paintGrassStrokes' multiplier) so the fill wobble is a different noise
  // field from the blade-tick jitter.
  _cellBlobPath(i, j) {
    const seed = ((j * this._cols + i) * POLY_SEED_MULT) >>> 0
    const points = cellBlobPoints(i, j, this._pxPerCell, seed)
    const path = new Path2D()
    points.forEach(([x, y], idx) => (idx === 0 ? path.moveTo(x, y) : path.lineTo(x, y)))
    path.closePath()
    return path
  }

  // Hard-edged per-cell fill straight onto the visible texture canvas,
  // clipped to the boundary so no blob can ever poke past the rim. Every
  // cell paints exactly one of the three posterized band colors from
  // foodColor — no blur pass runs over this afterward, so a cell boundary
  // between two food levels stays a hard step in the final pixels, matching
  // the flat-shaded, hard-stepped-shadow language the rest of the frame uses
  // (see toon.js's HARD_SHADOW). A soft gradient here previously read as a
  // photographic smear; a plain fillRect square here previously read as a
  // literal 8-bit pixel grid — cellBlobPath's jittered polygon is what turns
  // that hard step into a hand-drawn wobbly edge instead of either.
  _paintFill() {
    const ctx = this._ctx
    const cols = this._cols
    const scratch = new THREE.Color()
    ctx.clearRect(0, 0, this._canvas.width, this._canvas.height)
    ctx.save()
    ctx.clip(this._outlineClipPath())
    for (let j = 0; j < cols; j++) {
      for (let i = 0; i < cols; i++) {
        const f = this._food[j * cols + i]
        if (f < 0) continue
        foodColor(f, scratch)
        ctx.fillStyle = `#${scratch.getHexString()}`
        ctx.fill(this._cellBlobPath(i, j))
      }
    }
    ctx.restore()
  }

  // Paints flat blade ticks on top of the posterized fill — straight strokes,
  // not curves, so they read as a cel artist's short pen ticks rather than
  // brush-painted detail; same intent as buildGroundTexture's marks in
  // world.js, just per-cell and food-driven: a full (darkened, "taller
  // grass") cell gets a dense little cluster of dark ticks, a thin cell gets
  // a sparse few, a bare cell gets none at all (just the dirt fill). This is
  // what sells "taller grass" and what makes depletion read as texture loss,
  // not only color loss — see the LUSH color comment above.
  _paintGrassStrokes() {
    const ctx = this._ctx
    const cols = this._cols
    const px = this._pxPerCell
    const base = new THREE.Color()
    const shade = new THREE.Color()
    ctx.save()
    ctx.clip(this._outlineClipPath())
    ctx.lineCap = 'round'
    for (let j = 0; j < cols; j++) {
      for (let i = 0; i < cols; i++) {
        const f = this._food[j * cols + i]
        if (f < GRASS_STROKE_MIN_FOOD) continue
        const count = Math.round(Math.pow(f, GRASS_STROKE_FALLOFF_POWER) * GRASS_MAX_STROKES_PER_CELL)
        if (count === 0) continue
        foodColor(f, base)
        const rnd = seededRand(((j * cols + i) * 2654435761) >>> 0)
        const cx = i * px
        const cy = j * px
        for (let s = 0; s < count; s++) {
          const tone = GRASS_STROKE_TONES[s % GRASS_STROKE_TONES.length]
          shade.copy(base).multiplyScalar(GRASS_STROKE_DARKEN * tone)
          ctx.strokeStyle = `#${shade.getHexString()}`
          ctx.lineWidth = (GRASS_STROKE_WIDTH_MIN + rnd() * GRASS_STROKE_WIDTH_SPREAD) * px
          const x = cx + rnd() * px
          const y = cy + rnd() * px
          const a = rnd() * Math.PI * 2
          const len = (GRASS_STROKE_LEN_MIN + rnd() * GRASS_STROKE_LEN_SPREAD) * px
          ctx.beginPath()
          ctx.moveTo(x, y)
          ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len)
          ctx.stroke()
        }
      }
    }
    ctx.restore()
  }

  // Redraws only if a cell's quantized food level actually changed — keeps
  // the canvas repaint gated on real visual change, not every tick.
  _refreshIfDirty() {
    const food = this._food
    const buckets = this._buckets
    let dirty = false
    for (let k = 0; k < food.length; k++) {
      const f = food[k]
      if (f < 0) continue
      const b = Math.round(f * BUCKET_LEVELS)
      if (b !== buckets[k]) {
        buckets[k] = b
        dirty = true
      }
    }
    if (dirty) this._redrawTexture()
  }

  eatAt(x, z, amount) {
    const idx = this._cellIndexAt(x, z)
    const food = this._food[idx]
    if (food <= 0) return 0
    const consumed = Math.min(amount, food)
    this._food[idx] = food - consumed
    if (consumed > 0) this._refreshIfDirty()
    return consumed
  }

  bestSpot(from) {
    let best = null
    let bestScore = -Infinity
    const cols = this._cols
    for (let j = 0; j < cols; j++) {
      for (let i = 0; i < cols; i++) {
        const food = this._food[j * cols + i]
        if (food < BEST_SPOT_MIN_FOOD) continue
        const { x, z } = this._cellWorldPos(i, j)
        const score = food - Math.hypot(x - from.x, z - from.z) * DISTANCE_WEIGHT
        if (score > bestScore) {
          bestScore = score
          best = { x, z }
        }
      }
    }
    return best
  }

  fullness() {
    let sum = 0
    let count = 0
    for (let k = 0; k < this._food.length; k++) {
      const f = this._food[k]
      if (f < 0) continue
      sum += f
      count++
    }
    return count > 0 ? sum / count : 0
  }

  update(dt) {
    const inc = dt / REGROW_SECONDS
    const food = this._food
    for (let k = 0; k < food.length; k++) {
      const f = food[k]
      if (f < 0 || f >= 1) continue
      food[k] = Math.min(1, f + inc)
    }
    this._refreshIfDirty()
  }

  moveTo(center) {
    this.center = { x: center.x, z: center.z }
    const gh = this.world.groundHeightAt(center.x, center.z)
    this.group.position.set(this.center.x, gh + RENDER_Y, this.center.z)
    this._buildGrid() // fresh grass at the new spot
    this._redrawTexture()
    this._syncBuckets()
  }

  setRadius(r) {
    this.radius = r
    this._disposeVisuals()
    this._buildGrid()
    this._buildVisuals()
    this._redrawTexture()
    this._syncBuckets()
  }

  dispose() {
    this._disposeVisuals()
    this.scene.remove(this.group)
  }
}
