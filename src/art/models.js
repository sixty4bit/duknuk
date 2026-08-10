import * as THREE from 'three'
import { toonMaterial, addOutline, INK_WEIGHT } from './toon.js'

// Every builder returns a THREE.Group whose origin sits at ground contact and
// which faces +Z. Primitives only. Cartoon proportions beat real ones: big
// heads, fat silhouettes, chunky readable shapes at 50 m.

const INK = 0x1a1208
const P = {
  // Warm cream, not paper white: the hen has to sit *below* the sky and the
  // barn trim in value, or she has no silhouette weight on bright grass.
  hen: 0xf7e9cc,
  henShade: 0xd6a24e,
  comb: 0xe03a2c,
  beak: 0xf5a623,
  shell: 0xfdf3da,
  barnRed: 0xc8352b,
  barnDark: 0x9b2620,
  /**
   * The roof is a DIFFERENT VALUE, not a different hue.
   *
   * barnDark sat only 25% under barnRed, which the sun then closed further on
   * the lit plane: the roof and the wall arrived as one red mass with a seam in
   * it. This is 45% under — a 1.8:1 step, the separation a painted cel would
   * give the two biggest planes on the biggest object in the frame.
   */
  barnRoof: 0x741c14,
  /**
   * The UPPER (shallow) gambrel pitch, a full value step over the lower one.
   *
   * A gambrel carried by a hairline crease on one flat red mass is one shape
   * with a line drawn on it. Two pitches painted two values is two shapes, and
   * that reads from across the field even when the crease is a pixel wide. The
   * shallow pitch faces more sky, so it is the lighter of the two: wall
   * (0xc8352b) > upper roof > lower roof, a clean three-rung ladder.
   */
  barnRoofUp: 0xa8301f,
  cream: 0xfff4d6,
  wood: 0xb07a3e,
  woodDark: 0x7d5228,
  dark: 0x2a1c10,
  // Deep warm umber for interiors seen through an opening. Never P.dark: a
  // near-black plate at this scale reads as a missing texture, and the darkest
  // note in the frame has to be a deliberate anchor, not an accident.
  loft: 0x3d2410,
  hay: 0xe8b23c,
  hayDark: 0xc7902a,
  /**
   * A step lighter than she used to be (0xf4a3b6).
   *
   * The gag is a pig lying across the road, and the road is warm dirt. At the
   * old value the pink sat inside a hair of the dirt's, so the animal fused
   * with the ground and the obstacle never read. Pushed up, she separates from
   * the road on VALUE, which is the only separation that survives at 50 m.
   */
  pig: 0xf9b9c8,
  pigDark: 0xd97e96,
  // Warm mid-brown, not near-black: dark hooves under a belly read as four
  // planted boots and stand the animal back up.
  hoof: 0x7b5637,
  /**
   * Interior feather ink — a full step lighter than the silhouette's 0x1a1208.
   *
   * A drawn cel never details a form in the same weight it contoured it with:
   * the moment a wing bar is as black as the outline, it stops being feathers
   * and becomes a scratch, a censor bar or a texture glitch. This is warm
   * brown, so on cream plumage it reads as a drawn stroke rather than a hole.
   */
  featherInk: 0x8a6338,
  leaf: 0x4fa33c,
  leafLight: 0x74c94b,
  trunk: 0x8a5a2e,
  suit: 0x4a6fb0,
  // Small-prop palette. Every one of these is a saturated note the eye can
  // land on between the barn red and the grass green — a prop in a cartoon is
  // there to be SEEN, so nothing here is desaturated "realistic" farm grey.
  burlap: 0xd9b478,
  denim: 0x3f6fb5,
  denimPale: 0x86b0dd,
  crow: 0x2a2233,
  rubber: 0x332e2f,
  metal: 0xd6e0e6,
  metalDark: 0x9fb2bd,
  rope: 0xdcb877,
  grain: 0xf2c53d,
  // ONE blue for every body of water on the farm. The trough used to be a cyan
  // 0x5fb8d6 lid next to a 0x4a9fc9 pond, which is two different liquids in one
  // frame; a cartoon farm has one water colour and one highlight on it.
  water: 0x3d86ad,
  // The shaded body of the water, against the wall it is held in. A container
  // of water is two tones and a line; a single flat plate on top of a box is a
  // plastic lid, which is exactly what the trough read as.
  waterDeep: 0x2b6787,
  // The lit plane of the same liquid. Kept bright, because a cel draws still
  // water as two tones and a line, and the line is the glare streak.
  waterLight: 0x8ed3ea,
  mud: 0x9b7c4a,
}

// ---------------------------------------------------------------- primitives

/**
 * Ramp steps for the shape currently under construction — which is the same
 * choice as PAINTED versus DRAWN (see toon.js `toonMaterial`).
 *
 * ARCH (2) is the background profile: the plane break is a shallow tint, so a
 * barn wall is one flat red edge to edge and a hay mound is one flat ochre, the
 * way a painted cartoon background does it. It used to be a 2:1 break, which on
 * a low-poly lathe or cylinder lands as a curved terminator — a modelled
 * object, and no amount of flat colour either side of it reads otherwise.
 *
 * CHARACTER (3) keeps the full break. The hen, the pig and the figures are what
 * the shot is about; they are the only things that get sculpted, exactly as
 * they are the only things that get ink.
 */
const STEPS = { ARCH: 2, CHARACTER: 3 }
let steps = STEPS.CHARACTER

/** Build `make()` with a given ramp-step count, restoring the previous one. */
function withSteps(n, make) {
  const previous = steps
  steps = n
  try {
    return make()
  } finally {
    steps = previous
  }
}

function meshOf(geometry, color, opts) {
  const m = new THREE.Mesh(geometry, toonMaterial(color, { steps, ...opts }))
  m.castShadow = true
  m.receiveShadow = true
  return m
}

const ball = (r, color, seg = 20) =>
  meshOf(new THREE.SphereGeometry(r, seg, Math.max(8, seg >> 1)), color)
const box = (w, h, d, color) => meshOf(new THREE.BoxGeometry(w, h, d), color)
const tube = (rTop, rBot, h, color, seg = 16) =>
  meshOf(new THREE.CylinderGeometry(rTop, rBot, h, seg), color)
const spike = (r, h, color, seg = 14) => meshOf(new THREE.ConeGeometry(r, h, seg), color)

const at = (o, x, y, z) => (o.position.set(x, y, z), o)
const rot = (o, x = 0, y = 0, z = 0) => (o.rotation.set(x, y, z), o)
const scl = (o, x, y = x, z = x) => (o.scale.set(x, y, z), o)
/** Tiny features that an outline would swallow (pupils, nostrils). */
const detail = (o) => ((o.userData.noOutline = true), (o.castShadow = false), o)

/**
 * A line the ARTIST drew, as opposed to one the renderer found.
 *
 * The interior-ink pass can only stroke an edge that exists in the mesh, and
 * the places a cartoon most needs a line — the break between a hen's wing and
 * her body, the quill down a tail feather — are drawn on surfaces that are one
 * smooth blob with no edge anywhere in them. So the line is modelled: a thin
 * ink slab that PIERCES the form it belongs to rather than floating on it, so
 * it stays welded to a curved surface at every angle instead of lifting off at
 * the ends. Never outlined and never shadowed — it IS the outline.
 */
const inkSlab = (x, y, z) => detail(box(x, y, z, INK))

/**
 * Opt a mesh out of the interior-ink pass.
 *
 * Crease extraction cannot tell a form break from a tessellation seam, and on
 * a rope, a straw or any other pencil-thin cylinder the two are the same edge:
 * six facet lines drawn across a 4 cm cylinder don't describe it, they fill it
 * in solid. Anything whose whole diameter is about one pen width goes here.
 */
const noInterior = (o) => ((o.userData.noInteriorInk = true), o)

function extruded(shape, depth, color, curveSegments = 8) {
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments })
  geo.translate(0, 0, -depth / 2)
  return meshOf(geo, color)
}

/**
 * Deterministic wobble: same seed → same prop, every reload. The seed is
 * avalanche-mixed and the low bits are discarded, so seeds 1, 2, 3 give three
 * *different* props instead of three near-identical ones (a raw LCG moves by
 * 4e-4 per unit of seed, which is what made every haystack a twin).
 */
function seeded(seed) {
  let s = (Math.imul(seed >>> 0, 2654435761) ^ 0x9e3779b9) >>> 0
  const next = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return ((s >>> 8) & 0xffffff) / 0x1000000
  }
  next()
  next()
  return next
}

// Props built without an explicit seed still have to differ from each other:
// forty-six identical trees read as one motif stamped in a row.
let propSerial = 0
const nextSeed = () => (propSerial = (propSerial + 1) >>> 0)

