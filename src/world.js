import * as THREE from 'three'
import { toonMaterial, addOutline, INK_WEIGHT } from './art/toon.js'
import {
  makeBarn,
  makeBirdOnPost,
  makeCrateStack,
  makeFence,
  makeHaystack,
  makeLaundryLine,
  makeMilkCan,
  makePeckingHen,
  makePig,
  makeScarecrow,
  makeTireSwing,
  makeTree,
  makeWheelbarrow,
} from './art/models.js'

const SIZE = 120
const HALF = SIZE / 2
// Cool desaturated blue-green (was 0xd9dcc4, a warm cream at ~86% value —
// LIGHTER than the sky zenith at ~65%, so distant fogged ground rendered
// brighter than the sky above it and blew out to white paper). This shares
// the sky's hue family and sits darker in value than the sky's horizon band
// (see buildSkyTexture's `horizon`, lerped up from this color), so recession
// now reads as "toward shadow," not "toward a lit blank wall."
const FOG_COLOR = 0x9fb6b0

// Side-and-slightly-behind the subject (elevation ~24deg, azimuth roughly
// camera-left) instead of near-overhead — was (26,34,30), which combined with
// the tycoon camera at (2,14,34)/elevation ~41deg put every cast shadow
// behind the eye or straight underneath its own occluder. This position
// throws long shadows laterally across the stage, toward camera-left,
// squarely inside the frame. Shared by _buildLights (the real sun) and
// SHADOW_DIR/the cel contact-shadow decals below, so the two can never drift
// out of sync.
const SUN_POS = new THREE.Vector3(34, 20, -10)

// The opening shot, as measured rather than remembered: main.js starts the
// camera at (-1, 9.5, 23) looking at (-1.5, 1.8, -7) through a 30deg vertical
// FOV. Casting that frustum onto the ground gives a narrow wedge —
//
//   z = +6  (bottom edge)  x in [-10.3,  7.6]
//   z =  -2                x in [-14.2, 11.2]
//   z = -14 (frame centre) x in [-20.0, 16.4]
//   z = -34                x in [-29.6, 25.3]
//
// — and the horizon sits at ny ~ +0.85, so props past z ~ -45 are a thin band
// at the top of the frame, not staging. Anything meant to be SEEN at start has
// to land inside that wedge; every coordinate in _placeStartViewProps,
// _placeMidbandCluster, _placeFlowerTufts and _placePath below was projected
// against this camera before it was written down.
//
// The one region deliberately kept empty is the corridor running south and
// east from the coop door (~-5.2, -0.6) into the open field — that is where
// the player's first patch clicks land, so nothing there registers an
// obstacle bigger than a hen.

// The near grove, hoisted out of _placeTrees because the tire swing in
// _placeCoopYard hangs off one of these trees. A swing whose tree is a
// duplicated literal somewhere else in the file is a swing that ends up
// dangling in mid-air the first time the grove moves.
//
// Seeds and yaws are pinned, not rolled per reload. makeTree() picks between a
// blob, a conifer and a shrub off its seed, so an unseeded grove is a grove
// that can come up as three narrow conifers — and the swing tree in particular
// has to be a wide blob with a bough to hang from. Seed 13 measures ~5.0 wide
// by 5.2 tall; the others are chosen for silhouette variety beside it.
//
// Swing tree x nudged -10 -> -9 (critic defect 1): the near repoussoir wing
// used to sit close enough in screen-space to this tree's x that it swallowed
// the tire swing hanging off it. reach = clamp(width*0.32, 1,2) is ~1.6 for
// this seed, so the swing itself lands at treeX+reach; -9 keeps the swing at
// x ~ -7.4, clear of the x >= -8 line the wing was moved behind.
const GROVE = [
  { x: -16, z: -16, seed: 41, yaw: 0.8 },
  { x: -9, z: -11, seed: 13, yaw: 2.1 }, // the swing tree
  { x: -9, z: -17, seed: 7, yaw: 4.4 },
  { x: -15, z: -11, seed: 2, yaw: 5.6 },
]
const SWING_TREE = GROVE[1]

// ---------- module-level visual helpers (not part of the exported contract) ----------

function enableShadows(object3d) {
  object3d.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true
      o.receiveShadow = true
    }
  })
  return object3d
}

/** Deterministic wobble so scatter layouts are identical between reloads. */
function seededRand(seed) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}

function smooth01(x, a, b) {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

/** Box-Muller: normal-distributed random, mean 0. Used for clump spread so
 * trees cluster toward a center instead of scattering uniformly. */
function gaussianRandom(stdDev) {
  const u = 1 - Math.random()
  const v = Math.random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * stdDev
}

// ---------------------------------------------------------------- ground

/** Painter's-eye grass texture: dense small hand-drawn grass-clump strokes at
 * grass scale (~6 world units/tile). The broad value masses are owned
 * entirely by the vertex-color field bands (applyBroadFieldShading) now — this
 * texture only supplies the fine brushy detail on top, not competing blobs. */
function buildGroundTexture() {
  // 1024px at repeat(20,20) — was 256px at repeat(14,14), which put the same
  // handful of strokes in lockstep across 5-8 visible tiles and read as a
  // checkerboard. A bigger canvas at a tight repeat plus far more, far
  // smaller strokes means no single mark is identifiable as a repeating
  // motif or sized like foliage instead of grass.
  const px = 1024
  const scale = px / 256
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = px
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#7ec852'
  ctx.fillRect(0, 0, px, px)
  const rnd = seededRand(4242)
  // The radial masses previously drawn here (24-40 soft blobs, r up to 26
  // world units) fought the vertex-color field bands, which now own the
  // broad-mass job at a correct 12-18u frequency (see applyBroadFieldShading)
  // — deleted rather than shrunk, since two systems drawing the same masses
  // at different scales is the redundancy the critic flagged.
  const tones = ['#6cb544', '#8fd867', '#5a9e3a']
  ctx.lineCap = 'round'
  // Strokes shrunk from len (18+22)*scale / width (6+6)*scale — 4.7u long by
  // 1.4u wide, prop-sized (as wide as the chicken, 3x longer) — to grass-mark
  // scale (~0.35u long, 0.09u wide), with count raised to stay dense enough
  // not to read as sparse dots at the new tighter repeat.
  // Critic defect 3: reserve a small blank corner (no strokes) that
  // applyGrassDetailFade uses as the sampling target for far-field vertices —
  // that's what lets grass-stroke density fade to nothing by mid-field
  // instead of tiling at identical density from the hero's feet to the
  // horizon.
  const blankPx = px * 0.035
  const blankR = px * 0.05
  const strokeCount = 400
  for (let i = 0; i < strokeCount; i++) {
    const x = rnd() * px
    const y = rnd() * px
    if (Math.hypot(x - blankPx, y - blankPx) < blankR) continue
    const a = rnd() * Math.PI
    const len = (6 + rnd() * 7) * scale
    ctx.strokeStyle = tones[i % tones.length]
    ctx.lineWidth = (1.6 + rnd() * 1.4) * scale
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.quadraticCurveTo(x + Math.cos(a) * len * 0.5, y + Math.sin(a) * len * 0.5 - 6 * scale, x + Math.cos(a) * len, y + Math.sin(a) * len)
    ctx.stroke()
  }
  const tex = new THREE.CanvasTexture(canvas)
  if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  // repeat stays 1x1 now — applyGrassDetailFade writes final tile-scaled UVs
  // per vertex directly (grass scale, ~4.5 world units/tile near camera) so
  // it can also blend far vertices toward the blank corner above; a
  // texture.repeat multiplier would double-scale on top of that.
  tex.repeat.set(1, 1)
  // NearestFilter at ~8.5 units/tile was aliasing, not stylization.
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.generateMipmaps = true
  // Renderer isn't available at this contract's constructor(scene) signature;
  // any value here is clamped to the GPU's real max by the renderer, so a
  // generous fixed request is safe without a capabilities query.
  tex.anisotropy = 8
  return tex
}

// Posterized field bands — one hue family (green), value window widened to a
// clearly readable +/-10% (was +/-6%, invisible in every render — the critic
// found zero drawn geography across ~60% of the frame). Grass varies by a
// few percent of hue; the picture's dark should still come from drawn cast
// shadows, never the field tint, but the *masses* now need to actually show.
const FIELD_BANDS = [
  { color: new THREE.Color(0x86c057), value: 0.9 },
  { color: new THREE.Color(0x9ccb5e), value: 1.0 },
  { color: new THREE.Color(0xb2d668), value: 1.1 },
]

/** Warm lift for the far band — pure yellow would fight the field's green
 * family, so this leans yellow-green rather than straight yellow. */
const FAR_BAND_WARM = new THREE.Color(0xcdc26e)

/** Low-frequency field variation baked as vertex colors, quantized into
 * discrete painted bands instead of a continuous cool-to-warm airbrush.
 * Wavelength tuned to ~30-32u (25-35u target) so the 120u field carries two
 * or three broad, travel-able masses rather than a fine grid or one flat
 * value — the amplitude above is what actually made those masses show; this
 * frequency is what keeps them broad instead of confetti-sized.
 *
 * Critic defect 4: that hue-band noise alone gave near field, mid field and
 * far field the same value within a few percent — no dark-mid-light
 * structure for the eye to travel front-to-back or for the hero hen to read
 * against. Layered on top now: an explicit depth recession keyed off world z
 * (the camera looks down -z, so +z is the near strip in front of the coop,
 * -z recedes toward the treeline) — near darkens ~15%, mid holds, far lifts
 * ~8% toward warm yellow-green, independent of the hue-band quantization
 * above so the two systems don't fight. */
function applyBroadFieldShading(geo) {
  const pos = geo.attributes.position
  const colors = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    const n = Math.sin(x * 0.15 + z * 0.13 + 1.7) * 0.7 + Math.sin(x * 0.03 - z * 0.025) * 0.3
    const t = THREE.MathUtils.clamp(0.5 + n * 0.5, 0, 1)
    const band = FIELD_BANDS[Math.min(FIELD_BANDS.length - 1, Math.floor(t * FIELD_BANDS.length))]
    const nearMul = 1 - 0.15 * smooth01(z, -2, 12)
    const farLift = 0.08 * smooth01(-z, 30, 55)
    const r = band.color.r * band.value * nearMul
    const g = band.color.g * band.value * nearMul
    const b = band.color.b * band.value * nearMul
    colors[i * 3] = r + (FAR_BAND_WARM.r - r) * farLift
    colors[i * 3 + 1] = g + (FAR_BAND_WARM.g - g) * farLift
    colors[i * 3 + 2] = b + (FAR_BAND_WARM.b - b) * farLift
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
}

/** Critic defect 3: the ground texture repeated at identical density and
 * scale from the hero's feet to the horizon — a uniform stipple that reads as
 * a texture map, not paint. Fixes it by hand-writing the ground plane's UVs
 * instead of relying on the flat 0..1 default: near vertices (high +z, close
 * to the start camera) sample the fully tiled, detailed texture at grass
 * scale; far vertices (toward -z) LERP their UV toward one fixed coordinate
 * that buildGroundTexture deliberately leaves blank of strokes. Blending
 * toward a FIXED target (not just widening the tile) avoids the wrap-seam
 * artefacts a per-vertex repeat change would cause, and means density/size
 * genuinely fades to nothing by mid-field rather than just getting coarser. */
function applyGrassDetailFade(geo) {
  const pos = geo.attributes.position
  const uv = geo.attributes.uv
  const blank = 0.035 // matches buildGroundTexture's reserved blank corner
  const tile = 4.5 // world units/tile close to camera
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    const t = smooth01(-z, 6, 42) // 0 near the camera, 1 by mid-field
    uv.setXY(i, THREE.MathUtils.lerp(x / tile, blank, t), THREE.MathUtils.lerp(z / tile, blank, t))
  }
  uv.needsUpdate = true
}

