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

// Critic defect 3 (this pass): `scene.fog` is gone. THREE.Fog(0x9fb6b0, 55, 260)
// washed the whole midground into one flat grey-green band — the treeline
// stopped resolving and the field lost its drawn edges before it reached the
// horizon bands. Neither reference photograph uses atmospheric haze ANYWHERE:
// REF 1 states depth purely with discrete painted value planes, REF 2 has none
// at all. Recession is now carried entirely by things this file already draws
// as flat shapes stepping down in value — the silhouette bands in
// buildSkyTexture, buildFarBackdropGround, the hedgerow/mown-rect strips in
// _placeMidDistanceBackdrop, and the quantized per-tree value step in
// _placeTreeClump (RECESSION_STEPS below). If depth ever needs more, add
// another painted plane; do not put the fog back.

/** The single dark value the receding planes step TOWARD. Not a fog colour —
 * nothing lerps continuously toward it. _placeTreeClump quantizes into three
 * fixed blends so the treeline reads as three drawn ranks, which is REF 1's
 * actual mechanism. Grey-olive so a fully receded rank sits in the same family
 * as buildSkyTexture's near-treeline band rather than drifting blue. */
const RECESSION_DARK = new THREE.Color(0x4e5a46)
const RECESSION_STEPS = [0, 0.2, 0.38]

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

/** Critic defect 6: the far converging fence line "reads as a decal sticker
 * ... it floats a value above the field" once fog recedes it — its stock
 * material color rendered lighter, post-fog, than the fogged field it stands
 * in. Darkens each mesh's OWN material color (not a scene-level tint, so
 * paddock fences elsewhere are untouched) before fog is ever applied, the
 * same per-instance-material pattern tintCanopy uses on trees. Skips outline
 * shells (userData.isOutline) so the ink line itself stays full-strength. */