const clockNow = () =>
  (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000

// ------------------------------------------------------------------- chicken

// The comb, beak, wattles and feet are the only saturated red/orange in the
// hen. They are the handles the eye grabs to find her, so they are drawn well
// past life-size relative to the skull.
/**
 * Lobes as [y, z, height], and why they all sit forward of the skull's centre.
 *
 * The comb is the hen's primary silhouette identifier — it is the shape that
 * says "chicken" before the beak, the tail or the colour do. Sat level on top
 * of a sphere it reads as a red growth on the back of her neck in three-
 * quarter, because the skull's own mass hides everything behind its crown.
 * The crest has to LEAD the head: the tallest lobe overhangs the brow, the
 * front lobe cantilevers out past the skull entirely (z 0.235 + the group's
 * 0.05 against a 0.175 radius), and every lobe is raked forward so the whole
 * crest points where she is going.
 */
/**
 * Every lobe is ~35% larger than it was, and the crest sits a shade lower.
 *
 * At thumbnail size the hen was reading as "white ellipsoid with a small head":
 * the body carried the whole silhouette and the one shape that says CHICKEN was
 * too small to survive the downsample. The comb and the beak are the hen's
 * identifiers, so they are drawn at identifier scale — 0.096 → 0.13 on the
 * lobes, 0.115 → 0.155 on the blade under them — while the body loses 10% (see
 * buildChicken). The anchor drops 0.125 → 0.115 to spend the extra height on
 * the crest rather than on the hen's overall stature.
 */
const COMB_LOBES = [[0.082, 0.246, 1.3], [0.125, 0.11, 1.55], [0.09, -0.026, 1.3]]
const COMB_RAKE = -0.3

function henComb() {
  const comb = new THREE.Group()
  // One continuous blade under the points, raked down at the front so it lands
  // on the brow. A comb is a single crest with points cut into it; three loose
  // blobs perched on a skull leave the forward point floating in air the moment
  // the crest is pushed far enough forward to actually lead the head.
  comb.add(at(rot(scl(ball(0.155, P.comb, 14), 0.42, 0.5, 1.5), -0.18, 0, 0), 0, 0.02, 0.095))
  for (const [y, z, tall] of COMB_LOBES) {
    comb.add(at(rot(scl(ball(0.13, P.comb, 14), 0.5, tall, 1.0), COMB_RAKE, 0, 0), 0, y, z))
  }
  return comb
}

function henHead() {
  const head = new THREE.Group()
  head.add(ball(0.175, P.hen))
  // Forward along the head's +Z, not centred on the crown: the crest overhangs
  // the brow and the beak root, so it leads the head from any angle.
  const comb = at(henComb(), 0, 0.115, 0.05)
  head.add(comb)
  // Beak up 35% with the comb: the two saturated points of the head have to
  // move together or the enlarged crest just makes the face look smaller.
  head.add(at(rot(spike(0.111, 0.365, P.beak, 10), Math.PI / 2), 0, -0.03, 0.255))
  head.add(at(ball(0.078, P.comb, 12), 0, -0.115, 0.15))
  head.add(at(ball(0.058, P.comb, 12), 0, -0.195, 0.12))
  for (const s of [-1, 1]) {
    head.add(at(ball(0.066, P.shell, 12), 0.082 * s, 0.05, 0.115))
    head.add(detail(at(ball(0.04, INK, 10), 0.096 * s, 0.055, 0.15)))
  }
  head.userData.comb = comb
  return head
}

/**
 * Feather strokes: [length, butt radius, y, z, rake]. There is exactly ONE.
 *
 * There used to be three, and together they were the whole wing's read: three
 * grey-brown tapers laid across a cream blob that sat at the same value as the
 * flank behind it. The blob contributed nothing, so what arrived on screen was
 * three brown slivers with no shape around them — a dirt smear on the hen's
 * side, with no closed outline anywhere in it. The wing is built from two
 * inked SHAPES now (henWing), and the stroke is back to being what a stroke is
 * for: one drawn quill on a form that already reads without it.
 */
const WING_FEATHERS = [[0.22, 0.034, -0.115, -0.06, 0.14]]

/** One tapered stroke, flattened to a blade and pointed down the wing's trailing
 *  edge. Pierces the plumage instead of floating on it, so it stays welded to a
 *  curved surface at every camera angle — hence the x offset, which straddles
 *  the covert plate's own surface rather than sitting inside it (a stroke fully
 *  inside the plate draws nothing at all). */
function featherStroke([len, r, y, z, rake], side) {
  const blade = scl(spike(r, len, P.featherInk, 6), 0.3, 1, 1)
  // Apex to -Z (the tail) so the stroke thins toward its tip.
  const stroke = rot(detail(blade), -Math.PI / 2 + rake, 0.12 * side, 0)
  return at(stroke, 0.044 * side, y, z - len * 0.18)
}

/**
 * The wing is TWO closed shapes with a flat value break between them.
 *
 * A cream plate on a cream body separated by nothing is not a wing; whether the
 * toon ramp happens to break between them depends on where the sun is, and on
 * the shaded side it never does. So: the covert plate keeps the plumage's cream
 * and the primaries blade below it is a full step darker (P.henShade), and the
 * blade is pushed down and back far enough to hang PAST the torso's underside
 * at the rear — the wing owns a piece of the hen's silhouette instead of being
 * a stain inside it. Both are separate meshes, so addOutline closes an ink
 * contour around each: the break between covert and primaries is a drawn line,
 * and the wing has an outline that shuts.
 */
function henWing(side) {
  const wing = at(new THREE.Group(), 0.295 * side, 0.03, -0.03)
  wing.add(at(scl(ball(0.19, P.hen, 16), 0.26, 0.8, 1.15), 0.01 * side, -0.05, -0.02))
  const primaries = scl(ball(0.125, P.henShade, 14), 0.3, 0.62, 1.35)
  wing.add(at(rot(primaries, 0.22, 0, 0), 0.012 * side, -0.185, -0.2))
  for (const feather of WING_FEATHERS) wing.add(featherStroke(feather, side))
  return wing
}

/** One blade with its quill drawn down the middle. The quill is what makes a
 *  cone read as a FEATHER; three bare cones read as three cones. */
function tailFeather(spread, tone) {
  const feather = at(rot(new THREE.Group(), -0.95, 0, spread), 0, 0.12, -0.06)
  feather.add(scl(spike(0.085, 0.36, tone, 10), 0.42, 1, 1))
  feather.add(at(inkSlab(0.07, 0.2, 0.024), 0, -0.05, 0))
  return feather
}

// Fanned wider than the old ±0.4: at that spread the three blades overlapped
// almost exactly and the ink hulls swallowed each other, so the tail was one
// undifferentiated wedge. ±0.62 opens a gap the silhouette can read through.
const TAIL_FAN = [-0.62, 0, 0.62]

function henTail() {
  const tail = new THREE.Group()
  TAIL_FAN.forEach((a, i) => tail.add(tailFeather(a, i === 1 ? P.henShade : P.hen)))
  return tail
}

/**
 * The leg, and why the foot used to come off.
 *
 * The rig pivots each leg at the hip and the animator swings it ±0.55 rad,
 * while the body bobs and squashes on its own track. With a 4 cm shank and a
 * body whose underside hung to within 0.04 of the hip, the only part of the
 * limb outside the torso silhouette was the FOOT — so on the hero character,
 * at hero scale, you got an orange talon sitting on the road with a gap where
 * her leg should be. Three things fix it and all three are geometry:
 *
 * - one shank segment that SPANS hip to foot (0.34 long against a 0.32 drop,
 *   so it overlaps the pivot and can never shorten out of the socket),
 * - fat enough to survive the ink hull at viewing size (0.062 → 0.07, up from
 *   0.042 → 0.05), with a drawn hock knuckle so it reads as a jointed limb,
 * - a feathered thigh at the pivot itself, which is rotation-invariant: the
 *   hip is plugged at every point of the stride, at any amplitude.
 *
 * The foot also comes in: shorter toes and a rear spur, so it stops reaching
 * out past the body where it can be read on its own.
 */
/**
 * `hipY` — how far the socket sits above the ground.
 * `stance` — half the distance between the two legs.
 * `lift` — how far the SOLE floats above y=0 (see henFoot).
 *
 * The rig read as a torso resting on two yellow stubs, and the arithmetic says
 * why. The occluder above the shank is not the torso, it is the feathered thigh
 * (henThigh), and the thigh hung to `hipY - 0.155` while the shank ended at
 * `hipY - 0.33` — 0.175 of visible limb, 51% of a 0.34 shank, and that fraction
 * was INVARIANT under hipY, so raising the hip alone could never have fixed it.
 * Three numbers move instead: the thigh is flattened (0.8 in y) and lifted so
 * it stops at `hipY - 0.104`, the shank is dropped a further 0.02 so it ends at
 * `hipY - 0.36`, and the body loses 10%, which raises the torso's underside on
 * its own. That is 0.246 of bare shank, 72%, before the foot takes any of it.
 *
 * `stance` widens 0.11 → 0.155 (0.28 → 0.39 in world units after HEN_SCALE):
 * enough daylight between the two limbs that the far one is a separate shape at
 * the tycoon azimuth instead of hiding behind the near one. Wider than this is
 * a duck.
 */
const LEG = { hipY: 0.44, shank: 0.34, rTop: 0.062, rBot: 0.07, stance: 0.155, lift: 0.062 }

/**
 * Shank centre, relative to the hip.
 *
 * Derived rather than typed, because three numbers have to stay true at once
 * and they were drifting apart every time one of them moved: the tube must end
 * 0.02 ABOVE the sole (a shank finishing below the foot pad leaves a yellow rim
 * under it, which then becomes the model's lowest vertex and the first thing
 * the road cuts through), it must still reach the socket, and it must not
 * change length while doing either.
 */
const shankY = () => LEG.lift - LEG.hipY + 0.02 + LEG.shank / 2

/**
 * The foot is centred on the ankle, and the SOLE floats.
 *
 * Two separate failures live in this function. The first is reach: every
 * centimetre a toe extends ahead of the hip pivot is a centimetre the walk
 * cycle's ±0.55 rad swing drives downward (`y' = y·cosθ − z·sinθ`), and at the
 * old 0.165 reach that term beat the 0.056 the shank gains from its own
 * shortening — the front foot went under the road at mid-stride. At a 0.119
 * reach the sign flips: the toe RISES through the whole swing, so the sole's
 * rest height is also its lowest height.
 *
 * The second is that a rest height of exactly 0 is not clearance. The road and
 * the patch are drawn shapes lying at y=0.02 and y=0.03 with an ink line down
 * their boundary, so a sole at 0 is BEHIND them and the road's rut line cuts
 * across the toes. `LEG.lift` puts the sole at 0.079 in world units — clear of
 * both decals and of their ink, with 0.03 still in hand against the root's
 * ±0.06 walk roll, which tips the outboard foot down by 0.017.
 */
function henFoot() {
  const foot = at(new THREE.Group(), 0, LEG.lift - LEG.hipY, 0)
  foot.add(at(box(0.15, 0.055, 0.11, P.beak), 0, 0.0275, -0.008))
  for (const a of [-0.55, 0, 0.55]) {
    foot.add(at(rot(box(0.058, 0.05, 0.1, P.beak), 0, a, 0), Math.sin(a) * 0.062, 0.026, 0.048))
  }
  // Rear spur: three toes forward and nothing behind is a fork, not a foot.
  // Its lowest vertex is the model's lowest, at LEG.lift + 0.001.
  foot.add(at(box(0.055, 0.048, 0.085, P.beak), 0, 0.026, -0.075))
  return foot
}

function henLeg(side) {
  const leg = at(new THREE.Group(), LEG.stance * side, LEG.hipY, 0.02)
  leg.add(scl(ball(0.098, P.hen, 12), 1, 0.92, 1))
  leg.add(at(tube(LEG.rTop, LEG.rBot, LEG.shank, P.beak, 8), 0, shankY(), 0))
  leg.add(at(ball(0.054, P.beak, 10), 0, shankY(), 0))
  leg.add(henFoot())
  return leg
}

/**
 * Feathered thigh, parented to the BODY rather than to the leg.
 *
 * The animator bobs and squashes the body against legs that stay planted, so
 * the socket is a moving target. Hanging the thigh off the body means the hip
 * mass travels with every bob, squash and stretch, and it overlaps the shank
 * top by more than the whole bob amplitude — there is no pose that opens a gap
 * between torso and limb.
 */
function henThigh(side, bodyY) {
  // Flattened and lifted (was 0.135 round at hipY-0.02): the round thigh was
  // the thing swallowing the shank, and it was doing it for no silhouette gain
  // — a hen's thigh is a feathered wedge tucked under the flank, not a ball.
  // It still overlaps the shank top by 0.104, well past any bob amplitude.
  const thigh = scl(ball(0.13, P.hen, 12), 0.95, 0.72, 1.05)
  return at(thigh, LEG.stance * side, LEG.hipY - bodyY - 0.01, 0.02)
}

/** She is the subject of the game, so she is drawn at protagonist scale rather
 *  than at hen scale — the rig is built at natural proportion and blown up. */
const HEN_SCALE = 1.8

/** Body centre. Raised from 0.46 so the underside clears the hip: at 0.50 the
 *  ellipsoid bottoms out at 0.261 (0.234 before the 10% body reduction) and
 *  roughly three quarters of the shank is outside the torso, which is what
 *  makes the leg a limb instead of a talon. */
const HEN_BODY_Y = 0.5

/**
 * Torso radius, down 10% from 0.28.
 *
 * At thumbnail scale the hen was "a white ellipsoid with a small head", and the
 * cure for that is a ratio, not a bigger head alone: the body gives up 10% at
 * the same time the comb and beak take 35%. It also buys 0.027 of extra leg
 * clearance for free, because the underside comes up with it.
 */
const HEN_BODY_R = 0.252

function buildChicken() {
  const g = new THREE.Group()
  const rig = scl(new THREE.Group(), HEN_SCALE)
  const body = at(new THREE.Group(), 0, HEN_BODY_Y, 0)
  body.add(scl(ball(HEN_BODY_R, P.hen), 1.06, 0.95, 1.25))
  // Head rides high and forward so head-vs-body still reads as two shapes from
  // the steep tycoon camera. The offset is unchanged while the body shrank, so
  // the neck junction opens up rather than closing.
  const head = at(henHead(), 0, 0.28, 0.24)
  const wingL = henWing(-1)
  const wingR = henWing(1)
  const tail = at(henTail(), 0, 0, -0.26)
  body.add(head, wingL, wingR, tail)
  for (const s of [-1, 1]) body.add(henThigh(s, HEN_BODY_Y))
  const legL = henLeg(-1)
  const legR = henLeg(1)
  rig.add(body, legL, legR)
  g.add(rig)
  // She is the subject standing on the road: without a hard note under her she
  // hovers, exactly as the pig did.
  // 0.07 sits above every drawn ground shape she can stand on (road 0.02,
  // patch disc 0.03, rut ribbon 0.045) and below her lifted sole (0.112, see
  // LEG.lift), so the painted note is under the bird from any angle and no
  // decal punches through it.
  g.add(at(contactShadow(0.46, 0.36, 0.42), 0, 0.07, 0.02))
  g.userData.parts = { body, head, comb: head.userData.comb, wingL, wingR, legL, legR, tail }
  // Heaviest line in the frame: the subject reads before the props do. She is
  // built from smooth blobs, so crease extraction finds almost nothing on her —
  // the wing and tail lines are drawn explicitly, above.
  return addOutline(g, { pixels: INK_WEIGHT.HERO, interior: true })
}

/** Cream hen, ~2.2 to the comb tips: beach-ball body, oversized head, huge
 *  comb, two-tone wings, skinny legs, big splayed feet. The sole rests at
 *  y≈0.08, not 0 — see LEG.lift; anything that seats her by matching a foot to
 *  the terrain must account for it. */
export function makeChicken() {
  return withSteps(STEPS.CHARACTER, buildChicken)
}

// ----------------------------------------------------------------------- egg

// The egg is the single payoff of the whole loop, so it gets the heaviest line
// in the frame and a classic accent: the drawing tells you it happened before
// the sound does.
const EGG_H = 0.42
const EGG_ACCENT_TIME = 0.34
/** [time, xz, y] keys: squash flat, overshoot tall, settle. */
const EGG_POP = [[0, 1.4, 0.6], [0.12, 0.85, 1.25], [0.35, 1, 1]]

function eggShell() {
  const profile = []
  for (let i = 0; i <= 16; i++) {
    const t = (i / 16) * Math.PI
    const r = 0.175 * Math.sin(t) * (1 - 0.22 * Math.cos(t))
    profile.push(new THREE.Vector2(Math.max(0, r), (EGG_H / 2) * (1 - Math.cos(t))))
  }
  return meshOf(new THREE.LatheGeometry(profile, 18), P.shell)
}

/** Unlit flat cel accent — never outlined, never shadowed, drawn on top. */
function accentMesh(geometry, color) {
  const m = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, side: THREE.DoubleSide })
  )
  m.renderOrder = 2
  return detail(m)
}

function burstShape(points = 8, outer = 0.5, inner = 0.19) {
  const s = new THREE.Shape()
  for (let i = 0; i < points * 2; i++) {
    const a = (i / (points * 2)) * Math.PI * 2
    const r = i % 2 ? inner : outer
    const [x, y] = [Math.cos(a) * r, Math.sin(a) * r]
    if (i === 0) s.moveTo(x, y)
    else s.lineTo(x, y)
  }
  s.closePath()
  return s
}

/** White starburst plus four radiating ink dashes, lying flat on the grass. */
function eggAccents() {
  const g = new THREE.Group()
  const burst = accentMesh(new THREE.ShapeGeometry(burstShape()), 0xfffbe8)
  g.add(at(rot(burst, -Math.PI / 2, 0, 0), 0, 0.05, 0))
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.5
    const dash = accentMesh(new THREE.BoxGeometry(0.05, 0.02, 0.22), INK)
    dash.userData.dir = a
    g.add(at(rot(dash, 0, a, 0), 0, 0.05, 0))
  }
  return g
}

function eggPopScale(t) {
  const last = EGG_POP.length - 1
  if (t >= EGG_POP[last][0]) return [1, 1]
  let i = 0
  while (t > EGG_POP[i + 1][0]) i++
  const [t0, xz0, y0] = EGG_POP[i]
  const [t1, xz1, y1] = EGG_POP[i + 1]
  const k = (t - t0) / (t1 - t0)
  const e = k * k * (3 - 2 * k)
  return [xz0 + (xz1 - xz0) * e, y0 + (y1 - y0) * e]
}

function animateAccents(accents, t) {
  const k = t / EGG_ACCENT_TIME
  if (k >= 1) {
    accents.visible = false
    return
  }
  const ease = 1 - (1 - k) ** 2
  for (const child of accents.children) {
    child.material.opacity = 1 - ease
    const dir = child.userData.dir
    if (dir === undefined) child.scale.setScalar(0.35 + ease * 1.45)
    else child.position.set(Math.sin(dir) * (0.3 + ease * 0.4), 0.05, Math.cos(dir) * (0.3 + ease * 0.4))
  }
}