/** Perturbs a CircleGeometry's rim (all vertices but the center) with a
 * low-frequency angular wobble so the disc's silhouette isn't a perfect
 * circle — used to keep the backdrop disc's rim from ever coinciding with
 * the ground plane's own dead-straight edge. Geometry is still flat/planar
 * (XY, pre-rotateX) so it's cheap and normals stay simple. */
function buildWobbledDiscGeometry(radius, segments, amp) {
  const geo = new THREE.CircleGeometry(radius, segments)
  const pos = geo.attributes.position
  for (let i = 1; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const angle = Math.atan2(y, x)
    const wobble = 1 + (Math.sin(angle * 7) * 0.6 + Math.sin(angle * 3 + 1.3) * 0.4) * amp
    pos.setX(i, x * wobble)
    pos.setY(i, y * wobble)
  }
  pos.needsUpdate = true
  return geo
}

/** Flat desaturated backdrop disc past the played field so it never
 * terminates on a hard edge. Pushed to radius 170 (was HALF+10 = 70, which
 * sat only ~0.8deg / 17px from the ground plane's own z=-60 edge and fused
 * into one dead-straight horizon line) and dropped/tilted so its rim never
 * runs parallel to the ground plane's edge — and still past fog.far (110,
 * see World constructor) so the disc is fully fog-tinted well before its own
 * edge could present as a seam. Rim is wobbled, not a clean circle, for the
 * same reason. Recolored distinctly greener and darker than FOG_COLOR/the
 * sky horizon (was 0xaec2ba, a few percent off both) so it reads as
 * continuing pasture receding into haze, not as a third slab of sky. */
function buildFarBackdropGround() {
  const radius = 170
  const geo = buildWobbledDiscGeometry(radius, 64, 0.03)
  geo.rotateX(-Math.PI / 2)
  const mat = toonMaterial(0x9db78a, { steps: 2 })
  const disc = new THREE.Mesh(geo, mat)
  disc.position.y = -1.2
  disc.rotation.x = THREE.MathUtils.degToRad(0.5)
  disc.receiveShadow = true
  return disc
}

// ------------------------------------------------------------------- sky

/** Painted horizontal silhouette band with a wavy top edge (sine sum, integer
 * multiples so the seam matches at u=0/1 on the wrapped dome texture). */
function drawSilhouetteBand(ctx, w, topY, baseY, color, bumps, amp) {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(0, baseY)
  const steps = 64
  for (let i = 0; i <= steps; i++) {
    const u = i / steps
    const wobble = Math.sin(u * Math.PI * 2 * bumps) * amp + Math.sin(u * Math.PI * 2 * bumps * 2.3) * amp * 0.4
    ctx.lineTo(u * w, THREE.MathUtils.clamp(topY + wobble, 0, baseY))
  }
  ctx.lineTo(w, baseY)
  ctx.closePath()
  ctx.fill()
}

/** Five-puff cloud massing — this shape reads fine at any scale; it was only
 * ever the count/size in drawPaintedClouds that fused clouds into a slab.
 * `alpha`/`fill` let a far, hazier rank sit behind the near rank without a
 * second drawing routine. */