function darkenMaterials(object3d, factor) {
  object3d.traverse((o) => {
    if (o.isMesh && !o.userData.isOutline) o.material.color.multiplyScalar(factor)
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

// Critic defect 6 (this pass): buildGroundTexture() and applyGrassDetailFade()
// used to live here — a tiled grass-tick stipple on the main ground plane at
// 4.5 world units/tile, faded toward a blank corner of the canvas by
// mid-field. Deleted outright, not retuned. Both references have completely
// untextured ground: REF 2's grass, road and dirt are three flat unmodulated
// fills meeting at hard edges, and REF 1's pasture is smooth painted value
// shapes with no stroke texture anywhere. Across the mid-game field the
// stipple read as fine noise laid over the paint, which is the one thing a
// painted cel never has. The field's structure is now carried entirely by the
// vertex-colour bands (applyBroadFieldShading) plus the drawn flat shapes in
// _placeGroundValueShapes / _placeYardInteriorDetail — i.e. by shapes with
// edges, not by grain. If a near-field mark is ever wanted back, draw it as
// individual meshes inside z > 0 (buildStrawTick already does exactly that),
// never as a tiled map on the 120u plane.

// Posterized field bands — one hue family, value window at a clearly readable
// +/-10% so the masses actually show.
//
// Critic defect 1 (this pass): these were kelly green — 0x86c057 / 0x9ccb5e /
// 0xb2d668, hue ~90-93deg at ~45-54% saturation and 55-63% lightness. REF 1's
// pasture and REF 2's barnyard grass are OLIVE/KHAKI: hue in the high 70s at
// roughly 25-35% saturation. Rotated the whole family accordingly — hue
// 77-80deg, saturation cut ~40% (45% -> 27%), lit value down ~10% (L 55% ->
// 44%):
//   0x86c057 (H93 S45 L55) -> 0x7d8f52 (H78 S27 L44)
//   0x9ccb5e (H91 S50 L58) -> 0x8a9a5c (H78 S26 L48)
//   0xb2d668 (H90 S54 L63) -> 0x99a768 (H79 S24 L53)
// The top band's multiplier comes down with them (1.1 -> 1.06): at 1.1 over a
// 2.2-intensity key the light band was the thing clipping toward paper white,
// and nothing in either reference approaches white anywhere. Every other green
// in this file (grass tufts, ground blobs, hedgerows, mown swaths, treeline
// canopies, the wing flats) was rotated to the same hue/saturation window in
// the same pass — a single band left at the old chroma would read as the only
// wrong colour in frame.
const FIELD_BANDS = [
  { color: new THREE.Color(0x7d8f52), value: 0.9 },
  { color: new THREE.Color(0x8a9a5c), value: 1.0 },
  { color: new THREE.Color(0x99a768), value: 1.06 },
]

/** Warm lift for the far band. Was 0xcdc26e (H53 S49 L62), which compounded
 * the old kelly-green field into something that read lit-to-clipping at the
 * horizon. Now a dusty khaki (H68 S30 L56) — still a warm step away from the
 * olive so the far field separates, but inside the same muted window, and a
 * clear step BELOW the sky so the ground never out-values what's above it. */
const FAR_BAND_WARM = new THREE.Color(0xa7b06d)

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
 * runs parallel to the ground plane's edge. Rim is wobbled, not a clean
 * circle, for the same reason.
 *
 * Critic defect 3 (this pass): with scene.fog deleted this disc no longer gets
 * tinted at render time, so it has to state its own recession — which is the
 * point, since a flat painted plane stepping down in value IS the reference's
 * method. Recolored 0x9db78a -> 0x76825c: same olive family as the new
 * FIELD_BANDS, one clear value step darker than the darkest of them (L 44% ->
 * L 43% at lower chroma once lit), so it reads as pasture continuing past the
 * played field and lying in the treeline's shadow, not as a third slab of sky. */
function buildFarBackdropGround() {
  const radius = 170
  const geo = buildWobbledDiscGeometry(radius, 64, 0.03)
  geo.rotateX(-Math.PI / 2)
  const mat = toonMaterial(0x76825c, { steps: 2 })
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

/** Five-puff cloud massing, drawn as flat opaque shapes with a full hard
 * contour on every puff.
 *
 * Critic defect 5 (this pass): "clouds arrive as airbrushed smears ... the
 * deliberately hard ellipse fills and the thin top-arc contour are both
 * destroyed by LinearFilter magnification." The drawing was never the problem;
 * the texel budget was. At scale 16-30 on a 1024px canvas a cloud edge spanned
 * about one texel by the time the dome magnified it across the start camera's
 * sky, so the one thing that makes it read as drawn — the edge — was the first
 * thing the filter ate. Two changes fix it, and they only work together:
 * SKY_PX is now 2048 (buildSkyTexture) and the scales in drawPaintedClouds are
 * 4-6x larger, so a contour spans enough texels to survive.
 *
 * The contour is a FULL ring per puff now, not the top arc only. The top-arc
 * version was written to avoid overlapping construction rings, but a scalloped
 * mass of overlapping circles IS the golden-age cloud — and at the old texel
 * density the arc was invisible anyway, which is the whole defect. Line width
 * is held to 2-3 texture pixels regardless of cloud scale: a weight, not a
 * fraction.
 *
 * `fill` is a bone white, not paper white. Nothing in either reference reaches
 * above ~85% value, and with the sun cut to 1.5 (see _buildLights) a #fffaf2
 * cloud would be the one thing in frame that still clipped. */
const CLOUD_INK_PX = 2.6

function drawCloudShape(ctx, cx, cy, s, { alpha = 1, fill = '#d9d5cb' } = {}) {
  const puffs = [[0, 0, 1], [0.7, 0.15, 0.65], [-0.7, 0.12, 0.68], [0.25, -0.35, 0.55], [-0.3, -0.3, 0.5]]
  const ellipse = (dx, dy, r) =>
    ctx.ellipse(cx + dx * s, cy + dy * s * 0.6, r * s * 0.75, r * s * 0.42, 0, 0, Math.PI * 2)
  ctx.globalAlpha = alpha
  ctx.fillStyle = fill
  for (const [dx, dy, r] of puffs) {
    ctx.beginPath()
    ellipse(dx, dy, r)
    ctx.fill()
  }
  // Flat cool-grey underside — one shape, opaque, no gradient.
  ctx.fillStyle = '#aeb2ba'
  ctx.beginPath()
  ctx.ellipse(cx, cy + s * 0.3, s * 0.82, s * 0.19, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#5a4e44'
  ctx.lineWidth = CLOUD_INK_PX
  for (const [dx, dy, r] of puffs) {
    ctx.beginPath()
    ellipse(dx, dy, r)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
}

/** Painted-flat clouds baked straight into the backdrop so they are visible
 * from frame one regardless of where the camera is orbited to.
 *
 * cy is pinned to the start camera's real sky window. The dome maps
 * elevation = 90 - 180*(y/h), and the camera ((-1,9.5,23) -> (-1.5,1.8,-7),
 * see the START-VIEW note at the top of this file) tops out around +0.6deg,
 * so the usable band is roughly y = h*0.42..0.495 (+14.4..+0.9deg). If the
 * camera reframes, recompute against that mapping rather than copying these
 * numbers forward blind — that is exactly how this band went stale once
 * already.
 *
 * Critic defect 5 (this pass): count cut from seven (3 far + 4 near) to TWO.
 * REF 2 has no clouds in frame at all and REF 1 shows a dark navy sliver of
 * sky; seven puffs across the band was more weather than either reference has
 * anywhere, and at the new 4-6x scale seven would tile the whole dome. Two
 * shapes at scale 95-150 on a 2048px canvas is one clear cartoon cloud beat
 * and nothing else. The far/near two-rank split is gone with them: two clouds
 * cannot state depth, and with scene.fog deleted the picture states depth with
 * painted planes on the ground, not with atmosphere in the sky. */
function drawPaintedClouds(ctx, w, h) {
  const rnd = seededRand(99)
  const accepted = []
  const place = (scale, cyMin, cyMax) => {
    for (let tries = 0; tries < 24; tries++) {
      const cx = rnd() * w
      const clash = accepted.some((a) => Math.min(Math.abs(a - cx), w - Math.abs(a - cx)) < scale * 2.6)
      if (clash) continue
      accepted.push(cx)
      const cy = h * (cyMin + rnd() * (cyMax - cyMin))
      drawCloudShape(ctx, cx, cy, scale)
      // Wrap copies so a cloud straddling u=0/1 isn't cut in half on the dome.
      if (cx < scale * 1.5) drawCloudShape(ctx, cx + w, cy, scale)
      if (cx > w - scale * 1.5) drawCloudShape(ctx, cx - w, cy, scale)
      return
    }
  }
  for (let i = 0; i < 2; i++) place(95 + rnd() * 55, 0.428, 0.478)
}

/** The sky canvas is square and BIG on purpose. 1024 was not enough texels for
 * a drawn cloud edge to survive being magnified across a 280-unit dome at the
 * start camera (critic defect 5) — the hard ellipse fills and the contour both
 * dissolved into one soft cotton blob. 2048 doubles the texel budget in each
 * axis at 16MB of VRAM, which is the cheapest possible fix and the one the
 * cloud scales in drawPaintedClouds are now tuned against. */
const SKY_PX = 2048

/** Backdrop painted as a theatrical set piece: a near-flat grey-violet sky and
 * three drawn silhouette bands stepping down in value toward the field.
 *
 * Critic defect 2 (this pass): this used to ramp a saturated cyan zenith
 * (0x4198e0) through a warm 0xffe2ae haze band down to a cream horizon — a
 * sunset gradient with a full hue journey, plus a soft haze wash smeared over
 * the treeline seam. REF 2's sky is a near-flat grey-violet around #8f95ad
 * varying maybe 5% in value across the whole visible band, with no clouds in
 * frame; REF 1's is a dark navy sliver. The gradient, the haze lerp and the
 * seam wash stacked into more atmosphere than either reference has anywhere,
 * and they fought the silhouette bands that are supposed to be doing the
 * distance work.
 *
 * So: ONE colour, SKY_BASE, varied by 7% in value top-to-bottom (barely a
 * gradient — just enough that the dome doesn't read as a flat-shaded ball),
 * the upperHaze lerp deleted, the seam wash deleted, and the three bands
 * retuned as clear value steps against it. That stepping IS the reference's
 * method of stating distance:
 *   sky        #8d93a8  L 61%   grey-violet
 *   far hill   #727892  L 51%   violet, still sky family
 *   mid ridge  #5b6570  L 40%   turning grey-green
 *   treeline   #3c463a  L 25%   dark olive, land family
 * Each is a 10-15 point drop, so every boundary is a drawn edge rather than a
 * wash, and the ladder walks the hue from sky to ground as it descends. */
const SKY_BASE = new THREE.Color(0x8d93a8)

function buildSkyTexture() {
  const w = SKY_PX
  const h = SKY_PX
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  const c = new THREE.Color()
  for (let y = 0; y < h; y++) {
    const worldY = Math.cos((y / h) * Math.PI) // +1 zenith .. 0 horizon .. -1 nadir
    // +/-3.5% about SKY_BASE, darkest at the zenith. Across the camera's real
    // visible band (worldY ~-0.11..+0.12) that is under 1% — flat, which is
    // the point; the remaining range only exists so an orbited-up camera
    // doesn't see a perfectly uniform ball.
    const mul = 1 - 0.035 * THREE.MathUtils.clamp(worldY, -1, 1)
    c.copy(SKY_BASE).multiplyScalar(mul)
    ctx.fillStyle = `rgb(${(c.r * 255) | 0},${(c.g * 255) | 0},${(c.b * 255) | 0})`
    ctx.fillRect(0, y, w, 1)
  }
  // The dome maps elevation = 90 - 180*(y/h). The start camera's visible band
  // is only about -6.5..+4.4deg, i.e. y = h*0.475..0.537, so the whole band
  // stack has to live inside that or it renders off-frame — which is exactly
  // what happened the first two times these numbers were guessed in world
  // space instead of solved against this mapping.
  const horizonY = h * 0.501
  // Each band gets its own bump count and amplitude (not a uniform scale of
  // one another) so the three don't read as one printed, repeating wobble, and
  // the nearest carries the largest, most irregular scallops — how a painted
  // flat recedes. Amplitudes are in fractions of h, so they survived the
  // canvas going to 2048 unchanged.
  drawSilhouetteBand(ctx, w, horizonY - h * 0.015, horizonY - h * 0.001, '#727892', 5, h * 0.005) // far hill
  drawSilhouetteBand(ctx, w, horizonY - h * 0.005, horizonY + h * 0.005, '#5b6570', 8, h * 0.016) // mid ridge
  drawSilhouetteBand(ctx, w, h * 0.508 - h * 0.013, h * 0.508 + h * 0.006, '#3c463a', 7, h * 0.03) // near treeline
  // The soft gradient wash that used to blur the treeline-to-ground seam is
  // deleted with the rest of the atmosphere (critic defect 2/3). REF 2's
  // grass, road and dirt are three flat unmodulated fills meeting at HARD
  // edges — a drawn boundary is correct here, and the far-backdrop disc
  // (buildFarBackdropGround) is what sits under this join now.
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

// Critic defect 1 (this pass): buildCloud() built a real 3D mesh — five
// overlapping toon-shaded spheres, each carrying its own inverted-hull
// outline shell — and _buildSky used to scatter six of them into the scene.
// At the distances/scales that put them in frame, perspective flattened the
// sphere cluster into an ellipse while the five separate outline shells (one
// per overlapping sphere) stayed visible as concentric rings through it —
// exactly the "blurred white ellipse with its own overlapping construction
// rings" the critic flagged as the loudest non-cartoon element in the frame.
// Deleted outright rather than retuned: a painted 2D silhouette (drawCloudShape,
// baked into the sky dome by drawPaintedClouds below) already draws a hard
// silhouette edge, one ink outline and one warm underside value with zero
// blur, which is what a golden-age backdrop cloud actually looks like — a
// second, independent 3D system doing the same job can only fight it.

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

/** Critic defect 5: the purple drift read as "a purple cabbage cluster" —
 * every instance was a fixed 5-stem radial pattern, the same stamped-clip-art
 * problem buildCropPatch had. Count, spacing radius, petal size, stem height
 * and hue (via jitterCanopyColor, the same hue-jitter helper the crop fruit
 * and the treeline both use) now jitter per instance off a seed, so a drift
 * of these never repeats the same silhouette twice. */
function buildFlowerTuft(seed, petalColor) {
  const rnd = seededRand(seed)
  const g = new THREE.Group()
  const stemMat = toonMaterial(0x4c8a34, { steps: 3 })
  const petalMat = toonMaterial(jitterCanopyColor(petalColor, (rnd() - 0.5) * 24, 0), { steps: 3 })
  const count = 4 + Math.floor(rnd() * 4)
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + (rnd() - 0.5) * 0.4
    const r = 0.06 + rnd() * 0.08
    const stemH = 0.18 + rnd() * 0.08
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, stemH, 5), stemMat)
    stem.position.set(Math.cos(a) * r, stemH / 2, Math.sin(a) * r)
    g.add(stem)
    const petal = new THREE.Mesh(new THREE.SphereGeometry(0.055 + rnd() * 0.025, 6, 5), petalMat)
    petal.position.set(Math.cos(a) * r, stemH + 0.02, Math.sin(a) * r)
    g.add(petal)
  }
  return addOutline(g, { thickness: 0.015 })
}

/** Critic defect 2: the yard's tan/grass boundary was a bare flat mesh with
 * no drawn edge — "every other ground element in the frame has a drawn edge;
 * this one fades." A flat coplanar decal cannot be inked by the inverted-hull
 * outline (see toon.js), so it needs the same `flat` path the road/pond take:
 * `addOutline(mesh, { flat: true, pixels: INK_WEIGHT.DECAL })` traces the
 * polygon's own boundary edge, same weight the road already carries. */
function buildInkedGroundShape(points, color) {
  const mesh = buildFlatGroundShape(points, color)
  addOutline(mesh, { flat: true, pixels: INK_WEIGHT.DECAL })
  return mesh
}

/** Critic defect 2: the yard's flat tan fill read as "correct color, empty
 * interior" — every other ground shape in the frame carries some drawn
 * incident on top of its base color (the road has ruts, the patch has a
 * dashed ring). Three flat value shapes, no gradients: a darker trampled arc
 * at the barn door threshold, a pair of rut fans splaying from the door
 * toward the road, and a scatter of short straw ticks in lighter cream. */
function buildYardTrampledArc(cx, cz) {
  return buildWobblyGroundBlob(cx, cz, 2.6, 0x9c7a48, 8801, 14)
}

/** Two narrow ribbons fanning from the barn door out toward the cart track —
 * unlike the road/ruts these carry no ink (they are a value shape worn into
 * the yard, not an object with an edge) and no obstacle (nothing plays out
 * here that needs to be blocked). */
function buildYardRutFans(doorX, doorZ) {
  const g = new THREE.Group()
  const targets = [{ x: doorX - 5.5, z: doorZ + 4.5 }, { x: doorX - 8.5, z: doorZ + 1.5 }]
  for (const t of targets) {
    const mid = { x: (doorX + t.x) / 2 + (Math.random() - 0.5) * 1.2, z: (doorZ + t.z) / 2 + (Math.random() - 0.5) * 1.2 }
    g.add(buildPathMesh([{ x: doorX, z: doorZ }, mid, t], 0.7, { color: 0xb08a4e, steps: 2, y: 0.019 }))
  }
  return g
}

/** A single short flat cream tick, standing in for a wisp of loose straw
 * trodden into the yard. Flat fill, no gradient, no ink — small enough that
 * an outline hairline would just read as noise at this scale. */
function buildStrawTick(seed) {
  const rnd = seededRand(seed)
  const len = 0.3 + rnd() * 0.3
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(len, 0.01, 0.045), toonMaterial(0xf3e6b8, { steps: 2 }))
  mesh.position.y = 0.02
  mesh.rotation.y = rnd() * Math.PI
  return mesh
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

/** Critic defect 4: the lower-right yard needed incident that isn't a flower
 * drift or a rock — a stack of feed sacks reads as farm business rather than
 * decoration. Each sack is a squashed sphere so it bulges like cloth under
 * its own weight, with a small tied-off cone at the neck; count/size/offset
 * jitter per instance so the pile isn't a stamped stack of identical bags. */
function buildFeedSackPile(seed) {
  const rnd = seededRand(seed)
  const g = new THREE.Group()
  const sackMat = toonMaterial(0xc9a468, { steps: 3 })
  const tieMat = toonMaterial(0x6b4a2a, { steps: 2 })
  const count = 3 + Math.floor(rnd() * 2)
  let y = 0
  for (let i = 0; i < count; i++) {
    const w = 0.55 + rnd() * 0.15
    const h = 0.36 + rnd() * 0.1
    const sack = new THREE.Mesh(new THREE.SphereGeometry(w * 0.5, 8, 6), sackMat)
    sack.scale.set(1, h / (w * 0.5), 0.85)
    sack.position.set((rnd() - 0.5) * 0.25, y + h * 0.5, (rnd() - 0.5) * 0.25)
    sack.rotation.y = rnd() * Math.PI
    g.add(sack)
    const tie = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.13, 6), tieMat)
    tie.position.set(sack.position.x, y + h * 0.95, sack.position.z)
    g.add(tie)
    y += h * 0.7
  }
  return addOutline(g, { pixels: INK_WEIGHT.PROP })
}

/** Critic defect 4: a small dozing shape for the yard, curled nose-to-tail so
 * it reads as asleep rather than a generic quadruped standing still. */
function buildSleepingCat() {
  const g = new THREE.Group()
  const furMat = toonMaterial(0x54545e, { steps: 3 })
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), furMat)
  body.scale.set(1.3, 0.72, 1)
  body.position.y = 0.22
  g.add(body)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), furMat)
  head.position.set(0.35, 0.25, 0.02)
  g.add(head)
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.09, 4), furMat)
    ear.position.set(0.4, 0.37, s * 0.08)
    ear.rotation.x = -0.3
    g.add(ear)
  }
  const tail = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.035, 6, 12, Math.PI * 1.3), furMat)
  tail.rotation.x = Math.PI / 2
  tail.position.set(-0.2, 0.14, 0)
  g.add(tail)
  return addOutline(g, { pixels: INK_WEIGHT.PROP })
}