/** Self-driving: the egg animates itself off the wall clock from the moment it
 *  is built, so nothing outside models.js has to tick it. */
function driveEgg(rig, accents, driver) {
  const born = clockNow()
  driver.onBeforeRender = () => {
    const t = clockNow() - born
    const [xz, y] = eggPopScale(t)
    rig.scale.set(xz, y, xz)
    animateAccents(accents, t)
  }
}

function buildEgg() {
  const g = new THREE.Group()
  const rig = new THREE.Group()
  const shell = eggShell()
  rig.add(shell)
  const accents = eggAccents()
  g.add(rig, accents)
  driveEgg(rig, accents, shell)
  animateAccents(accents, 0)
  return addOutline(g, { pixels: INK_WEIGHT.HERO })
}

/** Off-white egg, ~0.42 tall, popping into existence with an ink starburst. */
export function makeEgg() {
  return withSteps(STEPS.CHARACTER, buildEgg)
}

// ---------------------------------------------------------------------- coop

function coopRoof() {
  const roof = new THREE.Group()
  for (const s of [-1, 1]) {
    // Same value step as the barn's roof-vs-wall, so the two red buildings are
    // painted by the same hand.
    roof.add(at(rot(box(2.7, 0.14, 1.36, P.barnRoof), 0.62 * s, 0, 0), 0, 2.42, 0.47 * s))
  }
  roof.add(at(box(2.8, 0.14, 0.2, P.cream), 0, 2.82, 0))
  return roof
}

function coopDoorway() {
  const front = new THREE.Group()
  front.add(at(box(0.72, 0.9, 0.16, P.dark), 0, 1.25, 0.82))
  for (const s of [-1, 1]) front.add(at(box(0.1, 1.0, 0.09, P.cream), 0.41 * s, 1.28, 0.92))
  front.add(at(box(0.94, 0.11, 0.09, P.cream), 0, 1.73, 0.92))
  front.add(at(box(2.36, 0.12, 0.1, P.cream), 0, 0.82, 0.91))
  return front
}

function coopRamp() {
  const ramp = at(rot(new THREE.Group(), 0.65, 0, 0), 0, 0.4, 1.42)
  ramp.add(box(0.76, 0.09, 1.32, P.wood))
  for (const z of [-0.42, -0.06, 0.3, 0.62]) ramp.add(at(box(0.76, 0.06, 0.09, P.woodDark), 0, 0.07, z))
  return ramp
}

function buildCoop() {
  const g = new THREE.Group()
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) g.add(at(tube(0.1, 0.13, 0.64, P.woodDark, 8), sx, 0.32, 0.72 * sz))
  }
  g.add(at(box(2.5, 0.18, 1.96, P.wood), 0, 0.72, 0))
  g.add(at(box(2.3, 1.25, 1.8, P.barnRed), 0, 1.43, 0))
  g.add(coopRoof(), coopDoorway(), coopRamp())
  for (const s of [-1, 1]) g.add(at(box(0.14, 1.3, 0.14, P.cream), 1.16 * s, 1.43, 0.88))
  const door = at(new THREE.Object3D(), 0, 0, 1.98)
  g.add(door)
  g.userData.door = door
  // Painted, not drawn. The coop is a building the hen acts against, and a
  // building in a cartoon background carries no black contour at all: the roof
  // reads against the wall on VALUE (P.barnRoof is a full step under
  // P.barnRed), the doorway reads because it is the darkest note on the box,
  // and the cream boards down the corners and across the front are the only
  // lines on it — light trim, exactly as the ref's white battens are.
  return addOutline(g, { pixels: INK_WEIGHT.BACKGROUND })
}

/** Red hen-house on stumpy legs, ~2.6 wide, ramp up to a dark doorway. */
export function makeCoop() {
  return withSteps(STEPS.ARCH, buildCoop)
}

// ---------------------------------------------------------------------- barn

function barnWallShape() {
  const s = new THREE.Shape()
  s.moveTo(-5, 0)
  s.quadraticCurveTo(-5.2, 2.1, -5, 4.2)
  s.lineTo(5, 4.2)
  s.quadraticCurveTo(5.2, 2.1, 5, 0)
  s.lineTo(-5, 0)
  return s
}

/**
 * The gambrel, as two straight pitches meeting at a hard crease.
 *
 * The roof used to be a smooth arc swept from eave to ridge — five quadratic
 * curves at 32 segments each. Every one of those facets is under the ink weight,
 * which is exactly the problem: nothing on it is ever a LINE, so the whole roof
 * arrived as one continuous half-cylinder shell. A bread loaf. A Quonset hut.
 * A barn's entire identity is the gambrel, and a gambrel is not a curve — it is
 * a steep lower pitch and a shallow upper pitch meeting at a break you can see
 * from across the field.
 *
 * The numbers are chosen so the break is DRAWN, not merely present: 64.4 deg
 * lower against 13.6 deg upper puts 50.8 deg between the two face normals,
 * clear of toon.js's 46 deg INTERIOR_ANGLE, so the interior-ink pass strokes
 * the knuckle the length of the barn. Under 46 (which is where a realistically
 * proportioned gambrel lands) the crease exists in the mesh and no pen ever
 * finds it.
 *
 * `fascia` gives the eave real thickness, and `eaveX` carries the roof 0.5–0.7
 * past the wall so there is an overhang to cast the dark cel plane onto the
 * wall head — the shadow line a roof gets for free in a drawing and never gets
 * from geometry that terminates flush.
 */
const GAMBREL = {
  eaveX: 5.7,
  eaveY: 3.95,
  fascia: 0.3,
  kneeX: 4.55,
  kneeY: 6.35,
  ridgeY: 7.45,
  depth: 8.7,
}

/** Underside of the eave. Every board ON the wall has to finish below it, or
 *  the overhang swallows it and the barn goes back to being flush. */
const EAVE_UNDER = GAMBREL.eaveY - GAMBREL.fascia

/**
 * The roof is TWO shapes, not one shape with a crease in it.
 *
 * A single extrusion in a single colour puts the entire gambrel on a hairline:
 * the knuckle is drawn, but the planes either side of it are the same red, so
 * the eye reads one mass and a scratch. Cut at the knee and painted a full
 * value step apart, the break is carried by SHAPE — the steep lower band reads
 * dark against the shallow upper cap, from any angle and at any distance,
 * whether or not the ink line is resolvable.
 *
 * The two pieces share the horizontal plane at knee height, which is interior
 * to the solid everywhere except the gable ends, where it becomes the drawn
 * knee line — on BOTH ends, because an extrusion has two caps.
 */
function barnLowerRoofShape() {
  const { eaveX: ex, eaveY: ey, kneeX: kx, kneeY: ky } = GAMBREL
  const s = new THREE.Shape()
  s.moveTo(-ex, EAVE_UNDER)
  s.lineTo(-ex, ey)
  s.lineTo(-kx, ky)
  s.lineTo(kx, ky)
  s.lineTo(ex, ey)
  s.lineTo(ex, EAVE_UNDER)
  s.closePath()
  return s
}

/** The ridge triangle: the shallow upper pitches, a full step lighter. */
function barnUpperRoofShape() {
  const { kneeX: kx, kneeY: ky, ridgeY } = GAMBREL
  const s = new THREE.Shape()
  s.moveTo(-kx, ky)
  s.lineTo(0, ridgeY)
  s.lineTo(kx, ky)
  s.closePath()
  return s
}

/** The four runs of the gambrel profile, as [x0, y0, x1, y1]. */
const GABLE_RUNS = [
  [-GAMBREL.eaveX, GAMBREL.eaveY, -GAMBREL.kneeX, GAMBREL.kneeY],
  [-GAMBREL.kneeX, GAMBREL.kneeY, 0, GAMBREL.ridgeY],
  [0, GAMBREL.ridgeY, GAMBREL.kneeX, GAMBREL.kneeY],
  [GAMBREL.kneeX, GAMBREL.kneeY, GAMBREL.eaveX, GAMBREL.eaveY],
]

/**
 * Cream rake boards down the gambrel, MIRRORED onto both gables.
 *
 * The break used to read on the near end only: the far gable was a bare red
 * plane with the profile buried in its outline, so from three-quarter the barn
 * looked like a gambrel in front and a shed behind. A rake board is what a real
 * barn puts on that edge anyway, and running it on both ends states the
 * silhouette twice — the second statement is what makes it read as the
 * building's shape rather than as the near corner's accident.
 */
function barnRakes() {
  const rakes = new THREE.Group()
  const z = GAMBREL.depth / 2 + 0.09
  for (const sz of [-1, 1]) {
    for (const [x0, y0, x1, y1] of GABLE_RUNS) {
      const [dx, dy] = [x1 - x0, y1 - y0]
      const board = rot(box(Math.hypot(dx, dy) + 0.2, 0.26, 0.22, P.cream), 0, 0, Math.atan2(dy, dx))
      rakes.add(at(board, (x0 + x1) / 2, (y0 + y1) / 2, z * sz))
    }
  }
  return rakes
}

/** Cream cap straddling the ridge, run PAST both rake boards so it finishes the
 *  ridge at each gable instead of stopping mid-run. The two upper pitches only
 *  differ by 27 deg, under the crease threshold and correctly so — a real ridge
 *  is a capping board, not an angle, and the board's own corners carry the line. */
function barnRidge() {
  return at(box(0.42, 0.26, GAMBREL.depth + 0.6, P.cream), 0, GAMBREL.ridgeY + 0.06, 0)
}

/** Fascia boards down the two eaves: the drawn edge of the roof, and the thing
 *  the soffit shadow hangs under. */
function barnEaves() {
  const eaves = new THREE.Group()
  for (const s of [-1, 1]) {
    eaves.add(at(box(0.14, 0.36, GAMBREL.depth + 0.1, P.cream), (GAMBREL.eaveX + 0.04) * s, 3.8, 0))
    // Wall-head trim, tucked just under the overhang on the two long walls.
    eaves.add(at(box(10.5, 0.32, 0.32, P.cream), 0, EAVE_UNDER - 0.18, 4.02 * s))
  }
  return eaves
}

/** Header sits clear of EAVE_UNDER so the door surround finishes as a drawn
 *  rectangle instead of running up behind the roof and getting cut. */
const DOOR = { h: 3.42, leafW: 2.06 }

function doorLeaf(side) {
  const lh = DOOR.h - 0.34
  const leaf = at(new THREE.Group(), 1.13 * side, DOOR.h / 2 - 0.12, 4.14)
  leaf.add(box(DOOR.leafW, lh, 0.16, P.cream))
  for (const y of [lh * 0.42, -lh * 0.42]) leaf.add(at(box(DOOR.leafW, 0.24, 0.1, P.barnRed), 0, y, 0.1))
  const brace = Math.hypot(DOOR.leafW, lh)
  const tilt = Math.atan2(DOOR.leafW, lh)
  for (const a of [-1, 1]) leaf.add(at(rot(box(0.26, brace, 0.1, P.barnRed), 0, 0, a * tilt), 0, 0, 0.09))
  return leaf
}

function barnDoors() {
  const doors = new THREE.Group()
  doors.add(at(box(4.95, DOOR.h, 0.18, P.cream), 0, DOOR.h / 2, 4.02))
  for (const s of [-1, 1]) doors.add(doorLeaf(s))
  return doors
}

// The loft opening was a flat dark plate stuck *in front of* a cream slab: the
// single darkest region in the frame and the first thing the eye landed on, for
// nothing. It is a real recess now — cream frame and a proud sill in front, warm
// umber behind, and a beam, a bale and a spill of hay inside so it reads as
// depth into a loft rather than a hole in the model.
const LOFT = { y: 5.45, halfW: 0.86, halfH: 0.76, bar: 0.24, z: 4.4 }

/** Four bars, not a slab, so the opening can sit recessed behind the trim. */
function loftFrame() {
  const frame = new THREE.Group()
  const { y, halfW, halfH, bar, z } = LOFT
  for (const s of [-1, 1]) {
    frame.add(at(box(bar, (halfH + bar) * 2, 0.2, P.cream), (halfW + bar / 2) * s, y, z))
    frame.add(at(box((halfW + bar) * 2, bar, 0.2, P.cream), 0, y + (halfH + bar / 2) * s, z))
  }
  // Sill proud of the wall: it catches the sun and drops a shadow into the hole.
  frame.add(at(box((halfW + bar) * 2, 0.16, 0.52, P.cream), 0, y - halfH - 0.08, z + 0.16))
  return frame
}

/** Umber void with things in it: collar beam, a bale on the sill, loose straw. */
function loftInterior() {
  const inside = new THREE.Group()
  const { y, halfW, halfH } = LOFT
  inside.add(at(box(halfW * 2 + 0.2, halfH * 2 + 0.2, 0.16, P.loft), 0, y, 4.15))
  inside.add(at(box(halfW * 1.9, 0.18, 0.16, P.woodDark), 0, y + halfH * 0.62, 4.32))
  inside.add(at(rot(box(0.95, 0.5, 0.34, P.hay), 0, 0.12, 0.07), -0.1, y - halfH + 0.27, 4.32))
  for (const [x, yaw] of [[-0.5, 0.5], [0.15, -0.35], [0.62, 0.2]]) {
    const straw = rot(spike(0.11, 0.55, P.hayDark, 6), 1.9, yaw, 0)
    inside.add(at(straw, x, y - halfH + 0.06, 4.52))
  }
  return inside
}

function barnLoft() {
  const loft = new THREE.Group()
  loft.add(loftInterior(), loftFrame())
  // Hoist beam with a rope and block hanging off it, over the opening.
  loft.add(at(box(0.28, 0.28, 1.6, P.cream), 0, 6.8, 4.75))
  loft.add(at(tube(0.045, 0.045, 0.6, P.woodDark, 6), 0, 6.38, 5.42))
  loft.add(at(box(0.2, 0.26, 0.16, P.woodDark), 0, 6.0, 5.42))
  return loft
}