function drawCloudShape(ctx, cx, cy, s, { alpha = 0.94, fill = '#fffaf2' } = {}) {
  ctx.globalAlpha = 0.16 * (alpha / 0.94)
  ctx.fillStyle = '#3b587a'
  ctx.beginPath()
  ctx.ellipse(cx, cy + s * 0.18, s * 1.1, s * 0.32, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = alpha
  ctx.fillStyle = fill
  const puffs = [[0, 0, 1], [0.7, 0.15, 0.65], [-0.7, 0.12, 0.68], [0.25, -0.35, 0.55], [-0.3, -0.3, 0.5]]
  for (const [dx, dy, r] of puffs) {
    ctx.beginPath()
    ctx.ellipse(cx + dx * s, cy + dy * s * 0.6, r * s * 0.75, r * s * 0.42, 0, 0, Math.PI * 2)
    ctx.fill()
  }
  // Critic defect 5: warm the underside slightly (lit from above, like every
  // other cast-shadow/highlight pair in this file) and trace a light ink
  // edge around each lobe so the mass reads as a drawn scalloped silhouette
  // instead of an airbrushed smudge.
  ctx.globalAlpha = alpha * 0.3
  ctx.fillStyle = '#f6c98a'
  ctx.beginPath()
  ctx.ellipse(cx, cy + s * 0.3, s * 0.85, s * 0.2, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = alpha * 0.5
  ctx.strokeStyle = 'rgba(120,96,66,0.6)'
  ctx.lineWidth = Math.max(1, s * 0.03)
  for (const [dx, dy, r] of puffs) {
    ctx.beginPath()
    ctx.ellipse(cx + dx * s, cy + dy * s * 0.6, r * s * 0.75, r * s * 0.42, 0, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
}

/** Painted-flat clouds baked straight into the backdrop so they are visible
 * from frame one regardless of where the camera is orbited to.
 *
 * Critic defect 3: cy/scale here were pinned to elevation = 90 - 180*(y/h)
 * for a retired (2,14,34) camera; the real start camera ((-1,9.5,23) ->
 * (-1.5,1.8,-7), see the START-VIEW note at the top of this file) tops out at
 * only about +0.6deg elevation, so the old h*(0.45..0.505) band (+3.6..-0.9deg)
 * put the far rank off the top of frame and the near rank at/below the
 * occluded horizon — an empty sky in every screenshot. Retargeted to the
 * elevation this camera actually shows: far rank y = h*(0.42..0.462)
 * (~+14.4..+6.8deg), near rank y = h*(0.462..0.495) (~+6.8..+0.9deg), which
 * reaches down to the camera's real ceiling instead of past it. If the camera
 * reframes again, recompute this against elevation = 90 - 180*(y/h) rather
 * than copying these numbers forward blind — that is exactly how this band
 * went stale the first time.
 *
 * Also bumped from 2 far/3 near clouds at 12-22px to 3 far/4 near at 18-34px
 * (near) / 9-17px (far, half scale) — the old count/size was a smudge at
 * FOV 30 on a 1024px dome. A far rank (half scale, greyer, lower alpha) sits
 * behind a near rank (full scale/alpha) so the two ranks read as depth
 * instead of one flat layer, and a minimum angular separation keeps real sky
 * visible between every cloud. */
function drawPaintedClouds(ctx, w, h) {
  const rnd = seededRand(99)
  const accepted = []
  const place = (scale, cyMin, cyMax, opts) => {
    for (let tries = 0; tries < 24; tries++) {
      const cx = rnd() * w
      const minSep = scale * 2.5
      const clash = accepted.some((a) => Math.min(Math.abs(a - cx), w - Math.abs(a - cx)) < minSep)
      if (clash) continue
      accepted.push(cx)
      const cy = h * (cyMin + rnd() * (cyMax - cyMin))
      drawCloudShape(ctx, cx, cy, scale, opts)
      if (cx < scale * 1.5) drawCloudShape(ctx, cx + w, cy, scale, opts)
      if (cx > w - scale * 1.5) drawCloudShape(ctx, cx - w, cy, scale, opts)
      return
    }
  }
  // Far rank first so the near rank can sit visually in front of it.
  //
  // Critic defect 5: fill recolored from a cool grey (#d7dbe0 — the "dull
  // tan-grey smudges ... read as dirt on the lens" next to the good white
  // cumulus) to the same near-white as the near rank, alpha lifted so the
  // ink edge and warm underside drawCloudShape now adds still read at this
  // half scale instead of washing out.
  for (let i = 0; i < 3; i++) {
    const nearScale = 18 + rnd() * 16
    place(nearScale * 0.5, 0.42, 0.462, { alpha: 0.78, fill: '#f7f1e6' })
  }
  for (let i = 0; i < 4; i++) {
    place(18 + rnd() * 16, 0.462, 0.495)
  }
  // One more, deliberately left of frame centre — the ranks above are free
  // to cluster anywhere `place`'s separation check allows, and a sky with
  // all its incident on one side reads as one dominant puff, not a rhythm.
  const leftCx = w * (0.06 + rnd() * 0.1)
  const leftCy = h * (0.465 + rnd() * 0.022)
  drawCloudShape(ctx, leftCx, leftCy, 20 + rnd() * 8, { alpha: 0.94, fill: '#fffaf2' })
}

/** Backdrop painted as a theatrical set piece: gradient sky, a warm haze band,
 * a blue-grey hill ridge, a dark scalloped treeline, and baked-in clouds. */
function buildSkyTexture() {
  const w = 1024
  const h = 1024
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  const zenith = new THREE.Color(0x6fb8de)
  const upperHaze = new THREE.Color(0xffe2ae)
  // The fog, the sky's horizon band and the far-backdrop disc all need to
  // separate by value or they fuse into one grey slab (the critic's "haze
  // soup"). Sky horizon is now the lightest of the three — lifted toward
  // white off FOG_COLOR rather than darkened (was *0.88) — with the fog
  // itself in between and the far-backdrop disc (buildFarBackdropGround)
  // the darkest, greenest of the three so it reads as pasture, not more sky.
  const horizon = new THREE.Color(FOG_COLOR).lerp(new THREE.Color(0xffffff), 0.18)
  const c = new THREE.Color()
  for (let y = 0; y < h; y++) {
    const v = y / h
    const worldY = Math.cos(v * Math.PI) // +1 zenith .. 0 horizon .. -1 nadir
    // Critic defect 5: the visible sky band (per the START-VIEW camera fit
    // below) only reaches worldY ~0.12 at its very top — which used to be
    // exactly where this ramp finished easing and went flat zenith-blue.
    // The gradient had already ended before the frame's top edge did, which
    // is what read as "a hard horizontal seam where the top blue band
    // begins" — three stacked stripes instead of continuous atmosphere.
    // Widened so it's still easing gently through the whole visible band.
    const t = smooth01(worldY, -0.03, 0.3)
    c.copy(horizon).lerp(zenith, t)
    if (worldY > 0.02 && worldY < 0.34) c.lerp(upperHaze, 0.35 * smooth01(worldY, 0.02, 0.22))
    ctx.fillStyle = `rgb(${(c.r * 255) | 0},${(c.g * 255) | 0},${(c.b * 255) | 0})`
    ctx.fillRect(0, y, w, 1)
  }
  // Was h*0.44, computed against the wrong occluder. The real constraint is
  // the dome's own elevation mapping: elevation = 90 - 180*(y/h), and the
  // default camera's visible band is only ~-6.5..+4.4deg — i.e. y =
  // h*0.475..0.537. h*0.44 (elevation +10.8deg) was off the top of the frame
  // entirely, which is why the ridge/treeline never rendered on screen.
  // Raised ~0.004 off 0.505 (whole stack, including the near-treeline
  // baseline below) so the now-much-thicker bands sit further into the
  // visible sky band instead of dipping toward the frame's lower,
  // fog-dominated edge.
  const horizonY = h * 0.501
  // Three receding painted planes instead of two (hill, treeline) — the hill
  // was near-black-adjacent to the treeline's own near-black (#1f2e1a next to
  // sky), so the treeline read as a rendering artifact and the hill nearly
  // vanished a value off the sky. Each band gets its own bump count/amplitude
  // (not a uniform scale of one another) so the three don't read as one
  // printed, repeating wobble — and the nearest (treeline) band carries the
  // largest, most irregular scallops, per how a painted flat recedes.
  // Mid-ridge and near-treeline amplitudes raised ~3x (0.0055->0.016,
  // 0.011->0.03) — at the old amplitudes the tallest feature was a ~13px
  // bump on a 1024px texture, a hairline at the default camera; the fog
  // gradient was doing all the "distance" work the painted backdrop was
  // written to do.
  drawSilhouetteBand(ctx, w, horizonY - h * 0.015, horizonY - h * 0.001, '#7d95a8', 5, h * 0.005) // far hill
  drawSilhouetteBand(ctx, w, horizonY - h * 0.005, horizonY + h * 0.005, '#5a7263', 8, h * 0.016) // mid ridge
  drawSilhouetteBand(ctx, w, h * 0.508 - h * 0.013, h * 0.508 + h * 0.006, '#3c5240', 7, h * 0.03) // near treeline
  drawPaintedClouds(ctx, w, h)
  const tex = new THREE.CanvasTexture(canvas)
  if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  return tex
}

function buildSkyDome() {
  const radius = 280
  const geo = new THREE.SphereGeometry(radius, 32, 20)
  const mat = new THREE.MeshBasicMaterial({ map: buildSkyTexture(), side: THREE.BackSide, fog: false, depthWrite: false })
  const dome = new THREE.Mesh(geo, mat)
  dome.renderOrder = -1000
  return dome
}

function buildCloud() {
  const group = new THREE.Group()
  const mat = toonMaterial(0xfff8ec, { steps: 3 })
  const puffs = [
    { x: 0, y: 0, z: 0, r: 3.2 },
    { x: 2.6, y: 0.35, z: 0.3, r: 2.2 },
    { x: -2.6, y: 0.3, z: -0.2, r: 2.3 },
    { x: 0.8, y: 1.1, z: 0.6, r: 1.8 },
    { x: -1.1, y: 1.0, z: -0.5, r: 1.9 },
  ]
  for (const p of puffs) {
    const puff = new THREE.Mesh(new THREE.SphereGeometry(p.r, 12, 10), mat)
    puff.position.set(p.x, p.y, p.z)
    group.add(puff)
  }
  addOutline(group, { color: 0x1a1208, thickness: 0.05 })
  group.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = false
      o.receiveShadow = false
    }
  })
  return group
}

// --------------------------------------------------------- contact shadows

let unitShadowGeo = null
let sharedShadowMat = null
let sharedShadowTex = null

// Derived from the real sun vector (see SUN_POS/_buildLights) rather than a
// hardcoded pair — a hardcoded direction is exactly what let the sun move to
// (26,34,30) while these shadows kept pointing as if it were still overhead.
// Cel shadows fall away from the light and get a squash/skew toward that
// direction so they read as drawn shapes that were placed, not grey blobs
// stamped straight down.
const SHADOW_DIR = new THREE.Vector2(-SUN_POS.x, -SUN_POS.z).normalize()
const SHADOW_ANGLE = Math.atan2(SHADOW_DIR.x, SHADOW_DIR.y)
// Raked up from 1.35 — a low-elevation sun (~24deg) casts long stretched
// shadows, not near-circular ones; the ellipse now reads as a cast shape.
const SHADOW_SQUASH = 2.0
const SHADOW_OFFSET = 0.4

/** Hard-edged drawn ellipse, not a photographic soft blob: solid fill out to
 * ~78% of the radius, a short feather, then nothing. Warm brown, not grey. */
function contactShadowTexture() {
  if (sharedShadowTex) return sharedShadowTex
  const px = 128
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = px
  const ctx = canvas.getContext('2d')
  const g = ctx.createRadialGradient(px / 2, px / 2, 0, px / 2, px / 2, px / 2)
  g.addColorStop(0, 'rgba(74,44,20,0.34)')
  g.addColorStop(0.78, 'rgba(74,44,20,0.34)')
  g.addColorStop(0.84, 'rgba(74,44,20,0)')
  g.addColorStop(1, 'rgba(74,44,20,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, px, px)
  sharedShadowTex = new THREE.CanvasTexture(canvas)
  return sharedShadowTex
}

/** One shared unit-circle geometry + material, scaled/squashed per-instance —
 * a hard-edged painted contact shadow under every prop instead of relying
 * solely on the (necessarily coarse) shadow map for grounding. */
function buildContactShadow(radius) {
  if (!unitShadowGeo) {
    unitShadowGeo = new THREE.CircleGeometry(1, 24)
    unitShadowGeo.rotateX(-Math.PI / 2)
  }
  if (!sharedShadowMat) {
    // fog: true (was false) — an unfogged dark decal over fogged ground is
    // exactly the mismatch that produced the cold grey-teal wash: the ground
    // recedes toward FOG_COLOR but the decal on top of it didn't, so their
    // composite drifted off both. The shadow now recedes with the ground it
    // lies on.
    sharedShadowMat = new THREE.MeshBasicMaterial({ map: contactShadowTexture(), transparent: true, depthWrite: false, fog: true })
  }
  const mesh = new THREE.Mesh(unitShadowGeo, sharedShadowMat)
  mesh.scale.set(radius, 1, radius * SHADOW_SQUASH)
  mesh.rotation.y = SHADOW_ANGLE
  mesh.renderOrder = 1
  return mesh
}

/** Critic defect 3: a flat, hard-edged drawn shape (irregular hand-wobbled
 * polygon) laid on the ground — replaces the soft alpha-blurred decals that
 * used to do this job (buildCloudShadowMass below, deleted: a blurred
 * cloud-shape stamp whose actual "causing" cloud floated at (34,36,-14), high
 * enough it rarely lands in frame, so the mass read as a shadow with no
 * visible caster — "large soft-edged diagonal shadow smudges" per the
 * critic). A real mesh's silhouette edge is inherently crisp — no blur, no
 * alpha gradient — which is what a painted cartoon lawn's value shapes
 * actually look like. `side: DoubleSide` sidesteps having to hand-verify
 * winding order for a hand-authored polygon list. */
function buildFlatGroundShape(points, color, y = 0.018) {
  const shape = new THREE.Shape(points.map((p) => new THREE.Vector2(p.x, -p.z)))
  const geo = new THREE.ShapeGeometry(shape, 1)
  geo.rotateX(-Math.PI / 2)
  const mat = toonMaterial(color, { steps: 2, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })
  mat.side = THREE.DoubleSide
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.y = y
  mesh.receiveShadow = true
  return mesh
}

/** An organic, hand-drawn-looking blob outline for buildFlatGroundShape: a
 * ring of points at `radius` from center, each nudged by a seeded random
 * offset and smoothed against its neighbours so the silhouette reads as one
 * wobbly sweep rather than jagged noise or a perfect circle. */
function buildWobblyGroundBlob(cx, cz, radius, color, seed, segments = 18) {
  const rnd = seededRand(seed)
  const offsets = Array.from({ length: segments }, () => 1 + (rnd() - 0.5) * 0.64)
  const pts = []
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2
    const rr = radius * (offsets[i] * 0.5 + (offsets[(i + 1) % segments] + offsets[(i - 1 + segments) % segments]) * 0.25)
    pts.push({ x: cx + Math.cos(a) * rr, z: cz + Math.sin(a) * rr })
  }
  return buildFlatGroundShape(pts, color)
}

/** Critic defect 4: the barn's real-time cast shadow (sun + shadow map, see
 * _configureSunShadow) lands as a large hard-edged mass on the ground plane,
 * and the toon ramp's dark step (SHADOW_WARM, src/art/toon.js) only warms it
 * by a fixed global ratio — not enough, at this scale, to keep a big flat
 * polygon from reading as a second terrain type instead of a shadow. Same
 * trick as the contact shadows and cloud-shadow mass above: a painted warm
 * wash laid directly over the real shadow's footprint, low-alpha so it lifts
 * value and hue toward ochre without erasing the underlying dark step
 * entirely — "light falling across land," not land itself. */
function buildBarnShadowWarmWash(width, depth) {
  const geo = new THREE.PlaneGeometry(width, depth)
  geo.rotateX(-Math.PI / 2)
  const mat = new THREE.MeshBasicMaterial({
    color: 0xd9a768,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
    fog: true,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.renderOrder = 1
  return mesh
}

// ------------------------------------------------------------------ path

/** Ribbon strip along a Catmull-Rom curve through world-space points. Flat
 * ground decal: explicit up normals (not computeVertexNormals(), which — combined
 * with the old winding — produced downward normals and got backface-culled
 * from the tycoon camera entirely) and a winding order that faces the sky.
 * Wins the depth test against the ground via negative polygon offset.
 * `color`/`steps` are parameterized (not just the dirt-path defaults) so the
 * same ribbon builder can draw the mown-stripe boundary in _placeMownStripe
 * without duplicating this geometry code.
 *
 * `ink` (a weight from INK_WEIGHT, or 0 for none) draws the ribbon's BOUNDARY
 * — addOutline's `flat: true` path, which expands along the outline of the
 * decal instead of along its face normals. The old note here said a flat decal
 * shouldn't carry an outline; that was true of the inverted-hull outline that
 * existed at the time and is no longer true. A road in a golden-age cartoon is
 * a drawn shape with an edge, so the dirt path and its wagon ruts take
 * INK_WEIGHT.DECAL. The mown stripe stays inkless — it is a mown boundary in
 * the grass, not an object. */
function buildPathMesh(points, width, { color = 0xc09a63, steps = 3, y = 0.02, ink = 0 } = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p.x, y, p.z)))
  const samples = curve.getSpacedPoints(48)
  const verts = []
  const uvs = []
  const normals = []
  for (let i = 0; i < samples.length; i++) {
    const t = i / (samples.length - 1)
    const tangent = curve.getTangentAt(t)
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize()
    const p = samples[i]
    verts.push(p.x + (normal.x * width) / 2, p.y, p.z + (normal.z * width) / 2)
    verts.push(p.x - (normal.x * width) / 2, p.y, p.z - (normal.z * width) / 2)
    uvs.push(0, t, 1, t)
    normals.push(0, 1, 0, 0, 1, 0)
  }
  const idx = []
  for (let i = 0; i < samples.length - 1; i++) {
    const a = i * 2
    const b = i * 2 + 1
    const cIdx = i * 2 + 2
    const d = i * 2 + 3
    idx.push(a, cIdx, b, b, cIdx, d)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.setIndex(idx)
  const mesh = new THREE.Mesh(
    geo,
    toonMaterial(color, { steps, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
  )
  mesh.receiveShadow = true
  if (ink > 0) addOutline(mesh, { flat: true, pixels: ink })
  return mesh
}

/** The pair of wheel ruts worn into a cart track, as two narrow darker ribbons
 * riding the same curve as the road they sit in. Offsetting the CONTROL points
 * along the curve's own tangent normal (getTangent, not getTangentAt — the
 * uniform parameter is what lines up with control point i) keeps both ruts
 * parallel to the road through its bends instead of cutting the corners, which
 * is what a naive constant XZ offset does. */
function buildWagonRuts(points, offset, opts = {}) {
  const spine = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p.x, 0, p.z)))
  const ruts = new THREE.Group()
  for (const side of [-1, 1]) {
    const shifted = points.map((p, i) => {
      const tan = spine.getTangent(i / (points.length - 1))
      return { x: p.x - tan.z * offset * side, z: p.z + tan.x * offset * side }
    })
    // y 0.045 rather than a hair over the road's 0.02: both ribbons carry the
    // same negative polygon offset, so the gap between them is the only thing
    // keeping the rut off the road's own depth values.
    ruts.add(buildPathMesh(shifted, 0.55, { color: 0x8f6b3e, steps: 2, y: 0.045, ink: INK_WEIGHT.DECAL, ...opts }))
  }
  return ruts
}

// ------------------------------------------------------------- scatter props

/** A few splayed blades, chunky enough to read at 30 m. Grass tufts are the
 * cheapest way to stop a stretch of ground reading as a painted plane: they
 * put a vertical, an ink edge and a cast shadow on it. */
function buildGrassTuft(seed) {
  const rnd = seededRand(seed)
  const g = new THREE.Group()
  const mat = toonMaterial(0x5da33a, { steps: 3 })
  for (let i = 0; i < 7; i++) {
    const a = rnd() * Math.PI * 2
    const r = rnd() * 0.2
    const h = 0.45 + rnd() * 0.4
    const blade = new THREE.Mesh(new THREE.ConeGeometry(0.075, h, 4), mat)
    blade.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r)
    blade.rotation.set((rnd() - 0.5) * 0.55, a, (rnd() - 0.5) * 0.55)
    g.add(blade)
  }
  return addOutline(g, { pixels: INK_WEIGHT.PROP })
}