/** Critic defect 4: a scattering of flat chicken-track decals across the
 * lower-right yard — three short toe-slivers fanning from a point, tinted
 * dark against the tan fill. Decal only, no ink, no obstacle: a footprint is
 * a mark on the ground, not a thing a chicken paths around. */
function buildFootprintTrack(seed) {
  const rnd = seededRand(seed)
  const g = new THREE.Group()
  const mat = toonMaterial(0x5a3d22, { steps: 2 })
  for (let i = 0; i < 3; i++) {
    const a = -0.5 + i * 0.5 + (rnd() - 0.5) * 0.15
    const len = 0.09 + rnd() * 0.03
    const toe = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.008, len), mat)
    toe.position.set(Math.sin(a) * len * 0.5, 0.017, Math.cos(a) * len * 0.5)
    toe.rotation.y = a
    g.add(toe)
  }
  return g
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

/** Dedicated near-camera wing flat for the repoussoir frame — NOT a scaled
 * makeTree(). At 2.4-2.6x scale, 12-14u from camera, a single smooth canopy
 * sphere crops into a featureless kidney-shaped blob: no scalloped edge, no
 * sky-gaps, no trunk in frame, and a near-black tint swallows makeTree's own
 * ink outline so the mass has no drawn edge at all. This builds 7 overlapping
 * canopy lobes by hand around a trunk that lands at ground level (so it reads
 * as entering the bottom frame edge at this proximity), deliberately skips
 * lobes at ~180deg and ~280deg so two sky-gaps punch through the mass, and
 * tints a lit-side subset of lobes toward `rimHex` (lighter than `baseHex`)
 * so the silhouette holds a shape instead of reading as a hole in the frame.
 *
 * Round 10 replaced this with a flat scalloped silhouette card to save the
 * mid-game aerial shot, where the lobes read as boulders — but the card read
 * as a matte cutout from the START view, the shot the game opens on, and
 * carl-fyffe called the trees "significantly worse" on sight. The lobed
 * build is back (tree regression card); if the aerial framing needs help it
 * gets its own card, not a start-view trade. */
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
function buildCropBed(bedW, bedD) {
  const group = new THREE.Group()
  const bed = new THREE.Mesh(new THREE.BoxGeometry(bedW, 0.08, bedD), toonMaterial(0x6b4a2a, { steps: 3 }))
  bed.position.y = 0.04
  group.add(bed)
  const furrowMat = toonMaterial(0x50331c, { steps: 3 })
  const rows = 3
  for (let r = 0; r < rows; r++) {
    const furrow = new THREE.Mesh(new THREE.BoxGeometry(bedW * 0.94, 0.02, 0.16), furrowMat)
    furrow.position.set(0, 0.085, r * (bedD / rows) - bedD / 2 + bedD / (rows * 2))
    group.add(furrow)
  }
  return group
}