function buildBarn() {
  const g = new THREE.Group()
  g.add(extruded(barnWallShape(), 8, P.barnRed))
  g.add(extruded(barnLowerRoofShape(), GAMBREL.depth, P.barnRoof))
  g.add(extruded(barnUpperRoofShape(), GAMBREL.depth, P.barnRoofUp))
  g.add(barnEaves(), barnRakes(), barnRidge())
  const postH = EAVE_UNDER - 0.02
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) g.add(at(box(0.32, postH, 0.32, P.cream), 5.04 * sx, postH / 2, 3.94 * sz))
  }
  g.add(barnDoors(), barnLoft())
  g.add(at(box(0.16, DOOR.h - 0.12, 0.12, P.barnRed), 0, (DOOR.h - 0.12) / 2, 4.24))
  // The barn is the biggest PAINTED shape in the frame, and it carries no pen.
  //
  // It used to take the heaviest line in the shot on the argument that the
  // biggest silhouette needs it — which is true of a character and false of a
  // building. In a painted cartoon background the barn is separated from the
  // sky by colour alone, and every line on it is LIGHT: the cream rakes down
  // both gables, the ridge cap, the fascias, the wall-head trim, the door
  // surround and the X-braces. All of that is geometry and all of it survives.
  // What goes is the black contour that made the whole frame read as a toon
  // shader — the gambrel break is carried by barnRoof against barnRoofUp
  // against barnRed, three painted values, which is how a background painter
  // states it.
  return addOutline(g, { pixels: INK_WEIGHT.BACKGROUND })
}

/** Classic Saturday-morning barn: faceted gambrel with a hard knuckle crease,
 *  projecting eaves, cream ridge cap and trim, X-braced doors. ~11.4 across the
 *  eaves, 7.7 to the ridge cap. */
export function makeBarn() {
  return withSteps(STEPS.ARCH, buildBarn)
}

// --------------------------------------------------------------------- props

// A fence is the longest straight edge in the frame, so it is the one prop that
// can betray the whole drawing. The failure mode isn't "too neat" — it's the
// middle: ±0.08 of noise on a dead-level rail reads as slightly warped
// mass-produced lumber, which costs variance and buys no charm. So the
// variation is pushed to where a viewer actually reads it: posts differ in
// HEIGHT and GIRTH, they LEAN off vertical on both axes, every rail BOWS at its
// midpoint under its own weight, and one rail up the run has plainly given up.
// Seeded off `length`, so a given fence is the same fence on every reload.
const FENCE = {
  spanTarget: 2.2,
  postH: 1.2,
  postSink: 0.05,
  /** Every Nth post is driven deeper — a run nobody measured. */
  deepEvery: 5,
  deepBy: 0.15,
  railY: [0.84, 0.46],
  /** Post height swing, as a fraction of postH. */
  heightVary: 0.12,
  /** Post girth swing, as a fraction of nominal. */
  girthVary: 0.16,
  /** Max lean off vertical, radians, drawn independently for pitch and roll. */
  lean: 0.078, // ~4.5°
  /** Mid-span droop of a rail, metres. */
  sag: [0.05, 0.1],
  /** How far the dead rail's loose end has dropped. */
  brokenDrop: [0.4, 0.62],
}

const POST_W = 0.19

/** A post nobody sighted down a line: its own height, girth, and lean on both
 *  axes. Returns the height so the caller can seat its base in the dirt. */
function fencePost(rnd) {
  const h = FENCE.postH * (1 + (rnd() - 0.5) * 2 * FENCE.heightVary)
  const w = POST_W * (1 + (rnd() - 0.5) * 2 * FENCE.girthVary)
  const lean = () => (rnd() - 0.5) * 2 * FENCE.lean
  const post = box(w, h, w * 1.05, P.cream)
  return { post: rot(post, lean(), (rnd() - 0.5) * 0.18, lean()), h }
}

/** Both ends stay on the nominal span so the fence still measures `length` end
 *  to end for placement code. */
function fencePosts(rnd, length, spans, gap) {
  const posts = new THREE.Group()
  const xs = []
  for (let i = 0; i <= spans; i++) {
    const end = i === 0 || i === spans
    const x = -length / 2 + i * gap + (end ? 0 : (rnd() - 0.5) * 0.16)
    const { post, h } = fencePost(rnd)
    const sunk = i % FENCE.deepEvery === FENCE.deepEvery - 1 ? FENCE.deepBy : 0
    posts.add(at(post, x, h / 2 - FENCE.postSink - sunk, (rnd() - 0.5) * 0.06))
    xs.push(x)
  }
  return { posts, xs }
}

/** One straight stick between two points in the XZ-facing XY plane, overlapping
 *  its ends by a hair so a joint hides behind a post instead of opening a gap. */
function railStick(x0, y0, x1, y1) {
  const [dx, dy] = [x1 - x0, y1 - y0]
  const stick = rot(box(Math.hypot(dx, dy) + 0.07, 0.15, 0.12, P.cream), 0, 0, Math.atan2(dy, dx))
  return at(stick, (x0 + x1) / 2, (y0 + y1) / 2, 0.03)
}

/** A span of rail as two sticks meeting at a dropped midpoint: a shallow bow,
 *  not a uniform y offset. Wood sags in the middle; that is the drawing. */
function fenceRail(rnd, x0, x1, y) {
  const rail = new THREE.Group()
  const [lo, hi] = FENCE.sag
  const [yA, yB] = [y + (rnd() - 0.5) * 0.07, y + (rnd() - 0.5) * 0.07]
  const mid = x0 + (x1 - x0) * (0.44 + rnd() * 0.12)
  const yMid = (yA + yB) / 2 - (lo + rnd() * (hi - lo))
  rail.add(railStick(x0, yA, mid, yMid), railStick(mid, yMid, x1, yB))
  return rail
}

/** The rail that finally let go: still nailed at one post, loose end in the
 *  dirt, the rest of the span missing. One deliberate failure buys more
 *  hand-drawn read than any amount of even noise. */
function brokenRail(rnd, x0, x1, y) {
  const rail = new THREE.Group()
  const [lo, hi] = FENCE.brokenDrop
  const nailed = rnd() > 0.5
  const stub = nailed ? x0 + (x1 - x0) * 0.62 : x1 - (x1 - x0) * 0.62
  rail.add(railStick(nailed ? x0 : x1, y, stub, y - (lo + rnd() * (hi - lo))))
  return rail
}

function fenceRails(rnd, xs, y, breakAt) {
  const rails = new THREE.Group()
  for (let i = 0; i < xs.length - 1; i++) {
    const build = i === breakAt ? brokenRail : fenceRail
    rails.add(build(rnd, xs[i], xs[i + 1], y))
  }
  return rails
}

function buildFence(length) {
  const rnd = seeded(Math.round(length * 97))
  const g = new THREE.Group()
  const spans = Math.max(1, Math.round(length / FENCE.spanTarget))
  const gap = length / spans
  const { posts, xs } = fencePosts(rnd, length, spans, gap)
  g.add(posts)
  // Only the top row breaks — the bottom rail stays whole so the run still
  // reads as a fence, and its loose end can't swing below the grass.
  const breakAt = spans >= 4 ? 1 + Math.floor(rnd() * (spans - 2)) : -1
  FENCE.railY.forEach((y, row) => g.add(fenceRails(rnd, xs, y, row === 0 ? breakAt : -1)))
  // A fence in a painted background is a run of pale battens against green —
  // read on value, contoured by nothing. The lumber is P.cream, the lightest
  // note on the farm, so it separates from the field without help; ink on it
  // turned the longest straight edge in the frame into the loudest line in the
  // frame, which is the opposite of what a fence is for.
  return addOutline(g, { pixels: INK_WEIGHT.BACKGROUND })
}

/** Post-and-rail fence running along +X, centered on the origin. */
export function makeFence(length = 6) {
  return withSteps(STEPS.ARCH, () => buildFence(length))
}

// A smooth lathe cone in ochre is a bare primitive at any distance, and the
// haystack is one of the biggest masses in the frame. Hay is stacked in
// COURSES, so the profile steps out into an overhanging lip and tucks back
// under at each course line: three notches cut into the silhouette itself,
// which the ink hull then traces. Loose straw breaks the contour on top of
// that. Silhouette first, decoration second — a tuft drawn inside the outline
// is invisible at midfield.
const HAY_COURSES = 3

/** Mound radius at height fraction `t`, so straw can sit on the real contour. */
const hayRadius = (rad, bulge, t) => rad * (1 - t) ** 0.62 * (1 + bulge * Math.sin(t * Math.PI))

/** Lathe profile with a lip-and-tuck at each course line. */
function hayProfile(rnd, h, rad, bulge) {
  const rings = 12
  const every = Math.floor(rings / (HAY_COURSES + 1))
  const points = []
  for (let i = 0; i <= rings; i++) {
    const t = i / (rings + 1)
    points.push(new THREE.Vector2(hayRadius(rad, bulge, t), t * h))
    if (i === 0 || i % every || i > every * HAY_COURSES) continue
    points.push(new THREE.Vector2(hayRadius(rad, bulge, t) * (1.09 + rnd() * 0.07), (t + 0.012) * h))
    points.push(new THREE.Vector2(hayRadius(rad, bulge, t + 0.05) * 0.97, (t + 0.05) * h))
  }
  points.push(new THREE.Vector2(0, h + 0.12))
  return points
}

const hayMound = (rnd, h, rad, bulge) =>
  meshOf(new THREE.LatheGeometry(hayProfile(rnd, h, rad, bulge), 22), P.hay)

/**
 * Straw sticking out of the mound. Flattened cones, not sticks: a fan of straw
 * has width, and the old 0.09-radius spike was a sliver that disappeared at
 * viewing size. They are seated ON the contour and pushed outward along it, so
 * wherever the camera stands three or four are breaking the silhouette.
 */
function hayTufts(rnd, h, rad, bulge) {
  const tufts = new THREE.Group()
  const count = 8 + Math.floor(rnd() * 3)
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rnd() * 0.6
    const t = 0.16 + rnd() * 0.62
    const r = hayRadius(rad, bulge, t) * 0.98
    const swivel = at(rot(new THREE.Group(), 0, a, 0), Math.sin(a) * r, t * h, Math.cos(a) * r)
    const tuft = scl(spike(0.2 + rnd() * 0.1, 0.6 + rnd() * 0.45, P.hayDark, 7), 1, 1, 0.34)
    swivel.add(at(rot(tuft, 1.15 + rnd() * 0.5, (rnd() - 0.5) * 0.5, 0), 0, 0.04, 0.18))
    tufts.add(swivel)
  }
  return tufts
}

function buildHaystack(seed) {
  const rnd = seeded(seed)
  const g = new THREE.Group()
  const h = 2.05 + rnd() * 0.85
  const rad = 1.32 + rnd() * 0.42
  const bulge = 0.08 + rnd() * 0.16
  const mound = hayMound(rnd, h, rad, bulge)
  // Squash mound and straw together, so the tufts stay welded to the contour.
  const stack = scl(new THREE.Group(), 1, 1, 0.85 + rnd() * 0.32)
  stack.add(mound, hayTufts(rnd, h, rad, bulge))
  g.add(stack)
  // Scenery: one flat ochre shape with a deckled top edge, no pen anywhere on
  // it. The course lips are still cut into the SILHOUETTE, which is where they
  // did their work — a lathe profile that steps in and out reads as stacked
  // courses against the sky whether or not a line is drawn on the knuckle.
  return addOutline(g, { pixels: INK_WEIGHT.BACKGROUND })
}

/**
 * Golden hay mound, ~2.1–2.9 tall, with straw poking out at silly angles.
 * @param {number} [seed] omit for a fresh variant per call; pass one to pin it.
 */
export function makeHaystack(seed = nextSeed()) {
  return withSteps(STEPS.ARCH, () => buildHaystack(seed))
}

// ----------------------------------------------------------------------- pig

/** Yaw (radians) that turns the snout and the closed eye toward the default
 *  tycoon camera. The pose is authored three-quarter; a random yaw throws the
 *  whole gag away, so world.js should read this instead of rolling dice. */
const PIG_REST_YAW = -0.4

/**
 * Head up on a propped neck — she is dozing, not decapitated.
 *
 * Cheek-on-the-grass is the truer pose and it is unreadable from this camera.
 * The skull sat at y 0.33 with a crown at 0.66 against a belly whose top is
 * 0.588: three fingers of pink above pink, no ink between them, at a 30°
 * elevation that projects the difference down to nearly nothing. What arrived
 * on screen was one abstract pink loaf, near the middle of the frame, with no
 * animal in it. Everything here exists to break that silhouette in two:
 *
 * - the skull moves up 0.17 and out 0.12, so 0.25 of head clears the belly's
 *   top instead of 0.07, and a neck wedge carries it there (a head lifted with
 *   nothing under it is a ball parked beside a body),
 * - the snout is a DISC on the axis she faces, not a barrel lying across it,
 *   and it is P.pigDark with two ink nostrils — the darkest note on the animal
 *   and the one that says which end is the front,
 * - the ears go up 35% and sit on the crown where they bite the outline,
 * - and the head-to-shoulder break is DRAWN. Crease extraction cannot find it:
 *   head and neck are smooth spheres that interpenetrate, so there is no edge
 *   in the mesh anywhere near the join. It is an ink slab, raked forward like a
 *   jaw line, piercing both forms so it stays welded at any camera angle.
 */