function buildRock(seed) {
  const rnd = seededRand(seed)
  const g = new THREE.Group()
  const mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(0.35 + rnd() * 0.25, 0), toonMaterial(0x8d8f92, { steps: 3 }))
  mesh.scale.set(1, 0.6 + rnd() * 0.3, 1)
  mesh.rotation.y = rnd() * Math.PI * 2
  mesh.position.y = mesh.geometry.parameters.radius * 0.35
  g.add(mesh)
  return addOutline(g, { thickness: 0.02 })
}

/** Critic defect 4: a bare tapered cylinder with a flat tan cap read as one
 * of the "bare brown wedges standing in the field" the critic flagged next
 * to the treeline — indistinguishable, at scatter distance, from a tree that
 * lost its canopy. A cut stump needs the tell that says "sawn," not
 * "broken": two concentric drawn growth rings on the cap face. */
function buildStump() {
  const g = new THREE.Group()
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.38, 0.5, 10), toonMaterial(0x7d5228, { steps: 3 }))
  trunk.position.y = 0.25
  g.add(trunk)
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.04, 10), toonMaterial(0xc99a5c, { steps: 3 }))
  cap.position.y = 0.51
  g.add(cap)
  const ringMat = toonMaterial(0x9c7440, { steps: 2 })
  for (const rr of [0.22, 0.12]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.012, 5, 16), ringMat)
    ring.rotation.x = Math.PI / 2
    ring.position.y = 0.535
    g.add(ring)
  }
  return addOutline(g, { thickness: 0.025 })
}

function buildFlowerTuft(petalColor) {
  const g = new THREE.Group()
  const stemMat = toonMaterial(0x4c8a34, { steps: 3 })
  const petalMat = toonMaterial(petalColor, { steps: 3 })
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2
    const r = 0.08 + (i % 2) * 0.05
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.22, 5), stemMat)
    stem.position.set(Math.cos(a) * r, 0.11, Math.sin(a) * r)
    g.add(stem)
    const petal = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), petalMat)
    petal.position.set(Math.cos(a) * r, 0.24, Math.sin(a) * r)
    g.add(petal)
  }
  return addOutline(g, { thickness: 0.015 })
}

function buildTrough() {
  const g = new THREE.Group()
  const outer = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.4, 0.6), toonMaterial(0x7d5228, { steps: 3 }))
  outer.position.y = 0.2
  g.add(outer)
  const inner = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.12, 0.42), toonMaterial(0x5fb8d6, { steps: 3 }))
  inner.position.y = 0.36
  g.add(inner)
  return addOutline(g, { thickness: 0.02 })
}

// The local buildWheelbarrow() that used to live here is gone: models.js owns
// makeWheelbarrow() now, and a second, worse copy of a prop in the world file
// is exactly the kind of drift that leaves half the farm drawn in one hand and
// half in another.

// -------------------------------------------------------- vertical landmarks

/** Tall silhouette props near the horizon band — the composition had no
 * vertical accents anywhere between the coop and the barn, so it read as a
 * stack of horizontals (fences, coop, barn ridge). ~9u tall, chunky, readable
 * as a silhouette at distance. */
function buildSilo() {
  const g = new THREE.Group()
  const body = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 7, 14), toonMaterial(0xc7cdd2, { steps: 3 }))
  body.position.y = 3.5
  g.add(body)
  const cap = new THREE.Mesh(new THREE.ConeGeometry(1.55, 1.6, 14), toonMaterial(0x8a3226, { steps: 3 }))
  cap.position.y = 7.8
  g.add(cap)
  const bandMat = toonMaterial(0x9aa2a8, { steps: 2 })
  for (const y of [2, 4.2, 6.2]) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(1.42, 0.06, 6, 16), bandMat)
    band.rotation.x = Math.PI / 2
    band.position.y = y
    g.add(band)
  }
  return addOutline(g, { thickness: 0.04 })
}

function buildWindmill() {
  const g = new THREE.Group()
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.9, 8, 8), toonMaterial(0xb3401f, { steps: 3 }))
  tower.position.y = 4
  g.add(tower)
  const hub = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 8), toonMaterial(0x3a2a1c, { steps: 2 }))
  hub.position.y = 8.1
  g.add(hub)
  const bladeMat = toonMaterial(0xf0e6cf, { steps: 3 })
  for (let i = 0; i < 4; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.6, 0.05), bladeMat)
    blade.position.y = 8.1
    blade.rotation.z = (i / 4) * Math.PI * 2
    blade.translateY(1.3)
    g.add(blade)
  }
  return addOutline(g, { thickness: 0.035 })
}

/** Was three values of one brown with no cross-bracing, no hoop bands, no
 * ladder, no finial — at horizon distance it resolved to a flat untextured
 * box next to the silo, which reads instantly at the same distance purely
 * because its red cap is a hue/value break. Cream tank body separates it from
 * its own brown legs; hoop bands separate the tank from the cream itself;
 * cross-bracing, ladder and finial are the small silhouette breaks that read
 * as "built structure" rather than placeholder geometry. Scaled 1.35x as a
 * horizon landmark that needs to out-read the silo, not undersell it. */
function buildWaterTower() {
  const g = new THREE.Group()
  const legMat = toonMaterial(0x6a4a2c, { steps: 3 })
  const legSpots = [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]
  for (const [sx, sz] of legSpots) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 6, 6), legMat)
    leg.position.set(sx, 3, sz)
    leg.rotation.z = -sx * 0.06
    leg.rotation.x = sz * 0.06
    g.add(leg)
  }
  const braceMat = toonMaterial(0x4a2f1a, { steps: 2 })
  const faces = [
    { pos: [0, 3, -0.9], axis: 'z' },
    { pos: [0, 3, 0.9], axis: 'z' },
    { pos: [-0.9, 3, 0], axis: 'x' },
    { pos: [0.9, 3, 0], axis: 'x' },
  ]
  for (const f of faces) {
    for (const sign of [1, -1]) {
      const brace = new THREE.Mesh(new THREE.BoxGeometry(0.08, 4.5, 0.08), braceMat)
      brace.position.set(...f.pos)
      if (f.axis === 'z') brace.rotation.z = sign * 0.62
      else brace.rotation.x = sign * 0.62
      g.add(brace)
    }
  }
  const ladderMat = toonMaterial(0x3a2a1c, { steps: 2 })
  const ladderX = 0.9
  const ladderZ = -1.05
  for (const dx of [-0.15, 0.15]) {
    const upright = new THREE.Mesh(new THREE.BoxGeometry(0.05, 6, 0.05), ladderMat)
    upright.position.set(ladderX + dx, 3, ladderZ)
    g.add(upright)
  }
  for (let i = 0; i < 6; i++) {
    const rung = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.05), ladderMat)
    rung.position.set(ladderX, 0.6 + i * 0.95, ladderZ)
    g.add(rung)
  }
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 2.4, 14), toonMaterial(0xe8dcc0, { steps: 3 }))
  tank.position.y = 7.2
  g.add(tank)
  const bandMat = toonMaterial(0x3a2a1c, { steps: 2 })
  for (const y of [6.4, 8.0]) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(1.85, 0.08, 8, 20), bandMat)
    band.rotation.x = Math.PI / 2
    band.position.y = y
    g.add(band)
  }
  const roof = new THREE.Mesh(new THREE.ConeGeometry(2.0, 1.2, 14), toonMaterial(0x4a2f1a, { steps: 2 }))
  roof.position.y = 9.0
  g.add(roof)
  const finial = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), toonMaterial(0xc9a227, { steps: 2 }))
  finial.position.y = 9.75
  g.add(finial)
  g.scale.setScalar(1.35)
  return addOutline(g, { thickness: 0.04 })
}

const TREE_BASE_HUES = [0x4fa33c, 0x74c94b, 0x3f8f34]

/** Per-instance canopy color: +/-12deg hue jitter off a base green, with
 * distance (farT 0..1) pushing further toward cool/desaturated/light so far
 * clumps read as haze rather than holding full contrast to the frame edge. */
function jitterCanopyColor(baseHex, hueDeg, farT) {
  const c = new THREE.Color(baseHex)
  const hsl = { h: 0, s: 0, l: 0 }
  c.getHSL(hsl)
  hsl.h = (hsl.h + hueDeg / 360 + 0.03 * farT + 1) % 1
  hsl.s = THREE.MathUtils.clamp(hsl.s * (1 - farT * 0.35), 0, 1)
  hsl.l = THREE.MathUtils.clamp(hsl.l + farT * 0.16, 0, 1)
  c.setHSL(hsl.h, hsl.s, hsl.l)
  return c.getHex()
}

/** Tints canopy meshes (world Y above the trunk) without touching models.js —
 * every ball() in makeTree() gets its own material instance, so this is safe. */
function tintCanopy(tree, hex) {
  const color = new THREE.Color(hex)
  const wp = new THREE.Vector3()
  tree.traverse((o) => {
    if (!o.isMesh || o.userData.isOutline) return
    o.getWorldPosition(wp)
    if (wp.y > 1.8) o.material.color.copy(color)
  })
  return tree
}

/** Strips the ink hull makeTree() baked in via addOutline() and rebuilds it
 * at a distance-scaled pixel weight, using addOutline's own exported `pixels`
 * option — no reach into models.js/toon.js internals. A far, ghost-saturation
 * canopy holding the same full-weight hairline as a near tree is what made
 * the pale left-side trees read as a rendering glitch rather than haze; `t`
 * (0..1, same value used for the canopy's fog blend) fades the line out in
 * step with the color so a fully fogged tree loses its outline almost
 * entirely. */
function fadeOutlineWithDistance(tree, t) {
  const shells = []
  tree.traverse((o) => {
    if (o.isMesh && o.userData.isOutline) shells.push(o)
  })
  for (const shell of shells) {
    shell.parent?.remove(shell)
    shell.geometry?.dispose?.()
  }
  tree.traverse((o) => {
    if (o.isMesh) o.userData.hasOutline = false
  })
  addOutline(tree, { pixels: Math.max(0.5, 2.2 * (1 - t * 0.75)) })
  return tree
}

/** Dedicated near-camera wing-flat silhouette for the repoussoir frame —
 * NOT a scaled makeTree(). At 2.4-2.6x scale, 12-14u from camera, a single
 * smooth canopy sphere crops into a featureless kidney-shaped blob: no
 * scalloped edge, no sky-gaps, no trunk in frame, and the near-black tint
 * swallowed makeTree's own ink outline so the mass had no drawn edge at all.
 * This builds 7 overlapping canopy lobes by hand around a trunk that lands
 * at ground level (so it reads as entering the bottom frame edge at this
 * proximity), deliberately skips lobes at ~180deg and ~280deg so two sky-gaps
 * punch through the mass, and tints a lit-side subset of lobes toward
 * `rimHex` (lighter than `baseHex`) so the silhouette holds a shape instead
 * of reading as a hole in the frame. */
function buildWingFlat(baseHex, rimHex) {
  const g = new THREE.Group()
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.5, 2.2, 8), toonMaterial(0x4a2f1a, { steps: 3 }))
  trunk.position.y = 0.9
  g.add(trunk)
  const baseMat = toonMaterial(baseHex, { steps: 3 })
  const rimMat = toonMaterial(rimHex, { steps: 3 })
  // angle (deg, gaps deliberately left at ~180 and ~280), radial offset,
  // height, radius, lit (sun-facing side gets the rim tint)
  const lobes = [
    { a: 20, r: 0.9, h: 2.6, s: 1.5, lit: true },
    { a: 70, r: 1.3, h: 3.4, s: 1.7, lit: false },
    { a: 130, r: 1.1, h: 2.2, s: 1.4, lit: false },
    { a: 230, r: 1.0, h: 3.0, s: 1.6, lit: false },
    { a: 320, r: 0.8, h: 2.4, s: 1.3, lit: true },
    { a: 350, r: 1.4, h: 3.8, s: 1.9, lit: true },
    { a: 40, r: 0.5, h: 3.9, s: 1.2, lit: true },
  ]
  for (const lo of lobes) {
    const rad = THREE.MathUtils.degToRad(lo.a)
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(lo.s, 8, 7), lo.lit ? rimMat : baseMat)
    mesh.position.set(Math.cos(rad) * lo.r, lo.h, Math.sin(rad) * lo.r)
    g.add(mesh)
  }
  return addOutline(g, { color: 0x120d06, thickness: 0.05 })
}