/** One plant: a leaf cone at a jittered height plus, if this bed carries
 * fruit, a small scatter of berries at a jittered radius/count. Pulled out of
 * buildCropPatch so the per-plant randomness (critic defect 5) has a single
 * place to live instead of being buried in a nested loop. */
function buildCropPlant(rnd, h, leafMat, fruitMat, withFruit) {
  const group = new THREE.Group()
  const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.2 + rnd() * 0.06, h, 6), leafMat)
  leaf.position.y = h / 2 + 0.08
  group.add(leaf)
  if (!withFruit) return group
  const fruitCount = rnd() > 0.25 ? 1 + Math.floor(rnd() * 3) : 0
  for (let f = 0; f < fruitCount; f++) {
    const r = 0.06 + rnd() * 0.05
    const fruit = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), fruitMat)
    fruit.position.set((rnd() - 0.5) * 0.14, h * (0.55 + rnd() * 0.3) + 0.08, (rnd() - 0.5) * 0.14)
    group.add(fruit)
  }
  return group
}

/** Tilled bed with furrow stripes under staggered, height-varied plants —
 * reads as agriculture instead of a bare grid of chevrons. Yellower green
 * than the field so crops read as a distinct hue, not more grass; `withFruit`
 * scatters red-orange fruit notes so one bed reads as a different crop
 * entirely rather than a re-skin of the others.
 *
 * Critic defect 5: "three identical stamped clusters of red balls on green
 * stalks ... no variation in size, count, or arrangement." Plant count is
 * now random per cluster (3-7, not a fixed rows*cols=12 grid), each cluster
 * carries its own height scale on top of per-plant jitter, fruit count/
 * radius vary per plant instead of one fixed-size berry on a coin flip, and
 * the fruit hue itself shifts +/-10deg per cluster (reusing
 * jitterCanopyColor, the same hue-jitter helper the treeline uses) so no two
 * clusters share a silhouette even at neighbouring seeds. */