function pigHead() {
  const head = new THREE.Group()
  head.name = 'pig-head'
  head.add(at(scl(ball(0.3, P.pig, 14), 1, 0.86, 1), 0.42, 0.4, 0.08))
  head.add(at(ball(0.34, P.pig), 0.7, 0.5, 0.1))
  head.add(at(rot(tube(0.2, 0.22, 0.22, P.pigDark, 14), 0, 0, Math.PI / 2), 1.0, 0.42, 0.14))
  for (const s of [-1, 1]) head.add(detail(at(ball(0.045, INK, 8), 1.12, 0.42, 0.14 + 0.075 * s)))
  for (const s of [-1, 1]) {
    const ear = scl(spike(0.2, 0.32, P.pigDark, 8), 1, 1, 0.42)
    head.add(at(rot(ear, 0.7, 0, -0.85), 0.6, 0.72, 0.08 + 0.22 * s))
  }
  head.add(at(rot(inkSlab(0.024, 0.42, 0.44), 0, 0, -0.3), 0.5, 0.47, 0.09))
  // Closed eye rides high on the skull so it clears the snout from the steep
  // tycoon camera. It is the whole joke, so it gets the best real estate.
  const lid = meshOf(new THREE.TorusGeometry(0.12, 0.034, 6, 16, Math.PI), INK)
  head.add(detail(at(rot(lid, -0.93, 0.36, 0), 0.84, 0.71, 0.28)))
  return head
}

function pigLeg(len) {
  const leg = new THREE.Group()
  leg.add(at(rot(tube(0.12, 0.14, len, P.pig, 10), Math.PI / 2, 0, 0), 0, 0, len / 2))
  // Trotter, not a boot: it used to be nearly as wide as the leg and darker
  // than anything else on the animal, which is how four hooves under a pink
  // balloon came to read as four clumps of mud parked beside it.
  leg.add(at(rot(tube(0.13, 0.115, 0.1, P.hoof, 8), Math.PI / 2, 0, 0), 0, 0, len + 0.04))
  return leg
}

/**
 * A lying animal is read from its legs: the down-side pair is buried under the
 * belly with only the hooves peeking out, and the up-side pair is thrown at the
 * sky showing pale undersides against air. Four legs at the same height under
 * the body is a standing pose no matter how flat you squash the torso.
 */
function pigLegs() {
  const legs = new THREE.Group()
  for (const x of [0.34, -0.32]) {
    const s = Math.sign(x)
    // Shoulder and haunch: a leg leaves the body from a MASS. Without one, the
    // limbs start at the belly's silhouette edge and the eye has nothing to
    // join them to — four stubs floating next to a pink balloon. The mass also
    // pushes the leg roots inboard (z 0.28 → 0.16), so a real length of pink
    // shank clears the belly before the trotter does.
    legs.add(at(scl(ball(0.25, P.pig, 14), 0.86, 0.94, 1), x, 0.27, 0.2))
    legs.add(at(rot(pigLeg(0.36), 0.2, 0.18 * s, 0), x, 0.19, 0.16))
    legs.add(at(rot(pigLeg(0.52), -0.6, -0.3 * s, 0), x * 0.74, 0.6, 0.18))
  }
  return legs
}

/** Belly mass pooled on the grass, plus the flattened contact ellipse that
 *  says "resting on" rather than "hovering above". */
function pigBody() {
  const body = new THREE.Group()
  body.add(at(scl(ball(0.48, P.pig), 1.34, 0.6, 1.05), 0, 0.3, 0))
  body.add(at(scl(ball(0.42, P.pig), 1.18, 0.62, 0.9), -0.04, 0.32, 0.28))
  return body
}

function pigContact() {
  return at(scl(ball(0.5, P.pigDark, 18), 1.52, 0.05, 1.18), 0, 0.04, 0.06)
}

/** Sleeping only reads if it moves: a slow swell on the torso, driven off the
 *  wall clock from inside the model so no other module has to tick it. */
function driveBreath(body, driver) {
  const phase = Math.random() * Math.PI * 2
  driver.onBeforeRender = () => {
    const s = Math.sin(clockNow() * 1.35 + phase)
    body.scale.set(1 + s * 0.02, 1 + s * 0.055, 1 + s * 0.02)
  }
}

function buildPig() {
  const g = new THREE.Group()
  const body = pigBody()
  // Hard contact patch first, under everything. A sleeping animal blocking the
  // road is the frame's one physical-comedy beat, and it does not land while
  // she hovers: the dark note under the belly is what puts her ON the dirt.
  g.add(at(contactShadow(0.98, 0.6, 0.46), 0.1, 0.014, 0.06))
  g.add(pigContact(), body, pigHead(), pigLegs())
  const tail = meshOf(new THREE.TorusGeometry(0.11, 0.035, 6, 14), P.pigDark)
  g.add(at(rot(tail, 0, 0.5, 0), -0.62, 0.33, -0.04))
  driveBreath(body, body.children[0])
  g.userData.parts = { body }
  g.userData.restYaw = PIG_REST_YAW
  // A gag lying in the chicken's path is a foreground read, a step under hero.
  return addOutline(g, { pixels: 4.0, interior: true })
}

/** Pink pig flopped on its side, big round belly, head propped and fast asleep.
 *  ~2.0 long, ~0.9 to the ear tips. `userData.restYaw` is the yaw that faces
 *  the gag — snout, closed eye and the near ear — at the camera; placing her at
 *  any other yaw throws all three away. */
export function makePig() {
  return withSteps(STEPS.CHARACTER, buildPig)
}

// ---------------------------------------------------------------------- tree

// A treeline is one continuous ragged silhouette, not a row of copies of one
// object. Mass, gesture and hue all move per instance; three hand-authored
// silhouettes keep the variation structural instead of just noisy.
const TREE_KINDS = ['blob', 'blob', 'blob', 'conifer', 'shrub']

/** Matched leaf/highlight pair, hue-rotated ±10° so the mass has internal life. */
function leafPair(rnd) {
  const hue = (rnd() - 0.5) * (20 / 360)
  const lightness = (rnd() - 0.5) * 0.06
  return [
    new THREE.Color(P.leaf).offsetHSL(hue, 0, lightness),
    new THREE.Color(P.leafLight).offsetHSL(hue, 0, lightness),
  ]
}

/**
 * How far the trunk runs UP INTO the canopy that sits on it.
 *
 * A trunk that stops where the canopy's ANCHOR is is not a trunk inside a
 * crown — the lobes are scattered on a ring and scaled about that anchor, so
 * the top of the stick can finish in open air with the leaves floating a third
 * of a metre above it. From the far side of the field, with fog washing the
 * green out, what is left is a bare tapered slab standing in the grass: the
 * "rendering error" read. The trunk now runs past the anchor and deep into the
 * mass, so trunk and crown are one welded silhouette at every distance and
 * every lean.
 */
const CANOPY_GRIP = { blob: 0.9, conifer: 0.3, shrub: 1.05 }

/** Root flare. A tree does not meet the ground as a cylinder pushed into a
 *  plane; it widens into it. Cheap, and it is half of what tells a viewer that
 *  the thing is planted rather than placed. */
function treeRoots(r) {
  return at(tube(r * 1.05, r * 2.15, r * 1.3, P.trunk, 10), 0, r * 0.64, 0)
}

/** @param grip extra length drawn ABOVE `h`, buried inside the canopy. */
function treeTrunk(rnd, h, grip) {
  const trunk = new THREE.Group()
  const r = 0.2 + rnd() * 0.12
  const drawn = h + grip
  trunk.add(at(rot(tube(r * 0.9, r * 1.75, drawn, P.trunk, 10), 0, 0, 0.04), 0, drawn / 2, 0))
  trunk.add(treeRoots(r))
  if (rnd() > 0.45) {
    const branch = rot(tube(0.12, 0.16, 0.85, P.trunk, 8), 0, rnd() * Math.PI * 2, 0.85)
    trunk.add(at(branch, -0.38, h * 0.92, 0.1))
  }
  return trunk
}

/** Broccoli mass: 4–8 balls scattered on a ring, so gaps bite the silhouette. */
function blobCanopy(rnd, [leaf, light], aspect) {
  const canopy = new THREE.Group()
  const count = 4 + Math.floor(rnd() * 5)
  canopy.add(at(ball(1.05 + rnd() * 0.35, light, 18), 0, 0.4, 0))
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rnd() * 0.9
    const spread = 0.8 + rnd() * 0.45
    const r = 0.7 + rnd() * 0.5
    const c = rnd() > 0.5 ? leaf : light
    canopy.add(at(ball(r, c, 16), Math.cos(a) * spread, (rnd() - 0.45) * 0.95, Math.sin(a) * spread))
  }
  return scl(canopy, aspect, 1 / Math.sqrt(aspect), aspect)
}

/**
 * Tall narrow conifer: stacked cones, the vertical accent in a treeline.
 *
 * Every tier is the SAME leaf tone. Alternating light/dark per tier made each
 * cone one uniform flat colour and the whole tree a horizontal stripe pattern —
 * a paper cutout with no core shadow and no rounded mass. With one tone the
 * toon ramp carves the lit/shadow break, so value comes from the sun.
 *
 * Yaw, XZ offset, girth and tilt all move per tier, and the stack takes a
 * per-instance girth/height, so the silhouette goes ragged instead of stacking
 * perfectly symmetric triangles on one axis.
 */
function coniferCanopy(rnd, [leaf]) {
  const canopy = new THREE.Group()
  const tiers = 4 + Math.floor(rnd() * 2)
  let y = 0
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers
    const h = (1.6 - t * 0.25) * (0.9 + rnd() * 0.26)
    const r = 1.15 * (1 - t * 0.6) * (0.86 + rnd() * 0.32)
    const cone = rot(spike(r, h, leaf, 9), (rnd() - 0.5) * 0.2, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.2)
    canopy.add(at(cone, (rnd() - 0.5) * 0.36, y + h / 2, (rnd() - 0.5) * 0.36))
    y += h * 0.52
  }
  const girth = 0.88 + rnd() * 0.34
  return scl(canopy, girth, 1 + rnd() * 0.45, girth)
}

/** Low wide shrub mass: squats under the blobs and breaks up the skyline. */
function shrubCanopy(rnd, [leaf, light]) {
  const canopy = new THREE.Group()
  // Core lobe ON the trunk axis. The scattered ring alone is a wreath: on a few
  // seeds every lobe cleared the middle and the stick came out of the top of
  // the shrub into open air. Deliberately takes no rnd() draw, so adding it
  // leaves every seeded shrub otherwise identical to the one before it.
  canopy.add(at(scl(ball(0.95, light, 16), 1, 0.8, 1), 0, -0.1, 0))
  const count = 5 + Math.floor(rnd() * 4)
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rnd() * 0.7
    const spread = 0.55 + rnd() * 1.0
    const blob = scl(ball(0.8 + rnd() * 0.5, i % 2 ? leaf : light, 16), 1, 0.72, 1)
    canopy.add(at(blob, Math.cos(a) * spread, (rnd() - 0.5) * 0.4, Math.sin(a) * spread))
  }
  return canopy
}

function treeCanopy(kind, rnd, tones, trunkH) {
  // Every canopy mesh must centre above y≈1.8: world.js tints foreground trees
  // by world height, and a lobe hanging below that line goes untinted.
  if (kind === 'conifer') return at(coniferCanopy(rnd, tones), 0, trunkH * 0.9 + 0.1, 0)
  if (kind === 'shrub') return at(shrubCanopy(rnd, tones), 0, trunkH + 1.25, 0)
  return at(blobCanopy(rnd, tones, 0.75 + rnd() * 0.65), 0, trunkH + 1.05, 0)
}

const TRUNK_H = { blob: [1.7, 0.7], conifer: [1.15, 0.5], shrub: [0.85, 0.3] }

/** Insurance, not decoration: a tree with an empty canopy group must never
 *  leave this function, whatever a kind's scatter happens to roll. */
function ensureCanopy(canopy, tones) {
  if (canopy.children.length) return canopy
  canopy.add(ball(1.15, tones[1], 16))
  return canopy
}

/** Pool of shade under the crown. Tagged so world.js can fade or drop it on
 *  the far treeline, where a hard dark note would break atmospheric depth. */
const treeShadow = (kind) =>
  kind === 'conifer' ? contactShadow(0.85, 0.66, 0.32) : contactShadow(1.25, 0.9, 0.34)

function buildTree(seed) {
  const rnd = seeded(seed)
  const g = new THREE.Group()
  // Lean pivots at the roots and carries trunk and canopy together — a tree
  // that leans only in the crown reads as a broken model, not as gesture. The
  // yaw swings the lean to a random compass bearing (Euler XYZ applies Z first),
  // so a row of them doesn't tip as one, and it spins each canopy's facets too.
  // Set here rather than on the returned group: world.js owns that yaw.
  const lean = rot(new THREE.Group(), 0, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.4)
  const kind = TREE_KINDS[Math.floor(rnd() * TREE_KINDS.length)]
  const [base, span] = TRUNK_H[kind]
  const trunkH = base + rnd() * span
  // Trunk and canopy are built as ONE unit under one lean node and published
  // as one pair on userData, so any distance cull or LOD swap that hides a
  // tree takes the crown and the stick together — there is no seam in this
  // model that a traversal can remove half of.
  const trunk = treeTrunk(rnd, trunkH, CANOPY_GRIP[kind])
  const tones = leafPair(rnd)
  const canopy = ensureCanopy(treeCanopy(kind, rnd, tones, trunkH), tones)
  lean.add(trunk, canopy)
  lean.name = 'tree-unit'
  g.add(lean, treeShadow(kind))
  g.userData.kind = kind
  g.userData.parts = { trunk, canopy }
  // Trees are scenery, not subject: a thin line lets the treeline sit behind
  // the buildings. world.js should thin it further toward 0 with distance via
  // toon.js `setInkWeight` once each tree is placed. Round-10's de-ink pass
  // took trees to INK_WEIGHT.BACKGROUND along with the buildings; carl-fyffe
  // rejected that on sight ("the trees now look significantly worse"), so
  // trees keep their pen while buildings stay painted — the treeline regression
  // card is the record.
  return addOutline(g, { pixels: INK_WEIGHT.FAR })
}

/**
 * Cartoon tree, ~3–5.5 tall: broccoli blob, conifer or shrub, leaning and
 * hue-shifted per instance.
 * @param {number} [seed] omit for a fresh variant per call; pass one to pin it.
 */
export function makeTree(seed = nextSeed()) {
  return withSteps(STEPS.ARCH, () => buildTree(seed))
}