// ------------------------------------------------------------- crop patch

/** Tilled bed with furrow stripes under staggered, height-varied plants —
 * reads as agriculture instead of a bare grid of chevrons. Yellower green
 * than the field so crops read as a distinct hue, not more grass; `withFruit`
 * scatters red-orange fruit notes so one bed reads as a different crop
 * entirely rather than a re-skin of the others. */
function buildCropPatch(seed = 1, withFruit = false) {
  const rnd = seededRand(seed)
  const group = new THREE.Group()
  const bedW = 4.2
  const bedD = 3.6
  const rows = 3
  const cols = 4
  const bed = new THREE.Mesh(new THREE.BoxGeometry(bedW, 0.08, bedD), toonMaterial(0x6b4a2a, { steps: 3 }))
  bed.position.y = 0.04
  group.add(bed)
  const furrowMat = toonMaterial(0x50331c, { steps: 3 })
  for (let r = 0; r < rows; r++) {
    const furrow = new THREE.Mesh(new THREE.BoxGeometry(bedW * 0.94, 0.02, 0.16), furrowMat)
    furrow.position.set(0, 0.085, r * (bedD / rows) - bedD / 2 + bedD / (rows * 2))
    group.add(furrow)
  }
  const leafMat = toonMaterial(0x8fbb3a, { steps: 3 })
  const fruitMat = toonMaterial(0xe0532a, { steps: 3 })
  for (let r = 0; r < rows; r++) {
    for (let cIdx = 0; cIdx < cols; cIdx++) {
      const h = 0.85 + rnd() * 0.35
      const jitter = (rnd() - 0.5) * 0.18
      const px = (cIdx * bedW * 0.85) / (cols - 1) - (bedW * 0.85) / 2 + jitter
      const pz = r * (bedD / rows) - bedD / 2 + bedD / (rows * 2) + jitter
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.22, h, 6), leafMat)
      leaf.position.set(px, h / 2 + 0.08, pz)
      group.add(leaf)
      if (withFruit && rnd() > 0.45) {
        const fruit = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), fruitMat)
        fruit.position.set(px, h * 0.7 + 0.08, pz)
        group.add(fruit)
      }
    }
  }
  return addOutline(group, { thickness: 0.025 })
}

// -------------------------------------------------------------------- pond

/** Small cool-complement accent — a painted water disc with an ink rim so the
 * field has a saturated blue note to sit against, not just green everywhere.
 * The rim is a slightly-larger dark disc peeking out from under the water,
 * not an inverted-hull outline: a flat circle's vertex normals are all
 * identical (straight up), so a normal-offset hull just shifts the whole
 * disc rather than expanding its edge — the same defect the path had. */
function buildPond(radius) {
  const g = new THREE.Group()
  const rim = new THREE.Mesh(new THREE.CircleGeometry(radius * 1.08, 28), toonMaterial(0x1a1208, { steps: 2 }))
  rim.rotation.x = -Math.PI / 2
  rim.position.y = 0.025
  g.add(rim)
  const water = new THREE.Mesh(new THREE.CircleGeometry(radius, 28), toonMaterial(0x4a9fc9, { steps: 3 }))
  water.rotation.x = -Math.PI / 2
  water.position.y = 0.04
  g.add(water)
  const highlight = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.5, 22), toonMaterial(0x7ecbe8, { steps: 2 }))
  highlight.rotation.x = -Math.PI / 2
  highlight.position.set(radius * 0.18, 0.045, -radius * 0.12)
  g.add(highlight)
  return g
}

// ---------- World ----------

export class World {
  constructor(scene) {
    this.scene = scene
    this.size = SIZE
    this.obstacles = []
    // Pushed back out (was 30/110 with a warm cream FOG_COLOR — at that
    // range the near treeline rank, r~72-100, sat at 87%+ fog *before* the
    // per-tree baked tint in _placeTreeClump applied a second blend toward
    // the same color, so the entire mid-ground washed to a white flood). Now
    // FOG_COLOR is cool/dark instead of warm/light and _placeTreeClump no
    // longer double-applies it, so 55/260 gives a gradual recession that
    // still resolves the barn, water tower and mid grove as shapes rather
    // than erasing them by 100u.
    this.scene.fog = new THREE.Fog(FOG_COLOR, 55, 260)
    this._buildSky()
    this._buildLights()
    this._buildGround()
    this._placeObstacles()
  }

  addObstacle(x, z, r) {
    const obstacle = { x, z, r }
    this.obstacles.push(obstacle)
    return obstacle
  }

  isWalkable(x, z) {
    if (x < -HALF || x > HALF || z < -HALF || z > HALF) return false
    for (const o of this.obstacles) {
      const dx = x - o.x
      const dz = z - o.z
      if (dx * dx + dz * dz < o.r * o.r) return false
    }
    return true
  }

  groundHeightAt(_x, _z) {
    return 0
  }

  _buildSky() {
    this.scene.add(buildSkyDome())
    // Far and high: radius 130..190 keeps every cloud well past the treeline
    // so none can loom prop-sized over the field; y 20..30 at that distance
    // subtends roughly +2..+6deg from the default camera — inside the sky band
    // but above the painted ridge. (y=4..9 at radius 55..90 put whole clouds
    // ON the lawn; a ~14-unit puff 60 units out filled a third of the frame.)
    const spots = [
      { x: -120, y: 22, z: -95, s: 1.4, ry: 0.4 },
      { x: -55, y: 25, z: -150, s: 1.7, ry: 1.1 },
      { x: 40, y: 28, z: -165, s: 1.2, ry: 2.3 },
      { x: 130, y: 24, z: -80, s: 1.5, ry: 3.0 },
      { x: 165, y: 21, z: 30, s: 1.1, ry: 0.7 },
      { x: -150, y: 26, z: 40, s: 1.3, ry: 2.0 },
    ]
    for (const spot of spots) {
      const cloud = buildCloud()
      cloud.position.set(spot.x, spot.y, spot.z)
      cloud.scale.set(spot.s, spot.s * 0.55, spot.s)
      cloud.rotation.y = spot.ry
      this.scene.add(cloud)
    }
  }

  _buildLights() {
    // Sun at SUN_POS: side-and-slightly-behind the subject, elevation ~24deg
    // (was (26,34,30), behind the (2,14,34) tycoon camera at ~41deg elevation
    // — every shadow fell away from the eye and behind its own occluder, so
    // the frame contained zero visible cast shadows). Warmer key (was
    // 0xfff0d0, nearly white) so lit grass goes yellow-green and the whole
    // picture reads as one warm-cool separation instead of one hue.
    const sun = new THREE.DirectionalLight(0xffe4a8, 2.2)
    sun.position.copy(SUN_POS)
    sun.target.position.set(0, 0, 0)
    sun.castShadow = true
    this._configureSunShadow(sun)
    this.scene.add(sun, sun.target)
    // Warm ambient (was cool blue 0xbcd9ff) so shadowed faces keep their hue
    // instead of draining to grey-green, and read brighter (~55-60%).
    this.scene.add(new THREE.AmbientLight(0xffe6c0, 0.75))
  }

  /** The barn's cast shadow was arriving as a stair-stepped polygon, and the
   * cause was texel size, not filtering: a 42-unit square ortho box on a 2048
   * map spends one shadow texel every 0.041 world units, the barn's gambrel
   * roof edge crosses that grid at a shallow angle, and PCFShadowMap with
   * radius 0 (main.js keeps cel edges hard on purpose) quantises the crossing
   * into visible stairs.
   *
   * So: 4096 map, and the box cut to the smallest one that still covers the
   * start view rather than a number guessed in world space. The staged view
   * lives inside |x|,|z| <= 36 with the barn ridge and the near trees under
   * y = 14; projecting that box's corners into this light's view space (sun at
   * (34,20,-10) looking at the origin) gives half-extents of 44.7 x 34.2 —
   * wider than 36 because the light's azimuth runs diagonally across the box.
   * Rounded up to 44.8 x 34.3 that is 0.022 x 0.017 world units per texel,
   * 1.9x and 2.4x finer than before, which puts the stair tread under one
   * screen pixel at the start camera's scale.
   *
   * `near` is NEGATIVE on purpose: part of that box sits behind the light's
   * own position along its view direction (the corner nearest the sun is
   * ~5 units past it), and an orthographic projection is perfectly happy with
   * that. A positive near would clip the casters closest to the sun — the
   * barn among them — and delete the very shadow this is fixing.
   *
   * The cost is that the horizon landmarks and the treeline (r 72-100) fall
   * outside the box and stop casting real-time shadows. They keep their
   * painted contact-shadow ellipses from _place(), their own shadows landed
   * off-frame or in full fog anyway, and none of them can cast INTO the staged
   * view from out there. */
  _configureSunShadow(sun) {
    const cam = sun.shadow.camera
    Object.assign(cam, { left: -44.8, right: 44.8, top: 34.3, bottom: -34.3, near: -10, far: 90 })
    cam.updateProjectionMatrix()
    sun.shadow.mapSize.set(4096, 4096)
    // Bias is a multiple of texel size in effect, so halving the texel has to
    // pull both constants down with it — held at 0.05, normalBias would now
    // peel the barn's own shadow off its sill and float the crate stack.
    // normalBias (not bias) remains the control that kills acne on geometry
    // with real depth like the barn eaves.
    sun.shadow.bias = -0.00035
    sun.shadow.normalBias = 0.028
    // Hard map edge — cel shadows are drawn shapes, not photographic blur.
    sun.shadow.radius = 0
  }

  _buildGround() {
    const segs = 48
    const geo = new THREE.PlaneGeometry(this.size, this.size, segs, segs)
    geo.rotateX(-Math.PI / 2)
    applyBroadFieldShading(geo)
    applyGrassDetailFade(geo)
    const mat = toonMaterial(0xffffff, { steps: 3, vertexColors: true })
    mat.map = buildGroundTexture()
    mat.needsUpdate = true
    const ground = new THREE.Mesh(geo, mat)
    ground.receiveShadow = true
    this.scene.add(ground)
    this.scene.add(buildFarBackdropGround())
    this._placeGroundValueShapes()
  }

  /** Critic defect 3: replaces the old blurred cloud-shadow decal (see
   * buildFlatGroundShape's comment) with two flat, opaque, hard-edged
   * shapes — "a painted cartoon lawn has two or three flat green values in
   * deliberate SHAPES ... each with a crisp boundary, not a gradient": a
   * darker hand-wobbled sweep under the near grove/treeline mass, and a
   * lighter warm wedge across the open middle ground between the coop and
   * the barn. */
  _placeGroundValueShapes() {
    this.scene.add(buildWobblyGroundBlob(-16, -13, 12, 0x4d7a35, 711))
    this.scene.add(
      buildFlatGroundShape(
        [{ x: -4, z: 8 }, { x: 10, z: 6 }, { x: 14, z: -6 }, { x: 2, z: -10 }, { x: -6, z: -4 }],
        0xcfe08c
      )
    )
  }

  _addToScene(mesh, x, z, rotY = 0) {
    mesh.position.set(x, this.groundHeightAt(x, z), z)
    mesh.rotation.y = rotY
    enableShadows(mesh)
    this.scene.add(mesh)
    return mesh
  }

  /** The painted cel shadow alone, for things that ground themselves in pieces
   * (a clothesline is two poles, not one blob). */
  _addContactShadow(x, z, r) {
    const shadow = buildContactShadow(r * 1.3)
    const [ox, oz] = [SHADOW_DIR.x * r * SHADOW_OFFSET, SHADOW_DIR.y * r * SHADOW_OFFSET]
    shadow.position.set(x + ox, 0.015, z + oz)
    this.scene.add(shadow)
    return shadow
  }