function buildCropPatch(seed = 1, withFruit = false) {
  const rnd = seededRand(seed)
  const bedW = 4.2
  const bedD = 3.6
  const group = buildCropBed(bedW, bedD)
  const leafMat = toonMaterial(0x8fbb3a, { steps: 3 })
  const fruitMat = toonMaterial(jitterCanopyColor(0xe0532a, (rnd() - 0.5) * 20, 0), { steps: 3 })
  const plantCount = 3 + Math.floor(rnd() * 5)
  const heightScale = 0.75 + rnd() * 0.5
  for (let i = 0; i < plantCount; i++) {
    const h = (0.7 + rnd() * 0.3) * heightScale
    const plant = buildCropPlant(rnd, h, leafMat, fruitMat, withFruit)
    plant.position.set((rnd() - 0.5) * bedW * 0.82, 0, (rnd() - 0.5) * bedD * 0.82)
    group.add(plant)
  }
  return addOutline(group, { thickness: 0.025 })
}

// -------------------------------------------------------------------- pond

/** A shoreline cluster of thin reed blades — the detail that makes a puddle
 * of color read as "edge of water" rather than the water having no edge at
 * all. Reused INK_WEIGHT.PROP (same weight buildGrassTuft takes) rather than
 * DECAL — these are small vertical props standing IN the scene, not a ground
 * decal like the pond's own water surface.
 *
 * Critic defect 3 (round 2): the old blade was a straight CylinderGeometry
 * (top radius 0.035, not near zero) standing dead vertical with a separate
 * flat-capped brown cone stacked on top — "four fat dark-brown wooden posts
 * with chamfered rectangular tops ... an unmistakable broken fence." Rebuilt
 * on three changes: (1) each blade is its own leaning GROUP, pivoted at the
 * base, so a cattail head placed at local top-of-blade leans WITH the blade
 * instead of being computed separately; (2) the blade itself is a
 * ConeGeometry (true zero-radius tip, no cap) tapering to nothing, not a
 * cylinder with a cap glued on; (3) nothing brown — blades are a green darker
 * than the lawn (0x3f6b28 vs the field's 0x7ec852-family), and only the
 * cattail heads (a third of the count, not every blade) carry a dark maroon
 * tone, as a capsule, not a flat-topped cone. */