// ------------------------------------------------------------------ salesman

function buildSalesman() {
  const g = new THREE.Group()
  for (const s of [-1, 1]) g.add(at(box(0.17, 0.75, 0.2, P.dark), 0.12 * s, 0.38, 0))
  g.add(at(tube(0.26, 0.32, 0.8, P.suit, 12), 0, 1.12, 0))
  for (const y of [0.95, 1.25]) g.add(at(tube(0.3, 0.3, 0.05, P.cream, 12), 0, y, 0))
  for (const s of [-1, 1]) g.add(at(rot(tube(0.08, 0.08, 0.6, P.suit, 8), 0.3, 0, -0.22 * s), 0.32 * s, 1.15, 0.06))
  g.add(at(ball(0.24, P.shell, 16), 0, 1.66, 0))
  g.add(at(rot(spike(0.07, 0.16, P.pigDark, 8), Math.PI / 2), 0, 1.62, 0.22))
  g.add(at(tube(0.2, 0.2, 0.16, P.hay, 14), 0, 1.9, 0))
  g.add(at(tube(0.36, 0.36, 0.04, P.hay, 16), 0, 1.83, 0))
  g.add(at(box(0.34, 0.26, 0.12, P.woodDark), 0.46, 0.75, 0.1))
  return addOutline(g, { pixels: INK_WEIGHT.HERO, interior: true })
}

/** Traveling-salesman NPC placeholder, ~1.8 tall. Unused in phase 1. */
export function makeSalesman() {
  return withSteps(STEPS.CHARACTER, buildSalesman)
}

// -------------------------------------------------------------- small props
//
// A farm reads as INHABITED when the eye finds six small incidents on its way
// to the barn: a shirt on a line, a hen with her head in the dirt, a barrow
// somebody left tipped over. That is what these are for — none of them is a
// game object, all of them are evidence that somebody works here.
//
// Every builder below returns a Group standing on the ground at its own
// origin, facing +Z. They are BACKGROUND weight — painted shapes, no pen —
// except the ones with an animal in them (the bird on its post, the scarecrow
// and his crow, the pecking hen), which are cels standing on the painting and
// keep PROP ink. That split is the whole hierarchy: ink means "this is a
// character", and a frame where the milk cans have it too means nothing.

const UP = new THREE.Vector3(0, 1, 0)
const v3 = (x, y, z) => new THREE.Vector3(x, y, z)

/** Cylinder spanning two points — every rope link, stay and frame joint. */
function strut(a, b, r, color, seg = 6) {
  const dir = new THREE.Vector3().subVectors(b, a)
  const len = Math.max(dir.length(), 1e-4)
  const m = noInterior(tube(r, r, len, color, seg))
  m.quaternion.setFromUnitVectors(UP, dir.divideScalar(len))
  return at(m, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2)
}

/** Point at `t` along a line that HANGS. A taut wire is an engineering
 *  drawing; the sag is the entire reason a clothesline reads as cloth. */
const ropePoint = (a, b, sag, t) =>
  new THREE.Vector3().lerpVectors(a, b, t).addScaledVector(UP, -Math.sin(Math.PI * t) * sag)

/** Sagging line as a chain of chunky links, so the ink hull traces a curve. */
function sagRope(a, b, sag, r, color, links = 9) {
  const g = new THREE.Group()
  let prev = a
  for (let i = 1; i <= links; i++) {
    const next = ropePoint(a, b, sag, i / links)
    g.add(strut(prev, next, r, color))
    prev = next
  }
  return g
}

/** Decals fight the terrain for the same depth; bias them toward the camera. */
const DECAL_BIAS = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }

/** Closed wobbly polygon: a spill somebody made, not a circle somebody drew. */
function blobShape(rnd, r, points = 9, squash = 0.72) {
  const s = new THREE.Shape()
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2
    const k = r * (0.6 + rnd() * 0.55)
    const [x, y] = [Math.cos(a) * k, Math.sin(a) * k * squash]
    if (i === 0) s.moveTo(x, y)
    else s.lineTo(x, y)
  }
  s.closePath()
  return s
}

/**
 * A painted shadow must never CAST one.
 *
 * `detail()` already clears castShadow, but world.js grounds everything it
 * places by traversing for meshes and switching shadows back on — which turns
 * every contact decal into an opaque occluder in the depth pass (alpha is not
 * consulted there), so each prop acquires a second, contradictory shadow-map
 * shadow shaped like its own painted one. A custom depth material that discards
 * every fragment is immune to that traversal: `opacity 0 < alphaTest 0.5` fails
 * three's alphatest_fragment for all pixels, so the decal writes no depth into
 * any shadow map no matter who flips its flags afterwards.
 */
let noCastDepth = null

function neverCasts(mesh) {
  if (!noCastDepth) {
    noCastDepth = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
      transparent: true,
      opacity: 0,
      alphaTest: 0.5,
    })
  }
  mesh.customDepthMaterial = noCastDepth
  return mesh
}

/**
 * The outline of every painted contact shadow: hand-wobbled, and HARD.
 *
 * One shadow language per frame or the picture has none. The cast shadows that
 * fall out of the shadow map are posterized to a single step (toon.js
 * useHardShadows) and their edge is the caster's silhouette, so it is a cut
 * line; a painted decal that answers with a feathered airbrushed alpha is a
 * second, contradictory system sitting in the same shot. So: no gradient, no
 * feather, no soft texture — a flat polygon with a drawn edge, whose only
 * departure from a stamped circle is a seeded wobble, because a shape a hand
 * put down is never a perfect ellipse.
 *
 * Rotation-invariant on purpose. world.js yaws these models arbitrarily, so any
 * rake toward the sun baked in here would spin with the prop; the direction of
 * a cast shadow belongs to whoever knows where the sun is.
 */
let shadowOutline = null

function shadowShape() {
  if (shadowOutline) return shadowOutline
  const rnd = seeded(917)
  const s = new THREE.Shape()
  const points = 14
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2
    const r = 0.86 + rnd() * 0.26
    const [x, y] = [Math.cos(a) * r, Math.sin(a) * r]
    if (i === 0) s.moveTo(x, y)
    else s.lineTo(x, y)
  }
  s.closePath()
  shadowOutline = s
  return shadowOutline
}

/**
 * The dark shape a cartoon draws under anything resting on the ground.
 *
 * A cast shadow map is a lighting effect and it fades out exactly where a prop
 * meets the grass, which is the one place the drawing needs a hard note: with
 * nothing under it a prop hovers no matter how correct its geometry is. This is
 * the painted contact patch instead — flat, opaque-ish, no ink of its own,
 * because the moment you outline a shadow it stops being a shadow.
 */
function contactShadow(rx, rz = rx, opacity = 0.4) {
  const m = new THREE.Mesh(
    new THREE.ShapeGeometry(shadowShape(), 1),
    new THREE.MeshBasicMaterial({ color: 0x2e2416, transparent: true, opacity, depthWrite: false })
  )
  m.scale.set(rx, rz, 1)
  m.receiveShadow = false
  neverCasts(m)
  // Tagged so placement code can find them: a hard contact note belongs under
  // anything in the near and middle field, but on the far treeline it fights
  // atmospheric perspective and world.js may want to fade or drop it.
  m.userData.isContactShadow = true
  return at(rot(detail(m), -Math.PI / 2, 0, 0), 0, 0.012, 0)
}

/** Flat shape lying on the grass, inked along its BOUNDARY (addOutline's
 *  `flat`) rather than its face normals — a spill in a cartoon is a drawn
 *  shape with an edge, not a texture stain. */
function groundDecal(shape, color, y = 0.02) {
  const g = new THREE.Group()
  const m = meshOf(new THREE.ShapeGeometry(shape, 10), color, DECAL_BIAS)
  m.castShadow = false
  g.add(at(rot(m, -Math.PI / 2, 0, 0), 0, y, 0))
  return addOutline(g, { pixels: INK_WEIGHT.DECAL, flat: true })
}

// --------------------------------------------------------------------- bird

/**
 * Fat round songbird, feet at the origin, drawn as one ball with a smaller
 * ball on it — anything more anatomical vanishes at this size. `r` is the body
 * radius: 0.15 is a sparrow on a fencepost, 0.19 the crow that has taken the
 * scarecrow's hat and is not remotely frightened of it.
 */
/**
 * Beak and eye colours for the small birds only — NOT the hen's.
 *
 * On a yellow bird the hen's own orange beak sits a hair off the plumage in
 * both hue and value, and an ink pupil 3 cm across on a saturated body is a
 * speck: the fence-post bird arrived as an undifferentiated yellow blob that
 * read as a lollipop. The beak goes darker and half again as long, and the eye
 * gets a cream backing disc under the pupil so it survives at prop scale. At
 * this size the silhouette has to say BIRD with three marks; these are them.
 */
const BIRD_BEAK = 0xd9791a

function birdFace(b, r) {
  b.add(at(rot(spike(r * 0.4, r * 1.05, BIRD_BEAK, 8), Math.PI / 2), 0, r * 1.72, r * 1.2))
  for (const s of [-1, 1]) {
    b.add(detail(at(ball(r * 0.3, P.shell, 10), r * 0.34 * s, r * 2.0, r * 0.82)))
    b.add(detail(at(ball(r * 0.19, INK, 8), r * 0.36 * s, r * 2.02, r * 0.94)))
  }
}

function songbird(color, r = 0.15, accent = color) {
  const b = new THREE.Group()
  b.add(at(scl(ball(r, color, 14), 1, 0.94, 1.18), 0, r * 1.0, 0))
  b.add(at(ball(r * 0.72, color, 12), 0, r * 1.82, r * 0.46))
  birdFace(b, r)
  for (const s of [-1, 1]) {
    b.add(at(scl(ball(r * 0.62, accent, 10), 0.3, 0.86, 1.12), r * 0.84 * s, r * 1.02, -r * 0.06))
    b.add(detail(at(tube(r * 0.11, r * 0.11, r * 0.5, BIRD_BEAK, 6), r * 0.3 * s, r * 0.26, r * 0.12)))
  }
  // Tail nub, cocked up: the third mark. A round body with a head and no tail
  // is a mushroom from behind.
  b.add(at(rot(scl(spike(r * 0.56, r * 1.7, accent, 8), 1, 1, 0.32), -1.85, 0, 0), 0, r * 1.16, -r * 1.24))
  return b
}

/** Plumage pairs (body, wing/tail accent). Saturated: a bird is a full stop. */
const BIRD_PLUMAGE = [
  [0xe2542f, 0xa8331a],
  [P.denim, 0x27508f],
  [P.grain, 0xc08e15],
  [0x6f4bb0, 0x4a2f80],
]

function buildBirdOnPost(seed) {
  const rnd = seeded(seed)
  const g = new THREE.Group()
  const h = 0.95 + rnd() * 0.35
  g.add(at(rot(box(0.16, h, 0.16, P.cream), (rnd() - 0.5) * 0.14, rnd(), (rnd() - 0.5) * 0.16), 0, h / 2 - 0.04, 0))
  g.add(at(box(0.28, 0.07, 0.28, P.woodDark), 0, h - 0.01, 0))
  const [body, accent] = BIRD_PLUMAGE[Math.floor(rnd() * BIRD_PLUMAGE.length)]
  const bird = withSteps(STEPS.CHARACTER, () => songbird(body, 0.17, accent))
  g.add(at(rot(bird, 0, rnd() * Math.PI * 2, 0), 0, h + 0.02, 0))
  return addOutline(g, { pixels: INK_WEIGHT.PROP, interior: true })
}

/**
 * Tiny round songbird on a leaning post, ~1.5 tall. Reusable filler: one of
 * these anywhere the midfield goes quiet buys a whole beat of life.
 * @param {number} [seed] omit for a fresh plumage/lean per call.
 */
export function makeBirdOnPost(seed = nextSeed()) {
  return withSteps(STEPS.ARCH, () => buildBirdOnPost(seed))
}

// ---------------------------------------------------------------- scarecrow

/** Straw bursting out of a cuff or a hem. Flattened cones, so a fan has
 *  WIDTH — a round spike this small is a sliver and disappears at midfield. */
function strawFan(rnd, count, len, spread, color = P.hayDark) {
  const fan = new THREE.Group()
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rnd() * 0.6
    const straw = scl(noInterior(spike(len * 0.25, len * (0.7 + rnd() * 0.7), color, 6)), 1, 1, 0.4)
    fan.add(rot(straw, spread * Math.cos(a), a, spread * Math.sin(a)))
  }
  return fan
}

/** Burlap sack head: stitched X eyes and a lopsided grin, drawn in flat ink
 *  so the face still reads once the figure is 30 m out. */
function scarecrowHead() {
  const head = new THREE.Group()
  head.add(scl(ball(0.24, P.burlap, 16), 1, 1.08, 0.94))
  for (const s of [-1, 1]) {
    for (const a of [0.75, -0.75]) {
      head.add(detail(at(rot(box(0.13, 0.032, 0.03, INK), 0, 0, a), 0.1 * s, 0.05, 0.22)))
    }
  }
  const grin = meshOf(new THREE.TorusGeometry(0.09, 0.026, 6, 14, Math.PI), INK)
  head.add(detail(at(rot(grin, 0, 0, Math.PI), 0, -0.04, 0.21)))
  head.add(at(tube(0.09, 0.12, 0.11, P.rope, 8), 0, -0.26, 0))
  return head
}

/** Floppy straw hat, tipped off true — nothing on a scarecrow is level. */
function scarecrowHat() {
  const hat = new THREE.Group()
  hat.add(tube(0.34, 0.38, 0.05, P.hay, 14))
  hat.add(at(tube(0.19, 0.22, 0.24, P.hay, 12), 0, 0.14, 0))
  hat.add(at(tube(0.225, 0.225, 0.06, P.barnRed, 12), 0, 0.05, 0))
  return rot(hat, 0.14, 0, -0.22)
}