  /** Staged prop: in the scene, grounded by a painted contact shadow, but NOT
   * an obstacle. This is what small incidental things use — hens, grass tufts,
   * milk cans — anything a chicken would walk straight past. Splitting it out
   * of _place is what lets a density pass add dozens of props without silently
   * walling in the field the player has to click on. */
  _placeDecor(mesh, x, z, shadowR, rotY = 0) {
    this._addToScene(mesh, x, z, rotY)
    this._addContactShadow(x, z, shadowR)
    return mesh
  }

  _place(mesh, x, z, r, rotY = 0) {
    this._placeDecor(mesh, x, z, r, rotY)
    this.addObstacle(x, z, r)
    return mesh
  }

  _placeFenceLine(length, x, z, rotY) {
    this._addToScene(makeFence(length), x, z, rotY)
    // a straight fence isn't one blocking circle: approximate it with a
    // string of post-sized circles along its run so isWalkable stays honest.
    const steps = Math.max(2, Math.round(length / 3))
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps - 0.5) * length
      this.addObstacle(x + Math.cos(rotY) * t, z - Math.sin(rotY) * t, 0.55)
    }
  }

  _placeGate(x, z, rotY = 0) {
    const g = new THREE.Group()
    const mat = toonMaterial(0xb07a3e, { steps: 3 })
    for (const y of [0.84, 0.46]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.15, 0.12), mat)
      rail.position.y = y
      g.add(rail)
    }
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.2, 0.2), mat)
    post.position.set(-1.8, 0.55, 0)
    g.add(post)
    g.rotation.y = -0.55 + rotY // swung open into the paddock, plus paddock rotation
    g.position.set(x, 0, z)
    addOutline(g, { thickness: 0.03 })
    enableShadows(g)
    this.scene.add(g)
  }

  _findScatterSpot(cx, cz, spread, maxTries = 10) {
    for (let i = 0; i < maxTries; i++) {
      const x = cx + (Math.random() - 0.5) * spread
      const z = cz + (Math.random() - 0.5) * spread
      if (this.isWalkable(x, z)) return { x, z }
    }
    return null
  }

  _placeObstacles() {
    this._placeBarn()
    this._placePaddock()
    this._placeHaystacks()
    this._placePig()
    this._placeCrops()
    this._placePond()
    // The near grove comes up here, ahead of the props, because the tire swing
    // measures its tree's real canopy before it can decide how long its rope is.
    this._placeGrove()
    // Before _placeScatter, so the scatter passes' _findScatterSpot sees the
    // staged props as obstacles and doesn't drop a rock inside the crate stack.
    this._placeStartViewProps()
    this._placeScatter()
    this._placeMownStripe()
    this._placePath()
    this._placeTrees()
    this._placeLandmarks()
    this._placeMidDistanceBackdrop()
  }

  /** Vertical accents near the horizon band that break up the composition's
   * horizontal banding (fences, coop, barn ridge) and give the eye somewhere
   * to travel between the coop and the barn. */
  _placeLandmarks() {
    this._place(buildSilo(), -42, -34, 1.6, 0.3)
    this._place(buildWindmill(), 30, -50, 1.0, -0.4)
    this._place(buildWaterTower(), -8, -54, 1.75, 0.8) // radius bumped for the 1.35x model scale
    this._placeMidgroundHaystackRow()
  }

  /** Critic defect 5: the mid-band between the near field and the treeline —
   * roughly the left third of the frame at (-20,-14), frame-centre depth —
   * held nothing but flat green; three trees and the water tower were the
   * only incident, and both sit off to the side of this gap. A row of three
   * scaled-up haystacks reads as one cohesive mass (not three small props —
   * "the frame needs mass distribution, not more confetti") tall enough to
   * register at that distance, the way buildSilo/buildWaterTower do. */
  _placeMidgroundHaystackRow() {
    const spots = [
      { x: -20, z: -14, yaw: 0.4 },
      { x: -22, z: -15.5, yaw: 2.1 },
      { x: -18.5, z: -16, yaw: 4.0 },
    ]
    for (const s of spots) {
      const stack = makeHaystack()
      stack.scale.setScalar(2.2)
      this._place(stack, s.x, s.z, 1.3 * 2.2, s.yaw)
    }
  }

  /** Critic defect 2: the band between the near lawn and the treeline
   * (r 72-100) — roughly z -40..-80, the largest single area in the frame —
   * carried zero drawn geography, just ground texture. buildSilo/
   * buildWindmill/buildWaterTower (_placeLandmarks, z -34..-54) already give
   * it one distant-structure beat; this adds the rest of what a golden-age
   * backdrop paints there: two hedgerow strips at different values, a rail
   * fence receding toward a vanishing point, and a couple of pale mown-field
   * rectangles. */
  _placeMidDistanceBackdrop() {
    this._placeHedgerows()
    this._placeConvergingFenceLine()
    this._placeMownFieldRects()
  }

  /** Two flat ribbon strips (the same builder the cart track and mown stripe
   * use), stepped darker-near / lighter-far so the band itself shows a
   * front-to-back value step, running roughly parallel to the horizon with a
   * little sine undulation so neither reads as a ruled line. Decals only, no
   * obstacle — nothing plays out here. */
  _placeHedgerows() {
    const hedges = [
      { z: -46, color: 0x4a6b34, dz: 2.4 },
      { z: -62, color: 0x6f8a4c, dz: 3.2 },
    ]
    for (const h of hedges) {
      const pts = [-52, -26, 0, 26, 52].map((x, i) => ({ x, z: h.z + Math.sin(i * 1.3) * h.dz }))
      this.scene.add(buildPathMesh(pts, 1.6, { color: h.color, steps: 2, y: 0.02, ink: INK_WEIGHT.DECAL }))
    }
  }

  /** A post-and-rail line built as short straight segments along a diagonal
   * running away from camera (not parallel to the frame edge) — perspective
   * alone converges a receding line toward a vanishing point, the way the
   * near cart track already does at foreground scale. Reuses _placeFenceLine
   * per segment so it registers real obstacle circles like the paddock does. */
  _placeConvergingFenceLine() {
    const from = { x: -48, z: -40 }
    const to = { x: 0, z: -70 }
    const segs = 6
    for (let i = 0; i < segs; i++) {
      const x0 = THREE.MathUtils.lerp(from.x, to.x, i / segs)
      const z0 = THREE.MathUtils.lerp(from.z, to.z, i / segs)
      const x1 = THREE.MathUtils.lerp(from.x, to.x, (i + 1) / segs)
      const z1 = THREE.MathUtils.lerp(from.z, to.z, (i + 1) / segs)
      const dx = x1 - x0
      const dz = z1 - z0
      const len = Math.hypot(dx, dz)
      // rotY such that the fence's local +X axis (world dir (cos,-sin) under
      // _addToScene's rotation.y) lines up with this segment's own direction
      // — matches the convention _placeFenceLine's obstacle-stepping already
      // assumes.
      this._placeFenceLine(len, (x0 + x1) / 2, (z0 + z1) / 2, Math.atan2(-dz, dx))
    }
  }

  /** A couple of pale, flat rectangles standing in for distant mown fields —
   * the lightest value in the mid-band, per "step the values so each band is
   * lighter than the one in front of it." Decals, no obstacle. */
  _placeMownFieldRects() {
    const rects = [
      { x: -30, z: -52, w: 22, d: 12, rot: 0.3 },
      { x: 24, z: -60, w: 18, d: 10, rot: -0.2 },
    ]
    for (const r of rects) {
      const geo = new THREE.PlaneGeometry(r.w, r.d)
      geo.rotateX(-Math.PI / 2)
      const mat = toonMaterial(0xd8dd9a, { steps: 2, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.set(r.x, 0.015, r.z)
      mesh.rotation.y = r.rot
      this.scene.add(mesh)
    }
  }

  _placeBarn() {
    this._place(makeBarn(), 11, -14, 5.6, 0)
    this._placeBarnShadowWarmWash()
  }

  /** Critic defect 4: the barn's own real shadow lands roughly 17 units left
   * (-x) and 5 forward (+z) of the barn along the sun's real SHADOW_DIR — a
   * hard-edged, unwarmed dark-green mass, visually detached from its caster.
   * Sized/positioned to touch the barn's own west wall (x ~5.6) so the wash
   * reads as connected to its source instead of floating in open field, and
   * raked to SHADOW_ANGLE so its long axis matches the sun's cast direction. */
  _placeBarnShadowWarmWash() {
    const wash = buildBarnShadowWarmWash(22, 14)
    wash.position.set(-6, 0.025, -9)
    wash.rotation.y = SHADOW_ANGLE
    this.scene.add(wash)
  }

  /** Closed loop with a gate gap on the south side and a swing-gate prop
   * bridging it, rotated ~22deg off the view ray and shifted east. The west
   * run used to sit at x=2 running along z with the camera at x=6 — almost
   * directly away from the eye, so it projected as one unbroken line from
   * the bottom edge to the barn and split the frame in two. Rotating the
   * whole assembly means no run stays parallel to any view ray, and shifting
   * east (x 12..38) clears the near-center where the chicken/player action
   * happens. */
  _placePaddock() {
    const rot = THREE.MathUtils.degToRad(22)
    const shiftX = 10
    const pivot = { x: 26, z: 5 }
    const rotate = (x, z) => {
      const dx = x + shiftX - pivot.x
      const dz = z - pivot.z
      return {
        x: pivot.x + dx * Math.cos(rot) - dz * Math.sin(rot),
        z: pivot.z + dx * Math.sin(rot) + dz * Math.cos(rot),
      }
    }
    const runs = [
      { len: 12, x: 8, z: -9, r: 0 }, // south, west of gate
      { len: 12, x: 24, z: -9, r: 0 }, // south, east of gate
      // East run shortened 28 -> 18 (critic defect 7): this file's own
      // comment used to note the paddock fence "cut mid-rail by the frame
      // edge" with no terminating post — a slice reads as a rendering
      // accident, not a deliberate crop. Shortened so both ends fall
      // decisively outside the visible frustum instead of grazing its edge.
      { len: 18, x: 30, z: 5, r: Math.PI / 2 }, // east
      { len: 28, x: 16, z: 19, r: 0 }, // north
      // West run, shortened 28 -> 20 and slid north. At its old length it came
      // out of rotate() ending at world (7.8,-13.2) — INSIDE the barn, whose
      // footprint is x[5.6,16.5] z[-18,-10]. Rails were growing out of the
      // barn's west wall and the run crossed the door line at x=9.1, so the
      // farm's main road physically could not leave its own barn doors. It now
      // stops at (10.8,-5.8), clear of both the barn and the cart track.
      { len: 20, x: 4.8, z: 7.9, r: Math.PI / 2 }, // west
    ]
    for (const run of runs) {
      const p = rotate(run.x, run.z)
      this._placeFenceLine(run.len, p.x, p.z, run.r + rot)
    }
    const gate = rotate(16, -9)
    this._placeGate(gate.x, gate.z, rot)
  }

  _placeHaystacks() {
    // Barn-side cluster plus a second, smaller cluster in the left third —
    // the hay gold was jammed into one corner with the barn red; this
    // distributes the saturated warm note instead of leaving two thirds of
    // the frame monochrome green.
    const spots = [
      { x: 18, z: -11, r: 1.3 },
      { x: 21, z: -12.5, r: 1.2 },
      { x: 18, z: -13.5, r: 1.2 },
      { x: -28, z: -9, r: 1.2 },
      { x: -25.5, z: -7.3, r: 1.1 },
    ]
    for (const s of spots) this._place(makeHaystack(), s.x, s.z, s.r, Math.random() * Math.PI * 2)
  }

  /** Critic defect 6 (was -3,6, cropped at the bottom edge) moved the pig to
   * (-2,1); critic defect 1 (this pass) found even that too close to the coop
   * door — jammed shoulder-to-shoulder with the hero hen and both pecking
   * hens in one bottom-edge strip. Pushed further out to (0,-1), astride the
   * cart track roughly midway between the coop and the barn (the path's own
   * (1.0,-1.0) control point, see _placePath, sits ~1u from this spot) so it
   * still reads as the DESIGN.md "pig lying in the path" gag but is no longer
   * part of the door-yard cluster. */
  _placePig() {
    const pig = makePig()
    this._place(pig, 0, -1, 1.3, pig.userData.restYaw ?? -0.4)
  }

  _placeCrops() {
    const spots = [
      { x: -15, z: 11, seed: 11 },
      { x: -6, z: 17, seed: 22, fruit: true },
      { x: -18, z: 18, seed: 33 },
    ]
    for (const s of spots) this._addToScene(buildCropPatch(s.seed, !!s.fruit), s.x, s.z, Math.random() * Math.PI * 2)
  }

  /** Cool complement placed before the rock/flower scatter passes so their
   * _findScatterSpot obstacle-avoidance keeps clear of it automatically.
   * Pulled inward (was -20,-3, out where fog ate it) so the left midfield
   * carries real mass at readable scale. */
  _placePond() {
    const x = -14
    const z = -6
    const r = 3.2
    this._addToScene(buildPond(r), x, z, 0)
    this.addObstacle(x, z, r)
  }

  /** The near grove: pulled inward (was -24..-26,-17..-22, out where fog ate
   * it) to x -18..-8, z -18..-8 so the left midfield carries real mass at
   * readable scale instead of leaving that depth band undifferentiated. The
   * swing tree is kept so _placeTireSwing can measure the bough it hangs from. */
  _placeGrove() {
    for (const s of GROVE) {
      const tree = this._place(makeTree(s.seed), s.x, s.z, 1.1, s.yaw)
      if (s === SWING_TREE) this._swingTree = tree
    }
  }

  /** The density pass. See the START-VIEW note at the top of this file for the
   * measured ground wedge these coordinates were fitted to — the frame is
   * narrow (x -14..11 at the coop's depth), so "somewhere on the left" is not
   * a placement, it is a miss. Three yards' worth of incident, each a small
   * cluster rather than a lone prop: nothing on this farm should be the only
   * thing happening where it stands. */
  _placeStartViewProps() {
    this._placeCoopYard()
    this._placeDecorAnimals()
    this._placeBarnYard()
    this._placeFencePerches()
  }

  /** Critic defect 1: hero hen, both pecking hens and the sleeping pig were
   * all bunched into one strip along the bottom edge, all at the same
   * on-screen scale, touching or overlapping — no hero read. Spread in DEPTH
   * now, not just X: one pecking hen upstage near the pond bank, the other
   * out by the crop beds, both well clear of the coop door's ~3u empty
   * radius (see _placeCoopYard) so the hero hen — spawned at the door by
   * main.js — owns her own negative space. */
  _placeDecorAnimals() {
    this._placeDecor(makePeckingHen(), -9, -6, 0.35, 1.4) // pond bank
    this._placeDecor(makePeckingHen(), 2, -3, 0.35, -2.0) // crop beds
  }

  /** Left and centre of frame: the coop's own yard. The scarecrow is the one
   * vertical between the pond and the coop; pulled in from x -10.8 to -7.6
   * (critic defect 1) so it sits at x >= -8, clear of the repoussoir wing now
   * staged at (-14,16) — it used to land close enough to that wing's screen
   * position to read as a figure peeking out from behind a blob. Laundry
   * strings BEHIND the coop (smaller z) so it layers into depth instead of
   * standing beside it, and the tire swing hangs off SWING_TREE at (-9,-11).
   *
   * Critic defect 1 (second pass): the pecking hens used to live right here,
   * at (-3.6,0.8) and (-7.8,1.2) — a couple of units from the coop door,
   * bunched with the hero hen and the pig into one bottom-edge strip with no
   * hero read. Both hens moved out to _placeDecorAnimals, spread in DEPTH
   * instead of huddled at the door, so a clear ~3u radius around the coop
   * door (~-5.2,-0.6) is left for the hero hen alone. */
  _placeCoopYard() {
    this._place(makeScarecrow(), -7.6, -3.2, 0.6, 0.45)
    this._placeLaundryLine()
    this._placeTireSwing()
  }

  /** makeTireSwing takes the height of its rope-top and puts its group origin
   * on the ground under the tire, so the swing has to be told how big the tree
   * it hangs from actually is. That is MEASURED off the built tree, not
   * guessed: makeTree picks blob/conifer/shrub and a trunk height off its seed,
   * so a hardcoded rope length is a rope ending in open sky the day that seed
   * changes. The rope top lands just inside the leaf mass and the tire swings
   * out on the camera side, clear of the trunk. */
  _placeTireSwing() {
    const bounds = new THREE.Box3().setFromObject(this._swingTree)
    const reach = THREE.MathUtils.clamp((bounds.max.x - bounds.min.x) * 0.32, 1.0, 2.0)
    const ropeTop = THREE.MathUtils.clamp(bounds.max.y - 1.3, 2.2, 4.2)
    this._place(makeTireSwing(ropeTop), SWING_TREE.x + reach, SWING_TREE.z + reach * 0.85, 0.5, -0.6)
  }

  /** Two poles and a sagging run of washing, angled ~20deg off the view ray so
   * it reads as a line receding rather than a bar across the frame. The run is
   * registered as its two POLES, not one circle: a chicken can walk under a
   * clothesline, and a single obstacle spanning it would wall off the north
   * side of the coop yard for no reason. */
  _placeLaundryLine() {
    const [cx, cz, rotY] = [-6.2, -6.4, -0.358]
    const line = makeLaundryLine()
    // Measured off the model, not assumed: models.js owns how long the run is,
    // and a hardcoded half-span here would put the blocking circles somewhere
    // the poles aren't the moment that prop is restyled. Measured BEFORE the
    // group is rotated, so this is its local extent along the run.
    const size = new THREE.Box3().setFromObject(line).getSize(new THREE.Vector3())
    const halfRun = Math.max(0.5, Math.max(size.x, size.z) / 2 - 0.3)
    this._addToScene(line, cx, cz, rotY)
    for (const s of [-1, 1]) {
      const px = cx + Math.cos(rotY) * halfRun * s
      const pz = cz - Math.sin(rotY) * halfRun * s
      this._addContactShadow(px, pz, 0.45)
      this.addObstacle(px, pz, 0.45)
    }
  }

  /** Right of frame: the working apron in front of the barn doors. The barn
   * sits at (11,-14) with its door wall at z ~ -9.98 spanning x 5.6..16.5, so
   * everything here hugs z ~ -9 — a metre proud of the wall, clear of the
   * mesh. The wheelbarrow sits on the outside of the path's bend where the
   * cart track leaves the doors.
   *
   * Critic defect 7: the milk cans used to sit at nx 0.91/0.95 — this file's
   * own former comment called it "the tightest fit in the whole staging" —
   * sliced by the frame edge with no overlapping form in front of them to
   * read as a deliberate crop. Pulled in from (12.9,-9.1)/(13.7,-9.5) to
   * (11.8,-8.6)/(12.5,-9.0), both inside nx 0.85.
   *
   * Critic defect 5: the trough was too small to register at this distance —
   * scaled up 1.6x, obstacle/shadow radius scaled to match. */
  _placeBarnYard() {
    this._place(makeCrateStack(), 5.9, -9.3, 0.9, 0.35)
    this._placeDecor(makeMilkCan(), 11.8, -8.6, 0.4, 0.8)
    this._placeDecor(makeMilkCan(), 12.5, -9.0, 0.4, -0.5)
    this.addObstacle(12.15, -8.8, 0.75) // the pair, as one blocking circle
    this._place(makeWheelbarrow(), 6.84, -3.16, 0.6, -0.9)
    const trough = buildTrough()
    trough.scale.setScalar(1.6)
    this._place(trough, 9.3, -2.9, 0.9 * 1.6, 0.35 + Math.PI / 2)
  }

  /** Three perches, deliberately spread left / centre / right rather than
   * clustered, because a bird is a punctuation mark and three of them in one
   * corner punctuate nothing. Right: just west of where the paddock's west run
   * now terminates, so it reads as that fence's last post. Centre: out in the
   * bare mid-band. Left: between the pond and the grove, clear of both. Each
   * comes with its own post, so none of them depends on a fence being there. */
  _placeFencePerches() {
    const perches = [
      { x: 10.2, z: -4.9, rotY: -1.9 },
      { x: -1.2, z: -9.0, rotY: 0.7 },
      { x: -12.4, z: -9.2, rotY: 2.4 },
    ]
    for (const p of perches) this._place(makeBirdOnPost(), p.x, p.z, 0.3, p.rotY)
  }

  _placeScatter() {
    this._placeFlowerTufts()
    this._placeRocks()
    this._placeMidbandCluster()
    this._placeStumps()
    this._placeYardProps()
  }

  /** Grouped by color so each drift reads as one accent mass rather than
   * mixed-color confetti. Spread is halved to 5 (a +/-2.5 box) so each drift
   * is a clump you could put a hand over, not a sprinkle across a quarter of
   * the field.
   *
   * Critic defect 5: both drifts used to sit on the coop-to-barn diagonal,
   * which is why the frame read cluttered in a band and vacant everywhere
   * else — roughly 30% of the frame (the lower-right quadrant beyond the
   * road) was dead. The purple drift is moved out of that diagonal into the
   * right foreground (x 6..12, z 2..8); the red drift stays put as the one
   * accent that still ties the coop yard together. */
  _placeFlowerTufts() {
    const drifts = [
      { x: -0.5, z: -5.5, spread: 5, count: 6, color: 0xe6483c },
      { x: 9, z: 5, spread: 5, count: 6, color: 0xc060d6 },
    ]
    for (const d of drifts) {
      for (let n = 0; n < d.count; n++) {
        const spot = this._findScatterSpot(d.x, d.z, d.spread)
        if (!spot) continue
        const tuft = buildFlowerTuft(d.color)
        tuft.scale.setScalar(3)
        this._addToScene(tuft, spot.x, spot.z, Math.random() * Math.PI * 2)
      }
    }
  }

  _placeRocks() {
    const clusters = [
      { x: 20, z: -2, spread: 20, count: 5 },
      { x: -30, z: 0, spread: 30, count: 5 },
      { x: 0, z: 40, spread: 30, count: 4 },
    ]
    let seed = 500
    for (const cl of clusters) {
      for (let n = 0; n < cl.count; n++) {
        const spot = this._findScatterSpot(cl.x, cl.z, cl.spread)
        if (!spot) continue
        this._place(buildRock(seed++), spot.x, spot.z, 0.4)
      }
    }
  }

  /** The low-rock-and-grass note that ties the ground plane together with
   * some incident. Rocks bring the one cool grey in that stretch of the
   * picture and the tufts break the ground plane between them. Tufts
   * register no obstacle — they are grass, and a chicken walks through grass.
   *
   * Critic defect 5: this used to sit at (3,-8), dead centre of the
   * coop-to-barn diagonal — every staged prop lived on that one line, which
   * is why the frame read cluttered in a band and vacant everywhere else.
   * Shifted (+6.1,+12.4) into the right foreground (x 6..12, z 2..8), the
   * quadrant beyond the road that used to hold nothing but one trough and one
   * rock. */
  _placeMidbandCluster() {
    const rocks = [{ x: 8.5, z: 4.0, s: 1.15 }, { x: 10.0, z: 5.4, s: 0.8 }]
    let seed = 900
    for (const r of rocks) {
      const rock = buildRock(seed++)
      rock.scale.setScalar(r.s)
      this._place(rock, r.x, r.z, 0.45 * r.s, seed * 0.7)
    }
    const tufts = [[8.0, 5.4], [9.2, 6.0], [10.7, 4.1], [9.0, 3.0], [11.0, 5.8], [7.6, 3.5]]
    for (const [x, z] of tufts) {
      const tuft = buildGrassTuft(seed++)
      tuft.scale.setScalar(1.1 + (seed % 5) * 0.08)
      this._placeDecor(tuft, x, z, 0.3, seed * 1.3)
    }
  }

  /** Critic defect 4: at full-circle random placement, ~42% of these landed
   * inside the camera-facing arc (195-345deg, same sector _placeTreeline
   * scores against the default view) — and at r 52-56 they sit CLOSER to
   * camera than the near treeline rank (72), so a small scatter prop read as
   * a broken tree at conspicuous scale ("several ... bare brown wedges").
   * Now sampled only from the arc _placeTreeline's own sparse pass avoids
   * (345deg -> 360 -> 195deg, wrapping the opposite way) so a stump this
   * plain never lands in the primary start view — only where a player who
   * orbits the camera would find it, close enough to read as a cut stump. */
  _placeStumps() {
    for (let i = 0; i < 6; i++) {
      const angleDeg = 345 + Math.random() * 210
      const a = THREE.MathUtils.degToRad(angleDeg % 360)
      const r = HALF - 8 + Math.random() * 4
      const spot = this._findScatterSpot(Math.cos(a) * r, Math.sin(a) * r, 3)
      if (!spot) continue
      this._place(buildStump(), spot.x, spot.z, 0.45)
    }
  }

  /** The trough and the wheelbarrow used to be scattered here at random inside
   * a +/-3 box, which is how a wheelbarrow ended up parked behind the barn
   * where nobody could see it. Both are staged deliberately now — see
   * _placeBarnYard — so what is left is the back-of-house dressing, out past
   * the paddock where the start camera can't reach and only an orbiting player
   * ever sees it. */
  _placeYardProps() {
    const spare = this._findScatterSpot(-24, -20, 8)
    if (spare) this._place(buildTrough(), spare.x, spare.z, 0.9, Math.random() * Math.PI * 2)
  }

  /** The cart track, and the strongest leading line in the frame — it is the
   * only drawn shape that crosses the whole picture.
   *
   * It had to be re-routed. The old run went barn doors -> (16,-9) -> (19,-2)
   * -> (15,8), which was staged for the previous camera at (2,14,34)/FOV 34.
   * Against the current start camera the frame's right edge is x=14.4 at
   * z=-9 and x=11.2 at z=-2, so every control point after the first was
   * outside the picture: the farm's main road was invisible at start, and so
   * were any ruts drawn in it. It now leaves the doors and sweeps south-west
   * across the near field, in frame for its whole visible length (nx 0.77 at
   * the barn down to -0.12 as it leaves).
   *
   * Critic defect 2: the old tail exited the bottom-left corner — a leading
   * line pointing at nothing — and at 3.8 wide with ruts at a 0.95 offset it
   * was also the single highest-chroma shape in the frame, out-valuing the
   * barn, with the ruts sitting near the road's crown instead of under the
   * wheels. Narrowed to 2.6 wide, ruts pushed out to 1.1 (~0.85 of the new
   * half-width), and the fill desaturated from bright tan toward the field's
   * warm-shadow family (0x9c7b4e). The tail's last two control points now
   * route it behind the left repoussoir wing at (-14,16) — see
   * _placeForegroundFrame — instead of off the bottom-left corner.
   *
   * It also passes within ~1 unit of the dozing pig, now staged at (0,-1)
   * (see _placePig / critic defect 1, second pass) — well inside the road's
   * half-width — so the pig is literally lying in the path, which is what
   * DESIGN.md asked for and what a cartoon would draw. The road is a decal
   * and registers no obstacle, so none of this narrows the walkable
   * corridor. */
  _placePath() {
    const pts = [
      { x: 11.2, z: -10.8 }, // barn doors
      { x: 9.0, z: -8.5 },
      { x: 5.0, z: -5.0 },
      { x: 1.0, z: -1.0 }, // passes the pig, see _placePig
      { x: -2.0, z: 1.6 },
      { x: -5.5, z: 9.5 },
      { x: -13, z: 10 },
      { x: -19, z: 14 },
    ]
    const path = buildPathMesh(pts, 2.6, { color: 0x9c7b4e, ink: INK_WEIGHT.DECAL })
    path.receiveShadow = true
    this.scene.add(path)
    this.scene.add(buildWagonRuts(pts, 1.1))
  }

  /** Drawn boundary across the empty left-center third — the largest dead
   * area once the field's own broad-mass bands (applyBroadFieldShading) still
   * only carry grain, not shape. A pale mown swath, lighter/less saturated
   * than the field bands, reads as tended pasture and gives that region a
   * travel-able line rather than flat unbroken green. */
  _placeMownStripe() {
    const pts = [
      { x: -48, z: -36 },
      { x: -34, z: -14 },
      { x: -18, z: 10 },
      { x: -2, z: 34 },
    ]
    const stripe = buildPathMesh(pts, 2.8, { color: 0xb9d382, steps: 2, y: 0.012 })
    stripe.receiveShadow = true
    this.scene.add(stripe)
  }

  _placeTrees() {
    this._placeForegroundFrame()
    this._placeTreeline()
  }

  /** Deliberate near-camera silhouette arch (repoussoir) — was placed at
   * (40,30)/(44,18)/(34,42), all with a negative dot product against the
   * default camera's (6,8,20)->(-6,0,-22) forward vector, i.e. entirely
   * behind the eye and never rendered. Moved inside the near third of the
   * frustum so crowns break the top edge and trunks break the left/right
   * edges. Built from buildWingFlat (not a scaled makeTree()) so the mass
   * scallops, punches sky-gaps, and carries a trunk into the bottom edge and
   * a lit-side rim tint instead of cropping to one featureless canopy sphere.
   *
   * Critic defect 1: against the real start camera ((-1,9.5,23) -> (-1.5,1.8,-7),
   * see the START-VIEW note at the top of this file) the left wing at
   * (-10,12) scaled 2.0 sat only ~11 units out, over-subtended the left edge,
   * and its near-black 0x24541f base read as a lens smudge rather than a
   * tree — while bisecting the scarecrow and swallowing SWING_TREE's tire
   * swing. Pushed back/out to (-14,16) at a smaller 1.5 scale so the
   * scallops and sky-gaps buildWingFlat draws actually land inside frame; the
   * third spot at (-30,14) is deleted outright — it never entered frame at
   * any camera this file has used. Base/rim lifted a full step lighter
   * (0x24541f/0x3d7a33 -> 0x3a6b2c/0x5a9440) so individual lobes separate
   * from the field instead of reading as one black mass. The scarecrow and
   * tire swing were moved to x >= -8 (see _placeCoopYard / GROVE) so they
   * clear this wing's silhouette entirely. */
  _placeForegroundFrame() {
    const spots = [{ x: -14, z: 16, s: 1.5 }, { x: 14.5, z: 10, s: 1.9 }]
    for (const spot of spots) {
      const wing = buildWingFlat(0x3a6b2c, 0x5a9440)
      wing.scale.setScalar(spot.s)
      this._place(wing, spot.x, spot.z, 1.4 * spot.s, Math.random() * Math.PI * 2)
    }
  }

  /** Overlap check that ignores world bounds (the treeline deliberately sits
   * past HALF, in the fog) and only guards against stacking on obstacles. */
  _isClearSpot(x, z, margin) {
    for (const o of this.obstacles) {
      const dx = x - o.x
      const dz = z - o.z
      const rr = o.r + margin
      if (dx * dx + dz * dz < rr * rr) return false
    }
    return true
  }

  /** One clump: 4-7 trees gaussian-scattered around baseAngle, varied scale
   * and per-instance canopy hue — never the same silhouette/size/hue twice.
   * Recession (fog blend + outline weight) is derived per-tree from its
   * actual post-jitter radius via smoothstep(60,115,r), not from which rank
   * called this method — a per-rank constant let a near-rank tree sitting
   * beyond a far-rank tree hold full saturation while its nearer neighbour
   * washed out, which read as two unrelated backdrops instead of one
   * receding space. ringR itself is jittered per clump (+/-12) so the near
   * and far ranks overlap in actual distance instead of forming two discrete
   * shells. */
  _placeTreeClump(baseAngle, ringR, { scaleMin = 0.7, scaleMax = 1.7 } = {}) {
    const clumpR = ringR + (Math.random() * 2 - 1) * 12
    const treeCount = 4 + Math.floor(Math.random() * 4)
    for (let i = 0; i < treeCount; i++) {
      const angle = baseAngle + gaussianRandom(0.06)
      const r = clumpR + gaussianRandom(4)
      const x = Math.cos(angle) * r
      const z = Math.sin(angle) * r
      const scale = scaleMin + Math.random() * (scaleMax - scaleMin)
      if (!this._isClearSpot(x, z, 1.1 * scale)) continue
      const t = smooth01(r, 60, 115)
      const base = TREE_BASE_HUES[Math.floor(Math.random() * TREE_BASE_HUES.length)]
      const hueDeg = (Math.random() - 0.5) * 24
      // No baked lerp toward FOG_COLOR here anymore — scene.fog (see World
      // constructor) already recedes this same geometry once per frame at
      // render time; baking a matching blend into the material color on top
      // of that double-applied the fade and, combined with the old warm/light
      // FOG_COLOR, washed the whole mid-ground to cream.
      const hex = jitterCanopyColor(base, hueDeg, 0)
      const tree = tintCanopy(makeTree(), hex)
      // Outline weight still fades with distance, but clamped at 0.6 so a
      // silhouette element (mid/far treeline) never loses its drawn ink edge
      // entirely — uncapped, a far-rank tree at r~115 would hit
      // fadeOutlineWithDistance's near-zero floor and read as a colored blob.
      const outlineT = Math.min(t, 0.6)
      if (outlineT > 0.03) fadeOutlineWithDistance(tree, outlineT)
      tree.scale.setScalar(scale)
      this._place(tree, x, z, 1.1 * scale, Math.random() * Math.PI * 2)
    }
  }

  /** Forest border built as two depth ranks instead of one uniform ring. The
   * old ring treated all 10 candidate slots as equally likely to be seen, but
   * against the default camera (forward ~(-6,0,-22), 34deg half-FOV off-axis)
   * only 3 of 10 ever fell inside frame — the other 7 were behind/beside the
   * eye, and random gaps could delete a third of the 3 that mattered. Now 6
   * clumps are spread across the camera-facing arc only (195-345deg, i.e.
   * negative-z / away-from-camera) and NEVER gapped, each doubled into a near
   * rank (r=72, bold, small) and a far rank (r=100, larger). Recession itself
   * (fog blend, outline weight) is no longer a property of the rank — see
   * _placeTreeClump — so the two ranks' jittered radii overlap into one
   * continuous depth gradient rather than reading as two discrete shells. 4
   * sparse clumps cover the rest of the ring for when the player orbits
   * around. */
  _placeTreeline() {
    const nearR = 72
    const farR = 100
    const facingCount = 6
    for (let i = 0; i < facingCount; i++) {
      const t = facingCount === 1 ? 0 : i / (facingCount - 1)
      const angleDeg = 195 + t * (345 - 195)
      const baseAngle = THREE.MathUtils.degToRad(angleDeg) + (Math.random() - 0.5) * 0.15
      this._placeTreeClump(baseAngle, nearR, { scaleMin: 1.4, scaleMax: 2.2 })
      this._placeTreeClump(baseAngle, farR, { scaleMin: 2.0, scaleMax: 3.0 })
    }
    const sparseCount = 4
    for (let i = 0; i < sparseCount; i++) {
      const angleDeg = 345 + Math.random() * 210 // wraps through 360 to 195
      const baseAngle = THREE.MathUtils.degToRad(angleDeg % 360)
      const far = Math.random() < 0.5
      this._placeTreeClump(baseAngle, far ? farR : nearR, { scaleMin: 1.2, scaleMax: 2.4 })
    }
  }
}