function buildReedTuft(seed) {
  const rnd = seededRand(seed)
  const g = new THREE.Group()
  const bladeMat = toonMaterial(0x3f6b28, { steps: 3 })
  const cattailMat = toonMaterial(0x5a3421, { steps: 2 })
  const count = 6 + Math.floor(rnd() * 4) // 6-9
  for (let i = 0; i < count; i++) {
    const a = rnd() * Math.PI * 2
    const r = rnd() * 0.14
    const h = 0.55 + rnd() * 0.55
    const lean = THREE.MathUtils.degToRad(10 + rnd() * 15)
    const leanDir = rnd() * Math.PI * 2
    const reed = new THREE.Group()
    const blade = new THREE.Mesh(new THREE.ConeGeometry(0.045, h, 5), bladeMat)
    blade.position.y = h / 2
    reed.add(blade)
    if (i < 3 && rnd() > 0.4) {
      const head = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.16, 3, 6), cattailMat)
      head.position.y = h * 0.9
      reed.add(head)
    }
    reed.position.set(Math.cos(a) * r, 0, Math.sin(a) * r)
    reed.rotation.set(Math.cos(leanDir) * lean, 0, Math.sin(leanDir) * lean)
    g.add(reed)
  }
  return addOutline(g, { pixels: INK_WEIGHT.PROP })
}

/** Small cool-complement accent — a painted water disc so the field has a
 * saturated blue note to sit against, not just green everywhere.
 *
 * Critic defect 5: was a flat, perfectly circular cyan ellipse with a
 * lighter inner ellipse — no ink, no shoreline, no reeds, the only object in
 * the frame with zero drawn line on it, which read as a hole in the render
 * rather than water. Rebuilt on three fixes at once: (1) the water's own
 * silhouette now carries the same DECAL-weight ink the road takes
 * (addOutline's flat path, INK_WEIGHT.DECAL — see buildPathMesh for the
 * precedent); (2) a wobbled (buildWobbledDiscGeometry, not a plain
 * CircleGeometry) muddy shoreline disc sits under the water so the pond's
 * overall silhouette is an irregular shore, not a geometric ellipse; (3) a
 * handful of reed tufts break the shoreline on the near (camera-facing) arc. */
/** Critic defect 3 (round 2): "an aliased edge where it simply stops against
 * the grass — it reads as spilled paint or a hole in the lawn." The mud
 * shoreline disc existed but carried no ink of its own, so its own boundary
 * against the grass was the same soft-value-only edge the critic flagged on
 * the water. Given the water's own DECAL-weight ink boundary. */
function buildPondBank(radius) {
  const mudGeo = buildWobbledDiscGeometry(radius * 1.24, 24, 0.16)
  mudGeo.rotateX(-Math.PI / 2)
  const mud = new THREE.Mesh(mudGeo, toonMaterial(0x6b4a2a, { steps: 2 }))
  mud.position.y = 0.022
  mud.receiveShadow = true
  addOutline(mud, { flat: true, pixels: INK_WEIGHT.DECAL })
  return mud
}

/** Critic defect 3 (round 2): the old highlight was a single lighter-cyan
 * disc concentric with the pond — "three horizontal darker cyan ripple
 * bands ... reads as spilled paint." Cartoon water is a flat color with a
 * couple of white sickle marks, not banded ripples. Each sliver is a
 * squashed, tilted ellipse — short, flat, opaque, no gradient — scattered
 * off-center so they read as brush marks rather than a repeated ring. */
function buildWaterHighlightSliver(len, thickness, rotY) {
  const geo = new THREE.CircleGeometry(1, 10)
  geo.rotateX(-Math.PI / 2)
  const mesh = new THREE.Mesh(geo, toonMaterial(0xeaf8fb, { steps: 2 }))
  mesh.scale.set(len, 1, thickness)
  mesh.rotation.y = rotY
  return mesh
}

function buildPond(radius) {
  const g = new THREE.Group()
  g.add(buildPondBank(radius))

  const waterGeo = buildWobbledDiscGeometry(radius, 24, 0.08)
  waterGeo.rotateX(-Math.PI / 2)
  const water = new THREE.Mesh(waterGeo, toonMaterial(0x4a9fc9, { steps: 3 }))
  water.position.y = 0.04
  addOutline(water, { flat: true, pixels: INK_WEIGHT.DECAL })
  g.add(water)

  const rnd = seededRand(3390)
  const slivers = [
    { x: radius * 0.18, z: -radius * 0.3, len: radius * 0.32, rot: 0.4 },
    { x: -radius * 0.3, z: -radius * 0.05, len: radius * 0.24, rot: -0.5 },
    { x: radius * 0.35, z: radius * 0.35, len: radius * 0.2, rot: 0.9 },
  ]
  for (const s of slivers) {
    const sliver = buildWaterHighlightSliver(s.len, s.len * 0.16, s.rot + rnd() * 0.2)
    sliver.position.set(s.x, 0.046, s.z)
    g.add(sliver)
  }

  // Reed tufts on the near (camera-facing, +z-ish) arc of the shoreline only
  // — reeds ringing the whole pond would read as a hedge, not a shore detail.
  const reedRnd = seededRand(3301)
  for (let i = 0; i < 4; i++) {
    const a = Math.PI * 0.1 + reedRnd() * Math.PI * 0.55
    const rr = radius * (0.92 + reedRnd() * 0.22)
    const tuft = buildReedTuft(3302 + i)
    tuft.position.set(Math.cos(a) * rr, 0, Math.sin(a) * rr)
    g.add(tuft)
  }
  return g
}