/** Barrel torso with mismatched patches sewn on: the jacket is the only place
 *  this figure gets to be colourful, so the patches are full-saturation. */
function scarecrowJacket() {
  const j = new THREE.Group()
  j.add(tube(0.29, 0.35, 0.82, P.barnRed, 12))
  const patches = [[0.15, 0.2, 0.3, P.denim, 0.4], [-0.17, -0.08, 0.31, P.cream, -0.35], [0.02, -0.3, 0.33, P.hay, 0.85]]
  for (const [x, y, z, c, a] of patches) j.add(at(rot(box(0.19, 0.19, 0.05, c), 0, 0, a), x, y, z))
  j.add(at(rot(box(0.17, 0.17, 0.05, P.denimPale), 0, Math.PI / 2, 0.5), -0.31, 0.05, -0.05))
  return j
}

function buildScarecrow(seed) {
  const rnd = seeded(seed)
  const g = new THREE.Group()
  g.add(at(box(0.14, 2.05, 0.14, P.woodDark), 0, 1.02, 0))
  g.add(at(rot(box(1.44, 0.12, 0.12, P.woodDark), 0, 0, 0.06), 0, 1.5, -0.03))
  g.add(at(scarecrowJacket(), 0, 1.24, 0))
  for (const s of [-1, 1]) {
    const sleeve = rot(box(0.48, 0.18, 0.18, s > 0 ? P.denim : P.cream), 0, 0, 0.06 * s)
    g.add(at(sleeve, 0.47 * s, 1.5 + 0.02 * s, -0.03))
    g.add(at(strawFan(rnd, 5, 0.32, 0.95), 0.75 * s, 1.52 + 0.04 * s, -0.03))
  }
  g.add(at(strawFan(rnd, 6, 0.3, 1.2), 0, 0.86, 0))
  g.add(at(scarecrowHead(), 0, 1.86, 0.02))
  g.add(at(scarecrowHat(), 0, 2.06, -0.02))
  const crow = withSteps(STEPS.CHARACTER, () => songbird(P.crow, 0.19, 0x171320))
  g.add(at(rot(crow, 0, 2.5 + rnd() * 0.7, 0), 0.29, 2.03, 0.07))
  return addOutline(g, { pixels: INK_WEIGHT.PROP, interior: true })
}

/**
 * Patched scarecrow on a crossed stake, ~2.3 tall to the hat (2.5 to the
 * crow), with a crow standing on the brim conspicuously unafraid of him.
 * @param {number} [seed] omit for fresh straw and crow angle per call.
 */
export function makeScarecrow(seed = nextSeed()) {
  return withSteps(STEPS.ARCH, () => buildScarecrow(seed))
}

// -------------------------------------------------------------- laundry line

/** Hangs from the collar: the group origin is the point the peg grips. */
function shirt(color, w = 0.6, h = 0.66) {
  const s = new THREE.Group()
  s.add(at(box(w, h, 0.14, color), 0, -h / 2 - 0.06, 0))
  for (const k of [-1, 1]) {
    s.add(at(rot(box(0.4, 0.19, 0.13, color), 0, 0, -0.6 * k), (w / 2 + 0.13) * k, -0.22, 0))
  }
  s.add(at(box(w * 0.52, 0.1, 0.16, color), 0, -0.03, 0))
  return s
}

function overalls(color, w = 0.6, h = 0.8) {
  const o = new THREE.Group()
  for (const k of [-1, 1]) {
    o.add(at(box(0.11, 0.28, 0.11, color), 0.17 * k, -0.14, 0))
    o.add(at(box(w * 0.42, h * 0.62, 0.16, color), w * 0.27 * k, -h * 0.78, 0))
  }
  o.add(at(box(w, h * 0.5, 0.17, color), 0, -h * 0.45, 0))
  o.add(detail(at(box(0.19, 0.17, 0.04, P.cream), 0, -0.42, 0.1)))
  return o
}

/** Leaning pole with a crossbar the rope actually sits on. */
function laundryPole(h, lean) {
  const pole = new THREE.Group()
  pole.add(at(box(0.13, h, 0.13, P.wood), 0, h / 2, 0))
  pole.add(at(box(0.52, 0.11, 0.11, P.woodDark), 0, h - 0.1, 0))
  return rot(pole, 0, 0, lean)
}

const poleTip = (x, h, lean) => v3(x - Math.sin(lean) * (h - 0.1), Math.cos(lean) * (h - 0.1), 0)

/** Blown, not draped: every garment takes its own kick off the wind. */
function hang(cloth, p, rnd) {
  const g = at(new THREE.Group(), p.x, p.y - 0.05, p.z)
  g.rotation.set(-0.12 - rnd() * 0.35, (rnd() - 0.5) * 0.7, (rnd() - 0.5) * 0.5)
  g.add(cloth, detail(at(box(0.06, 0.15, 0.11, P.woodDark), 0, 0.06, 0)))
  return g
}

const LAUNDRY = [
  { kind: 'shirt', color: P.cream, t: 0.2 },
  { kind: 'overalls', color: P.denim, t: 0.42 },
  { kind: 'shirt', color: P.barnRed, t: 0.64 },
  { kind: 'shirt', color: P.denimPale, t: 0.84 },
]

function buildLaundryLine(seed) {
  const rnd = seeded(seed)
  const g = new THREE.Group()
  const [hL, hR, span, sag] = [2.05 + rnd() * 0.2, 1.86 + rnd() * 0.2, 2.6, 0.4]
  const [leanL, leanR] = [0.1, -0.13]
  g.add(at(laundryPole(hL, leanL), -span, 0, 0), at(laundryPole(hR, leanR), span, 0, 0))
  const [a, b] = [poleTip(-span, hL, leanL), poleTip(span, hR, leanR)]
  g.add(sagRope(a, b, sag, 0.035, P.rope))
  for (const item of LAUNDRY) {
    const cloth = item.kind === 'shirt' ? shirt(item.color) : overalls(item.color)
    g.add(hang(cloth, ropePoint(a, b, sag, item.t), rnd))
  }
  // Background dressing: cream, red and denim garments against green already
  // separate on hue and value, and nobody in the game ever touches them.
  return addOutline(g, { pixels: INK_WEIGHT.BACKGROUND })
}

/**
 * Two leaning poles, a rope that sags, and four billowing garments in cream,
 * red and denim. ~6.2 long along X, ~2.1 tall — the cheapest colour-and-
 * motion beat on the farm. Blocks like a fence, not like a post.
 * @param {number} [seed] omit for a fresh wind per call.
 */
export function makeLaundryLine(seed = nextSeed()) {
  return withSteps(STEPS.ARCH, () => buildLaundryLine(seed))
}

// -------------------------------------------------------------- crate stack

/** Slatted crate, origin at its centre so it can be stacked AND tipped. */
function crate(s, color = P.wood) {
  const c = new THREE.Group()
  c.add(box(s, s, s, color))
  const band = s * 0.13
  for (const k of [-1, 1]) {
    c.add(at(box(s * 1.03, band, band, P.woodDark), 0, s * 0.31 * k, s * 0.5))
    c.add(at(box(band, band, s * 1.03, P.woodDark), s * 0.5, s * 0.31 * k, 0))
    c.add(at(box(band, s * 1.03, band, P.woodDark), s * 0.31 * k, 0, s * 0.5))
  }
  return c
}

/** Loose kernels around the spill, flattened so they sit IN the grass. */
function grainPips(rnd, cx, cz, count = 7) {
  const pips = new THREE.Group()
  for (let i = 0; i < count; i++) {
    const a = rnd() * Math.PI * 2
    const r = 0.22 + rnd() * 0.45
    pips.add(at(scl(ball(0.055, P.grain, 6), 1, 0.55, 1), cx + Math.cos(a) * r, 0.04, cz + Math.sin(a) * r * 0.7))
  }
  return pips
}

function buildCrateStack(seed) {
  const rnd = seeded(seed)
  const g = new THREE.Group()
  const s = 0.68
  g.add(at(rot(crate(s), 0, 0.12, 0), 0, s / 2, 0))
  g.add(at(rot(crate(s * 0.92), 0, -0.3, 0.05), 0.06, s * 1.46, -0.05))
  // The tipped one IS the drawing: a stack nobody knocked over is furniture.
  g.add(at(rot(crate(s * 0.96), 0.12, 0.6, -1.42), -0.92, s * 0.6, 0.32))
  const [cx, cz] = [-1.42, 0.62]
  g.add(at(groundDecal(blobShape(rnd, 0.58), P.grain), cx, 0, cz))
  g.add(grainPips(rnd, cx, cz))
  // The slats and bands are painted a step apart in value and do the describing;
  // the spill keeps its DECAL boundary, which is a drawn ground shape's edge
  // rather than a contour round a solid.
  return addOutline(g, { pixels: INK_WEIGHT.BACKGROUND })
}

/**
 * Two stacked crates and a third tipped on its corner, spilling yellow grain
 * across the dirt as a flat inked decal. ~1.3 tall; the spill runs to about
 * x -2, so a blocking radius of ~0.8 around the origin is the honest one.
 * @param {number} [seed] omit for a fresh spill per call.
 */
export function makeCrateStack(seed = nextSeed()) {
  return withSteps(STEPS.ARCH, () => buildCrateStack(seed))
}

// -------------------------------------------------------------- wheelbarrow

/**
 * Why this barrow is standing up.
 *
 * It used to be tipped: a parent yaw plus a pitch and a roll, three contacts,
 * a lot of geometry describing a fall. It read as scrap. Not because the angles
 * were wrong but because a tipped wheelbarrow has no silhouette anyone knows —
 * the tray floats off the wheel, the two handles cross behind it in an X that
 * nothing explains, and the legs become a plus-sign hanging in the air beside
 * it. A cartoon prop that has to be explained is a failed prop, and the fastest
 * way to fix an unreadable pose is to stop posing.
 *
 * Standing, every part states its own job in one glance: wheel at the front on
 * the ground, tray between the handles, legs holding the back up, grips angled
 * up and back in a clean parallel pair. Three contacts — wheel and two feet —
 * and a painted shadow under each, so it sits on the grass rather than near it.
 */
function barrowTray() {
  const tray = new THREE.Group()
  tray.add(at(box(0.72, 0.44, 0.9, P.barnRed), 0, 0.63, 0.08))
  // Raked front board: the flare that says "you tip things OUT of this".
  tray.add(at(rot(box(0.74, 0.42, 0.1, P.barnDark), -0.3, 0, 0), 0, 0.68, 0.53))
  tray.add(at(box(0.8, 0.09, 0.98, P.cream), 0, 0.86, 0.08))
  return tray
}

function barrowWheel() {
  const wheel = new THREE.Group()
  wheel.add(at(rot(tube(0.26, 0.26, 0.14, P.rubber, 14), 0, 0, Math.PI / 2), 0, 0.26, 0.78))
  wheel.add(detail(at(rot(tube(0.09, 0.09, 0.17, P.metalDark, 8), 0, 0, Math.PI / 2), 0, 0.26, 0.78)))
  return wheel
}

/** One side's frame: handle, leg, foot pad and the fork down to the axle. All
 *  four in one plane at x = 0.3·side, so the pair never crosses. */
function barrowSide(side) {
  const frame = new THREE.Group()
  const x = 0.3 * side
  frame.add(at(rot(box(0.09, 0.09, 1.74, P.wood), 0.16, 0, 0), x, 0.53, -0.3))
  frame.add(at(box(0.1, 0.5, 0.1, P.wood), x, 0.29, -0.46))
  frame.add(at(box(0.14, 0.1, 0.32, P.woodDark), x, 0.05, -0.5))
  frame.add(at(rot(box(0.07, 0.07, 0.62, P.woodDark), 0.6, 0, 0), x, 0.42, 0.5))
  return frame
}

/**
 * Placement yaw this prop is authored against (world.js `_placeBarnYard`).
 *
 * At yaw 0 the barrow points its wheel straight at the start camera and the
 * tray foreshortens to nothing. -0.9 swings it to three-quarter: wheel, tray
 * side and both handles all in view at once. Read this instead of rolling
 * dice, exactly as makePig's restYaw is read.
 */
const BARROW_REST_YAW = -0.9

function buildWheelbarrow() {
  const g = new THREE.Group()
  g.add(barrowTray(), barrowWheel())
  for (const s of [-1, 1]) g.add(barrowSide(s))
  g.add(at(contactShadow(0.3, 0.22), 0, 0.012, 0.78))
  g.add(at(contactShadow(0.52, 0.26), 0, 0.012, -0.48))
  g.userData.restYaw = BARROW_REST_YAW
  // Yard dressing, not a handled prop: red tray, cream cap rail, wood frame and
  // near-black tyre are four painted values already. Promote it back to PROP if
  // a character is ever animated pushing it.
  return addOutline(g, { pixels: INK_WEIGHT.BACKGROUND })
}

/** Red barrow parked on its wheel and legs, handles up and back. ~2.4 long
 *  along Z, ~0.8 across, 0.9 to the grips.
 *  `userData.restYaw` is the placement yaw the pose is authored for. */
export function makeWheelbarrow() {
  return withSteps(STEPS.ARCH, buildWheelbarrow)
}

// ----------------------------------------------------------------- milk can

/** Classic dairy can in profile: fat shoulders, choked neck, flared lip. */
const MILK_PROFILE = [
  [0, 0], [0.3, 0], [0.32, 0.06], [0.32, 0.46], [0.28, 0.6],
  [0.16, 0.72], [0.16, 0.86], [0.19, 0.9], [0.19, 0.96], [0, 0.96],
]

function buildMilkCan() {
  const g = new THREE.Group()
  const profile = MILK_PROFILE.map(([r, y]) => new THREE.Vector2(r, y))
  g.add(meshOf(new THREE.LatheGeometry(profile, 18), P.metal))
  g.add(at(tube(0.33, 0.33, 0.06, P.metalDark, 18), 0, 0.5, 0))
  g.add(at(tube(0.175, 0.175, 0.1, P.barnRed, 14), 0, 1.0, 0))
  g.add(detail(at(ball(0.06, P.metalDark, 10), 0, 1.06, 0)))
  for (const s of [-1, 1]) {
    const handle = meshOf(new THREE.TorusGeometry(0.09, 0.028, 6, 12, Math.PI), P.metalDark)
    g.add(at(rot(handle, 0, Math.PI / 2, 0), 0.26 * s, 0.64, 0))
  }
  return addOutline(g, { pixels: INK_WEIGHT.BACKGROUND })
}

/** Steel milk can with a red lid, ~1.05 tall. A cool metal note against all
 *  that warm wood — pairs well stood in twos and threes by a door. */
export function makeMilkCan() {
  return withSteps(STEPS.ARCH, buildMilkCan)
}

// -------------------------------------------------------------- water trough

/**
 * A trough is a box with water in it, which is exactly why it is the easiest
 * prop on the farm to draw as untextured placeholder geometry: brown box, cyan
 * lid on top, done. Nothing in that says trough — a lid is not a liquid.
 *
 * Three things fix it and all three are drawing, not modelling. The water is
 * INSET below a rim that stands proud, so the tub has wall thickness and the
 * rim-to-water break is a real edge the interior-ink pass can stroke. The
 * water carries a drawn highlight streak, because still water in a cel is
 * always two tones and a line. And it is painted in P.water, the pond's blue,
 * rather than a cyan of its own: one farm, one liquid.
 */
const TROUGH = { len: 2.2, depth: 0.9, wall: 0.14, floorY: 0.24, rimY: 0.74 }

/** Plank tub: floor, two long walls, two ends. Boxes throughout, so every
 *  corner of it is an edge the second pen finds. */
function troughTub() {
  const { len, depth, wall, floorY, rimY } = TROUGH
  const tub = new THREE.Group()
  const h = rimY - floorY
  tub.add(at(box(len, 0.14, depth, P.wood), 0, floorY - 0.07, 0))
  for (const s of [-1, 1]) {
    tub.add(at(box(len, h, wall, P.wood), 0, floorY + h / 2, (depth / 2 - wall / 2) * s))
    tub.add(at(box(wall, h, depth - wall * 2, P.wood), (len / 2 - wall / 2) * s, floorY + h / 2, 0))
    // Skid under each end: the tub stands on something, and the gap under it
    // is where the contact shadow gets to be a line rather than a smudge.
    tub.add(at(box(0.24, 0.14, depth, P.woodDark), (len / 2 - 0.2) * s, floorY - 0.21, 0))
  }
  return tub
}

/** Rim lip standing proud of the tub on all four sides. This is the whole
 *  difference between "trough" and "box": you can see the wall thickness. */
function troughRim() {
  const { len, depth, rimY } = TROUGH
  const rim = new THREE.Group()
  for (const s of [-1, 1]) {
    rim.add(at(box(len + 0.2, 0.1, 0.24, P.woodDark), 0, rimY + 0.05, (depth / 2 - 0.08) * s))
    rim.add(at(box(0.24, 0.1, depth + 0.2, P.woodDark), (len / 2 - 0.02) * s, rimY + 0.05, 0))
    // Lit strip along the top of the lip. The rim is the edge that separates
    // the water from the world, so it is the one edge that gets a highlight.
    rim.add(detail(at(box(len + 0.16, 0.03, 0.13, P.wood), 0, rimY + 0.105, (depth / 2 - 0.11) * s)))
  }
  for (const s of [-1, 1]) {
    rim.add(at(box(0.09, rimY - TROUGH.floorY + 0.1, depth + 0.04, P.metalDark), 0.68 * s, 0.49, 0))
  }
  return rim
}

/**
 * Water surface, sunk under the rim, in three tones and a streak.
 *
 * One flat plate is a coloured lid. A cel paints held water as a dark band
 * where the wall shadows it, a lighter plate inboard of that, and a hard glare
 * streak on top — three flat notes with drawn edges between them, which is
 * what says "liquid in a container" rather than "cyan surface".
 */
function troughWater() {
  const { len, depth, wall } = TROUGH
  const water = new THREE.Group()
  const top = 0.62
  const [w, d] = [len - wall * 2, depth - wall * 2]
  water.add(at(box(w, 0.4, d, P.waterDeep), 0, top - 0.2, 0))
  water.add(detail(at(box(w - 0.14, 0.03, d - 0.12, P.water), 0, top + 0.005, 0)))
  const streaks = [[0.86, 0.07, -0.24, -0.08], [0.4, 0.055, 0.5, 0.13]]
  for (const [sw, sd, x, z] of streaks) {
    water.add(detail(at(rot(box(sw, 0.02, sd, P.waterLight), 0, 0.09, 0), x, top + 0.03, z)))
  }
  return water
}

function buildTrough() {
  const g = new THREE.Group()
  g.add(troughTub(), troughWater(), troughRim())
  g.add(at(contactShadow(TROUGH.len * 0.52, TROUGH.depth * 0.56, 0.36), 0, 0.012, 0))
  // Rim, wall and water are separated by paint — woodDark lip over wood plank
  // over waterDeep, with a lit strip along the lip and a glare streak on the
  // surface. Those are the LIGHT lines a background painter would use, and they
  // survive; the black contour that made a tub look modelled does not.
  return addOutline(g, { pixels: INK_WEIGHT.BACKGROUND })
}

/** Plank water trough, ~2.2 long, 0.84 to the rim, water inset below the lip
 *  in the pond's own blue. Built at final size — do not scale it up. */
export function makeTrough() {
  return withSteps(STEPS.ARCH, buildTrough)
}

// ---------------------------------------------------------------------- pond

/**
 * Water is a SHAPE with a line around it.
 *
 * The old pond was three concentric circles blending softly into the grass: a
 * dark disc peeking out from under a blue disc, which is a soft edge dressed as
 * a rim. Now the bank and the water are each a wobbled blob carrying a real
 * drawn boundary (toon.js `flat`, which strokes the outline in pixels instead
 * of trying to inflate a coplanar hull), so there is a hard inked waterline
 * with a mud bank drawn outside it. Both are built from ONE shape at two scales
 * so the bank can never crawl inside the water.
 */
function pondReeds(rnd, radius) {
  const reeds = new THREE.Group()
  for (let i = 0; i < 3; i++) {
    const a = 0.7 + i * 1.9 + rnd() * 0.5
    const r = radius * (0.98 + rnd() * 0.12)
    // Fan origin is the MIDDLE of each blade, so it sits at half a blade up or
    // the reeds grow downward out of the bank.
    reeds.add(at(strawFan(rnd, 5, 0.66, 0.38, P.leaf), Math.cos(a) * r, 0.45, Math.sin(a) * r * 0.88))
  }
  return reeds
}

function buildPond(radius, seed) {
  const rnd = seeded(seed)
  const g = new THREE.Group()
  const shape = blobShape(rnd, radius, 13, 0.9)
  g.add(scl(groundDecal(shape, P.mud, 0.018), 1.16, 1, 1.16))
  g.add(groundDecal(shape, P.water, 0.04))
  // Two flat glare streaks, same paint as the trough's — the eye should read
  // the two water bodies as the same substance from across the field.
  for (const [w, d, x, z, yaw] of [[radius * 0.8, 0.16, -radius * 0.1, -radius * 0.2, 0.12],
    [radius * 0.34, 0.11, radius * 0.36, radius * 0.16, -0.2]]) {
    g.add(detail(at(rot(box(w, 0.02, d, P.waterLight), 0, yaw, 0), x, 0.055, z)))
  }
  g.add(pondReeds(rnd, radius))
  // The waterline and the mud bank are DECAL boundaries drawn by groundDecal —
  // a drawn ground shape keeps its edge. The reeds standing out of it are
  // scenery and take none.
  return addOutline(g, { pixels: INK_WEIGHT.BACKGROUND })
}

/**
 * Painted pond, `radius` across, with a hard inked waterline, a drawn mud bank
 * and three reed tufts breaking the circle. Group origin is the pond centre on
 * the ground plane; it is a decal, so it registers no obstacle of its own.
 * @param {number} [radius]
 * @param {number} [seed] omit for a fresh outline per call.
 */
export function makePond(radius = 3.4, seed = nextSeed()) {
  return withSteps(STEPS.ARCH, () => buildPond(radius, seed))
}

// --------------------------------------------------------------- tire swing

function buildTireSwing(height) {
  const g = new THREE.Group()
  // The pivot is the bough's knot: everything hangs off it, so rotating it
  // swings rope and tire together as one pendulum.
  const pivot = at(new THREE.Object3D(), 0, height, 0)
  const drop = Math.max(0.5, height - 1.6)
  pivot.add(strut(v3(0, 0, 0), v3(0, -drop, 0), 0.045, P.rope))
  pivot.add(at(tube(0.075, 0.06, 0.16, P.woodDark, 8), 0, -drop + 0.06, 0))
  pivot.add(at(meshOf(new THREE.TorusGeometry(0.42, 0.17, 8, 18), P.rubber), 0, -drop - 0.44, 0))
  g.add(pivot)
  g.userData.pivot = pivot
  g.userData.parts = { pivot }
  return addOutline(g, { pixels: INK_WEIGHT.BACKGROUND })
}

/**
 * Rope and tire hanging in the air, ~0.5 above the grass.
 *
 * The group origin is the ground under the tire; `userData.pivot` is an
 * Object3D at the TOP of the rope, `height` up the Y axis. world.js should
 * place the group so that pivot lands under a bough, and may rotate the pivot
 * (X/Z) to swing the whole thing — the rope and tire are its children.
 * @param {number} [height] rope-top height above ground.
 */
export function makeTireSwing(height = 3.0) {
  return withSteps(STEPS.ARCH, () => buildTireSwing(height))
}

// -------------------------------------------------------------- pecking hen

/**
 * Deliberately under the protagonist's size, and inked at PROP rather than
 * HERO: a background hen has to read as flock, and the moment two hens are the
 * same weight and scale the player loses track of which one is hers.
 */
// Lifting the tail into a readable fan also lifted her overall height, so the
// scale comes down to hold the gap that keeps the flock from competing with the
// protagonist: ~1.45 tall against the player hen's 2.03.
const PECKER_SCALE = 0.72

/**
 * The peck pose, and the two things that were wrong with it.
 *
 * First, depth. The head sat at body-local z 0.36 against a torso whose front
 * pole is at 0.35, then took another 0.42 of pitch on top of a 0.62 body — so
 * at the bottom of the peck the skull was INSIDE the torso and the only part of
 * it still outside the silhouette was the comb, surfacing halfway down the
 * flank where it read as a wound. The head now sits at 0.52, which is a full
 * head-radius clear of the ellipsoid, with a neck bridging the gap: the head,
 * the beak and the comb all stay outside the body at the pose's lowest point,
 * and the beak tip lands within a centimetre of the grass.
 *
 * Second, facing. The model span its own random yaw over the full circle, on
 * top of whatever yaw world.js placed it at, so half the flock ended up tail-on
 * — and a bird rendered tail-on is a featureless egg at any polish level, since
 * everything that says "bird" (beak, comb, eye, breast) is on the front. She
 * faces +Z now like every other model, with only a few degrees of jitter, and
 * publishes the three-quarter yaw as restYaw for the placer to use.
 */
const PECKER = { bodyY: 0.52, pitch: 0.5, headY: 0.06, headZ: 0.52, headPitch: 0.5 }

/** Yaw that presents her three-quarter to the start camera (which looks down
 *  -Z): head, beak and tail fan all in view, none of them foreshortened. */
const PECKER_REST_YAW = -1.05

function peckerBody() {
  const body = at(rot(new THREE.Group(), PECKER.pitch, 0, 0), 0, PECKER.bodyY, 0)
  body.add(scl(ball(0.28, P.hen), 1.06, 0.95, 1.25))
  // Neck out of the shoulder. Without it the clearance that keeps the head
  // readable reads as a head floating off the front of a loaf.
  body.add(strut(v3(0, -0.01, 0.25), v3(0, PECKER.headY - 0.01, PECKER.headZ - 0.04), 0.125, P.hen, 10))
  body.add(at(rot(henHead(), PECKER.headPitch, 0, 0), 0, PECKER.headY, PECKER.headZ))
  body.add(henWing(-1), henWing(1))
  // Tail fanned wider and lifted: pitched this far forward the rear IS the
  // silhouette, and a fan is the only shape that keeps it from being a rump.
  body.add(at(scl(henTail(), 1.18), 0, 0.06, -0.3))
  return body
}

function buildPeckingHen(seed) {
  const rnd = seeded(seed)
  const g = new THREE.Group()
  const rig = scl(new THREE.Group(), HEN_SCALE * PECKER_SCALE)
  const [legL, legR] = [henLeg(-1), henLeg(1)]
  legL.position.z += 0.08
  legR.position.z -= 0.05
  // Thighs live on the rig rather than on the body here: the pecker's torso is
  // pitched 0.5 rad, and a hip mass that took that pitch would swing clear of
  // the socket it exists to fill.
  for (const s of [-1, 1]) rig.add(henThigh(s, 0))
  rig.add(peckerBody(), legL, legR)
  g.add(rot(rig, 0, (rnd() - 0.5) * 0.45, 0))
  g.add(at(contactShadow(0.34, 0.26, 0.34), 0, 0.012, 0.06))
  g.userData.restYaw = PECKER_REST_YAW
  return addOutline(g, { pixels: INK_WEIGHT.PROP, interior: true })
}

/**
 * Static decorative hen, head down mid-peck, neck and beak clear of the body.
 * ~1.45 tall against the player hen's 2.03, so she reads as flock and never
 * competes with the protagonist for the eye. Faces +Z; `userData.restYaw` is
 * the three-quarter placement yaw the pose is drawn for.
 * @param {number} [seed] omit for a fresh few degrees of jitter per call.
 */
export function makePeckingHen(seed = nextSeed()) {
  return withSteps(STEPS.CHARACTER, () => buildPeckingHen(seed))
}