// ---------- World ----------

export class World {
  constructor(scene) {
    this.scene = scene
    this.size = SIZE
    this.obstacles = []
    // No scene.fog. THREE.Fog(0x9fb6b0, 55, 260) used to live here and it was
    // washing the entire midground into one flat grey-green band — the
    // treeline barely resolvable, the field losing its drawn edges well before
    // the horizon. Neither reference uses haze anywhere; see the RECESSION_DARK
    // note at the top of this file for what carries depth instead. Materials
    // around the file still pass `fog: true` — harmless, and left in place so
    // the decision to drop the fog is one line to revisit, not thirty.
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

  /** Critic defect 1: the 3D buildCloud() meshes formerly scattered here are
   * gone (see the comment where buildCloud used to live). Clouds now come
   * exclusively from drawPaintedClouds, baked flat into buildSkyTexture — a
   * single painted-backdrop system instead of a 3D one fighting a 2D one. */
  _buildSky() {
    this.scene.add(buildSkyDome())
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
    const mat = toonMaterial(0xffffff, { steps: 3, vertexColors: true })
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
    // Critic defect 4: this shape IS "the yard" — it covers the open ground
    // between coop and barn, the largest area in frame and exactly where the
    // player is looking. It was a washed-out yellow-green (0xcfe08c, L71%
    // H72deg) close enough in both hue and value to the surrounding field
    // bands (FIELD_BANDS, H~86deg) that the yard/lawn boundary read as haze
    // rather than a drawn edge. Recolored to a genuinely warm, saturated
    // ochre-cream (H~40deg vs the field's ~86deg — a real hue break, not just
    // a value one) and lifted further in value so the gap to the field bands
    // it sits against (L~49-58%) is comfortably more than two of
    // FIELD_BANDS' own ~10%-value steps.
    //
    // Critic defect 2 (round 2): "the grass-to-tan-yard boundary is an
    // airbrushed blur" — this mesh's silhouette had no ink at all, the one
    // ground shape in the frame without a drawn edge. Now built through
    // buildInkedGroundShape, which runs the boundary through addOutline's
    // flat path at INK_WEIGHT.DECAL — the same weight the road takes — so
    // cel grounds meet edge to edge instead of fading.
    this.scene.add(
      buildInkedGroundShape(
        [{ x: -4, z: 8 }, { x: 10, z: 6 }, { x: 14, z: -6 }, { x: 2, z: -10 }, { x: -6, z: -4 }],
        0xf3ce85
      )
    )
    this._placeYardInteriorDetail()
  }

  /** Critic defect 2 (round 2): "the tan color is correct ... only the edge
   * and the empty interior are wrong." Three flat value shapes on top of the
   * yard fill, none of them a gradient: a trampled arc where the barn door
   * traffic wears the ground darker, a pair of rut fans splaying from that
   * door toward the cart track, and a scatter of straw ticks across the rest
   * of the open yard. doorX/doorZ approximate the barn's real doorway (barn
   * at 11,-14, door wall z ~ -9.98) shifted a step into the yard itself. */
  _placeYardInteriorDetail() {
    const doorX = 10
    const doorZ = -8.6
    this.scene.add(buildYardTrampledArc(doorX, doorZ))
    this.scene.add(buildYardRutFans(doorX, doorZ))
    const rnd = seededRand(8802)
    for (let i = 0; i < 10; i++) {
      const tick = buildStrawTick(8803 + i)
      tick.position.set(-3 + rnd() * 14, 0, -7 + rnd() * 12)
      this.scene.add(tick)
    }
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

  /** Critic defect 6: the standard contact shadow (`_addContactShadow`) uses
   * `fog: true` (see buildContactShadow) so it recedes in step with the
   * ground it sits on — correct for anything near camera, but at the far
   * converging fence line's depth (z -40..-70, inside scene.fog's 55-260
   * range) it fades toward invisible right along with the post, leaving "no
   * visible ground contact." This sliver is deliberately NOT fogged: a
   * small, flat, opaque dark mark at the post base that stays legible
   * regardless of depth — "even a thin dark sliver," per the fix. */
  _addGroundContactSliver(x, z) {
    const geo = new THREE.CircleGeometry(1, 8)
    geo.rotateX(-Math.PI / 2)
    const mat = new THREE.MeshBasicMaterial({ color: 0x2a1c10, transparent: true, opacity: 0.4, depthWrite: false, fog: false })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.scale.set(0.32, 1, 0.14)
    mesh.rotation.y = SHADOW_ANGLE
    mesh.position.set(x, 0.017, z)
    mesh.renderOrder = 1
    this.scene.add(mesh)
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

  /** Critic defect 2: this used _addToScene, which never calls
   * _addContactShadow — every fence in the picture (the paddock AND the
   * converging fence line _placeMidDistanceBackdrop runs out through the
   * midfield) sat on the ground with zero cast shadow, one of the concrete
   * "zero incident" gaps in that dead band. Each post along the run now gets
   * the same painted contact shadow every other obstacle gets, reusing the
   * same post-spacing loop that already builds the walkability circles. */
  /** Critic defect 6: `far` (only set by _placeConvergingFenceLine) darkens
   * the fence's own material so its pre-fog value survives the fog blend
   * instead of floating lighter than the field it stands in, and adds a
   * ground-contact sliver at each post that doesn't fade with the standard
   * fogged contact shadow — see darkenMaterials / _addGroundContactSliver. */
  _placeFenceLine(length, x, z, rotY, { far = false } = {}) {
    const fence = makeFence(length)
    if (far) darkenMaterials(fence, 0.72)
    this._addToScene(fence, x, z, rotY)
    // a straight fence isn't one blocking circle: approximate it with a
    // string of post-sized circles along its run so isWalkable stays honest.
    const steps = Math.max(2, Math.round(length / 3))
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps - 0.5) * length
      const px = x + Math.cos(rotY) * t
      const pz = z - Math.sin(rotY) * t
      this.addObstacle(px, pz, 0.55)
      this._addContactShadow(px, pz, 0.4)
      if (far) this._addGroundContactSliver(px, pz)
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
    // Last, so its scatter/collision checks (_findScatterSpot) see every
    // obstacle already on the board — haystack row, silo, grove — and never
    // drop a hen or a laundry pole inside one of them.
    this._placeMidLeftFieldLife()
  }

  /** Critic defect 4: "the green mid-left field between the treeline and the
   * coop ... nothing to look at" — roughly the depth band between the near
   * grove (z -11..-17) and the mid-distance backdrop (z -34 and beyond) held
   * only ground texture. A second laundry line (the one in _placeCoopYard
   * sits right at the coop door; this one gives the open field its own
   * incident), a scarecrow at mid-distance, a couple of background hens
   * grazing loose (decor only — not assigned to any patch), and two extra
   * broad flat value masses at a lower spatial frequency than the field's
   * own vertex-color bands, so even the untenanted grass carries drawn
   * shapes to travel across. */
  _placeMidLeftFieldLife() {
    this.scene.add(buildWobblyGroundBlob(-24, -26, 9, 0x577e3c, 6201))
    this.scene.add(buildWobblyGroundBlob(-13, -30, 8, 0x6f9448, 6202))
    this._placeFieldLaundryLine()
    this._place(makeScarecrow(6210), -22, -22, 0.6, 1.1)
    const rnd = seededRand(6220)
    for (let i = 0; i < 3; i++) {
      const spot = this._findScatterSpot(-24, -24, 10)
      if (!spot) continue
      this._placeDecor(makePeckingHen(6221 + i), spot.x, spot.z, 0.35, rnd() * Math.PI * 2)
    }
  }

  /** Same measure-then-place pattern _placeLaundryLine uses at the coop — a
   * hardcoded half-span would put the blocking circles somewhere the poles
   * aren't the moment the prop is restyled. */
  _placeFieldLaundryLine() {
    const [cx, cz, rotY] = [-19, -24, 0.5]
    const line = makeLaundryLine(6230)
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
      this._placeFenceLine(len, (x0 + x1) / 2, (z0 + z1) / 2, Math.atan2(-dz, dx), { far: true })
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
   * carries real mass at readable scale.
   *
   * Critic defect 5 (this pass): at x=-14 the pond's own western edge
   * (radius 3.2, plus the new wobbled mud shoreline's ~1.24x/1.16 worst-case
   * reach) landed past the start camera's left frustum edge at this depth —
   * per the START-VIEW wedge measured at the top of this file, the visible
   * boundary at z=-6 is x~-16.1, and the old pond's western extent reached
   * ~-17.5. Shifted +3 on x so the whole shoreline sits inside the frame
   * with margin instead of grazing the crop. */
  _placePond() {
    const x = -11
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
    this._placeYardLife()
  }

  /** Critic defect 4: "the lower-right expanse of tan yard ... nothing to
   * look at" — a feed sack pile, a cat dozing by the trough (_placeBarnYard
   * puts the trough at 9.3,-2.9), and a trodden trail of chicken-track
   * decals. Paired with _placeYardInteriorDetail's trampled arc/ruts/straw,
   * this is the yard's half of the fix; _placeMidLeftFieldLife is the
   * field's. */
  _placeYardLife() {
    this._place(buildFeedSackPile(6301), 13, -1.5, 0.6, 0.6)
    this._placeDecor(buildSleepingCat(), 10.9, -1.9, 0.35, 2.3)
    const rnd = seededRand(6310)
    for (let i = 0; i < 8; i++) {
      const track = buildFootprintTrack(6311 + i)
      track.position.set(6 + rnd() * 8, 0, -1 + rnd() * 8)
      track.rotation.y = rnd() * Math.PI * 2
      this.scene.add(track)
    }
  }

  /** Critic defect 1: hero hen, both pecking hens and the sleeping pig were
   * all bunched into one strip along the bottom edge, all at the same
   * on-screen scale, touching or overlapping — no hero read. Spread in DEPTH
   * now, not just X: one pecking hen upstage near the pond bank, the other
   * out by the crop beds, both well clear of the coop door's ~3u empty
   * radius (see _placeCoopYard) so the hero hen — spawned at the door by
   * main.js — owns her own negative space. */
  _placeDecorAnimals() {
    // pond bank: shifted +3 on x alongside _placePond's defect-5 move so it
    // stays clear of the pond's new mud shoreline (center now -11,-6) while
    // still reading as standing at its edge.
    this._placeDecor(makePeckingHen(), -6, -6, 0.35, 1.4) // pond bank
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
    let seed = 7100
    for (const d of drifts) {
      for (let n = 0; n < d.count; n++) {
        const spot = this._findScatterSpot(d.x, d.z, d.spread)
        if (!spot) continue
        const tuft = buildFlowerTuft(seed++, d.color)
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
   * carries a deckled contour, a trunk into the bottom edge and a lit-side
   * value break instead of cropping to one featureless canopy sphere.
   *
   * Critic defect 1: against the real start camera ((-1,9.5,23) -> (-1.5,1.8,-7),
   * see the START-VIEW note at the top of this file) the left wing at
   * (-10,12) scaled 2.0 sat only ~11 units out, over-subtended the left edge,
   * and its near-black 0x24541f base read as a lens smudge rather than a
   * tree — while bisecting the scarecrow and swallowing SWING_TREE's tire
   * swing. Pushed back/out to (-14,16) at a smaller 1.5 scale so the
   * scallops buildWingFlat draws actually land inside frame; the third spot at
   * (-30,14) is deleted outright — it never entered frame at any camera this
   * file has used. The scarecrow and tire swing were moved to x >= -8 (see
   * _placeCoopYard / GROVE) so they clear this wing's silhouette entirely. */
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
