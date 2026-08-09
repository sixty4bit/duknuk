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
  pig: 0xf4a3b6,
  pigDark: 0xd97e96,
  // Warm mid-brown, not near-black: dark hooves under a belly read as four
  // planted boots and stand the animal back up.
  hoof: 0x6b4a2e,
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
}

// ---------------------------------------------------------------- primitives

// Ramp steps for the shape currently under construction. Two for architecture
// (one lit plane, one dark plane per form) and three for characters — more
// than that and the bands sit adjacent on curved geometry and read as a
// gradient, which is exactly what flat cartoon colour is not.
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
function henComb() {
  const comb = new THREE.Group()
  for (const [y, z] of [[0.06, 0.115], [0.105, 0], [0.055, -0.115]]) {
    comb.add(at(scl(ball(0.095, P.comb, 14), 0.5, 1.5, 1.0), 0, y, z))
  }
  return comb
}

function henHead() {
  const head = new THREE.Group()
  head.add(ball(0.175, P.hen))
  const comb = at(henComb(), 0, 0.14, 0.01)
  head.add(comb)
  head.add(at(rot(spike(0.082, 0.27, P.beak, 10), Math.PI / 2), 0, -0.02, 0.26))
  head.add(at(ball(0.062, P.comb, 12), 0, -0.11, 0.15))
  head.add(at(ball(0.046, P.comb, 12), 0, -0.18, 0.12))
  for (const s of [-1, 1]) {
    head.add(at(ball(0.058, P.shell, 12), 0.08 * s, 0.05, 0.12))
    head.add(detail(at(ball(0.034, INK, 10), 0.092 * s, 0.055, 0.152)))
  }
  head.userData.comb = comb
  return head
}

function henWing(side) {
  const wing = at(new THREE.Group(), 0.27 * side, 0.05, -0.02)
  wing.add(at(scl(ball(0.17, P.hen, 16), 0.3, 0.82, 1.05), 0.015 * side, -0.1, 0))
  wing.add(at(scl(ball(0.095, P.henShade, 12), 0.3, 0.85, 1.1), 0.02 * side, -0.21, -0.07))
  return wing
}

function henTail() {
  const tail = new THREE.Group()
  const fan = [-0.4, 0, 0.4]
  fan.forEach((a, i) => {
    const feather = scl(spike(0.085, 0.36, i === 1 ? P.henShade : P.hen, 10), 0.42, 1, 1)
    tail.add(at(rot(feather, -0.95, 0, a), 0, 0.12, -0.06))
  })
  return tail
}

function henLeg(side) {
  const leg = at(new THREE.Group(), 0.11 * side, 0.32, 0.02)
  leg.add(at(tube(0.042, 0.05, 0.32, P.beak, 8), 0, -0.16, 0))
  const foot = at(new THREE.Group(), 0, -0.32, 0)
  foot.add(at(box(0.15, 0.06, 0.15, P.beak), 0, 0.03, 0.02))
  for (const a of [-0.6, 0, 0.6]) {
    foot.add(at(rot(box(0.065, 0.055, 0.24, P.beak), 0, a, 0), Math.sin(a) * 0.075, 0.03, 0.12))
  }
  leg.add(foot)
  return leg
}

/** She is the subject of the game, so she is drawn at protagonist scale rather
 *  than at hen scale — the rig is built at natural proportion and blown up. */
const HEN_SCALE = 1.8

function buildChicken() {
  const g = new THREE.Group()
  const rig = scl(new THREE.Group(), HEN_SCALE)
  const body = at(new THREE.Group(), 0, 0.46, 0)
  body.add(scl(ball(0.28, P.hen), 1.06, 0.95, 1.25))
  // Head rides high and forward so head-vs-body still reads as two shapes from
  // the steep tycoon camera.
  const head = at(henHead(), 0, 0.28, 0.24)
  const wingL = henWing(-1)
  const wingR = henWing(1)
  const tail = at(henTail(), 0, 0, -0.26)
  body.add(head, wingL, wingR, tail)
  const legL = henLeg(-1)
  const legR = henLeg(1)
  rig.add(body, legL, legR)
  g.add(rig)
  g.userData.parts = { body, head, comb: head.userData.comb, wingL, wingR, legL, legR, tail }
  // Heaviest line in the frame: the subject reads before the props do.
  return addOutline(g, { pixels: INK_WEIGHT.HERO })
}

/** Cream hen, ~1.85 to the comb tips: beach-ball body, oversized head, huge
 *  comb, stubby wings, skinny legs, big splayed feet. */
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
    roof.add(at(rot(box(2.7, 0.14, 1.36, P.barnDark), 0.62 * s, 0, 0), 0, 2.42, 0.47 * s))
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
  // The chicken's home and the frame's second read: hero weight, like the barn.
  return addOutline(g, { pixels: INK_WEIGHT.HERO })
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
 * Segments per curve on the gambrel arc.
 *
 * ExtrudeGeometry gives every facet a flat normal, so the 2-step toon ramp
 * breaks exactly on facet edges: at 8 segments per curve that break was a
 * visible staircase climbing the roof, and the silhouette was a polygon. The
 * roof spans ~11 m across five curves, so 32 puts a facet every ~7 cm — under
 * the ink weight at any sane camera distance, which turns the staircase back
 * into one clean lit-plane edge. Cheap: it is one extrude, built once.
 */
const ROOF_CURVE_SEGMENTS = 32

function barnRoofShape() {
  const s = new THREE.Shape()
  s.moveTo(-5.45, 4.02)
  s.quadraticCurveTo(-4.85, 5.5, -3.7, 6.3)
  s.quadraticCurveTo(-1.9, 7.25, 0, 7.4)
  s.quadraticCurveTo(1.9, 7.25, 3.7, 6.3)
  s.quadraticCurveTo(4.85, 5.5, 5.45, 4.02)
  s.lineTo(-5.45, 4.02)
  return s
}

function barnDoors() {
  const doors = new THREE.Group()
  doors.add(at(box(4.95, 4.85, 0.18, P.cream), 0, 2.4, 4.02))
  for (const s of [-1, 1]) {
    const leaf = at(new THREE.Group(), 1.13 * s, 2.3, 4.14)
    leaf.add(box(2.06, 4.4, 0.16, P.cream))
    for (const y of [2.0, -2.0]) leaf.add(at(box(2.06, 0.26, 0.1, P.barnRed), 0, y, 0.1))
    for (const a of [-1, 1]) leaf.add(at(rot(box(0.26, 4.5, 0.1, P.barnRed), 0, 0, a * 0.44), 0, 0, 0.09))
    doors.add(leaf)
  }
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
  g.add(extruded(barnRoofShape(), 8.7, P.barnDark, ROOF_CURVE_SEGMENTS))
  for (const s of [-1, 1]) g.add(at(box(10.5, 0.32, 0.32, P.cream), 0, 4.16, 4.02 * s))
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) g.add(at(box(0.32, 4.2, 0.32, P.cream), 5.04 * sx, 2.1, 3.94 * sz))
  }
  g.add(barnDoors(), barnLoft())
  g.add(at(box(0.16, 4.4, 0.12, P.barnRed), 0, 2.3, 4.24))
  // The biggest silhouette on the farm has to carry the heaviest line, or it
  // dissolves into the field at viewing size.
  return addOutline(g, { pixels: INK_WEIGHT.HERO })
}

/** Classic Saturday-morning barn: bulging gambrel, cream trim, X-braced doors. */
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
  return addOutline(g, { pixels: INK_WEIGHT.PROP })
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
  // The mound is a building-sized mass, so it carries a building's line or it
  // dissolves into the field; the straw stays a step lighter so the decoration
  // never out-draws the shape it sits on.
  addOutline(mound, { pixels: INK_WEIGHT.HERO })
  return addOutline(g, { pixels: INK_WEIGHT.PROP })
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

/** Cheek on the grass: the skull sits low and the snout dips into the dirt. */
function pigHead() {
  const head = new THREE.Group()
  head.add(at(ball(0.33, P.pig), 0.58, 0.33, 0.06))
  head.add(at(rot(tube(0.19, 0.21, 0.2, P.pigDark, 14), 0, 0, Math.PI / 2), 0.95, 0.24, 0.14))
  for (const s of [-1, 1]) head.add(detail(at(ball(0.035, INK, 8), 1.05, 0.24, 0.14 + 0.07 * s)))
  for (const s of [-1, 1]) {
    const ear = scl(spike(0.17, 0.3, P.pigDark, 8), 1, 1, 0.45)
    head.add(at(rot(ear, 0.75, 0, -0.9), 0.44, 0.52, 0.04 + 0.2 * s))
  }
  // Closed eye rides high on the skull so it clears the snout from the steep
  // tycoon camera. It is the whole joke, so it gets the best real estate.
  const lid = meshOf(new THREE.TorusGeometry(0.11, 0.032, 6, 16, Math.PI), INK)
  head.add(detail(at(rot(lid, -0.93, 0.36, 0), 0.68, 0.57, 0.25)))
  return head
}

function pigLeg(len) {
  const leg = new THREE.Group()
  leg.add(at(rot(tube(0.11, 0.13, len, P.pig, 10), Math.PI / 2, 0, 0), 0, 0, len / 2))
  leg.add(at(rot(tube(0.14, 0.12, 0.13, P.hoof, 8), Math.PI / 2, 0, 0), 0, 0, len + 0.06))
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
    legs.add(at(rot(pigLeg(0.3), 0.2, 0.18 * s, 0), x, 0.17, 0.28))
    legs.add(at(rot(pigLeg(0.5), -0.6, -0.3 * s, 0), x * 0.74, 0.62, 0.26))
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
  g.add(pigContact(), body, pigHead(), pigLegs())
  const tail = meshOf(new THREE.TorusGeometry(0.11, 0.035, 6, 14), P.pigDark)
  g.add(at(rot(tail, 0, 0.5, 0), -0.62, 0.33, -0.04))
  driveBreath(body, body.children[0])
  g.userData.parts = { body }
  g.userData.restYaw = PIG_REST_YAW
  // A gag lying in the chicken's path is a foreground read, a step under hero.
  return addOutline(g, { pixels: 4.0 })
}

/** Pink pig flopped on its side, big round belly, fast asleep. ~1.9 long.
 *  `userData.restYaw` is the yaw that faces the gag at the camera. */
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

function treeTrunk(rnd, h) {
  const trunk = new THREE.Group()
  const r = 0.2 + rnd() * 0.12
  trunk.add(at(rot(tube(r, r * 1.75, h, P.trunk, 10), 0, 0, 0.04), 0, h / 2, 0))
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
  lean.add(treeTrunk(rnd, trunkH), treeCanopy(kind, rnd, leafPair(rnd), trunkH))
  g.add(lean)
  // Trees are scenery, not subject: a thin line lets the treeline sit behind
  // the buildings. world.js should thin it further toward 0 with distance via
  // toon.js `setInkWeight` once each tree is placed.
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
  return addOutline(g, { pixels: INK_WEIGHT.HERO })
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
// origin, facing +Z, inked at PROP weight so the whole set sits one step
// behind the hen and the buildings in the line hierarchy.

const UP = new THREE.Vector3(0, 1, 0)
const v3 = (x, y, z) => new THREE.Vector3(x, y, z)

/** Cylinder spanning two points — every rope link, stay and frame joint. */
function strut(a, b, r, color, seg = 6) {
  const dir = new THREE.Vector3().subVectors(b, a)
  const len = Math.max(dir.length(), 1e-4)
  const m = tube(r, r, len, color, seg)
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
function songbird(color, r = 0.15, accent = color) {
  const b = new THREE.Group()
  b.add(at(scl(ball(r, color, 14), 1, 0.94, 1.18), 0, r * 1.0, 0))
  b.add(at(ball(r * 0.72, color, 12), 0, r * 1.82, r * 0.46))
  b.add(at(rot(spike(r * 0.3, r * 0.72, P.beak, 8), Math.PI / 2), 0, r * 1.74, r * 1.05))
  for (const s of [-1, 1]) {
    b.add(detail(at(ball(r * 0.17, INK, 8), r * 0.33 * s, r * 2.02, r * 0.86)))
    b.add(at(scl(ball(r * 0.62, accent, 10), 0.3, 0.86, 1.12), r * 0.84 * s, r * 1.02, -r * 0.06))
    b.add(detail(at(tube(r * 0.11, r * 0.11, r * 0.5, P.beak, 6), r * 0.3 * s, r * 0.26, r * 0.12)))
  }
  b.add(at(rot(scl(spike(r * 0.52, r * 1.5, accent, 8), 1, 1, 0.32), -1.95, 0, 0), 0, r * 1.12, -r * 1.2))
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
  const bird = withSteps(STEPS.CHARACTER, () => songbird(body, 0.15, accent))
  g.add(at(rot(bird, 0, rnd() * Math.PI * 2, 0), 0, h + 0.02, 0))
  return addOutline(g, { pixels: INK_WEIGHT.PROP })
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
    const straw = scl(spike(len * 0.25, len * (0.7 + rnd() * 0.7), color, 6), 1, 1, 0.4)
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
  return addOutline(g, { pixels: INK_WEIGHT.PROP })
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
  return addOutline(g, { pixels: INK_WEIGHT.PROP })
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
  return addOutline(g, { pixels: INK_WEIGHT.PROP })
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

/** Tray, wheel, handles and legs, built upright and level. The tip is applied
 *  by the caller as one rotation, so the shape stays easy to read while it is
 *  being authored and only the pose is the gag. */
function barrowRig() {
  const rig = new THREE.Group()
  rig.add(at(box(0.72, 0.44, 0.9, P.barnRed), 0, 0.63, 0.08))
  rig.add(at(box(0.8, 0.09, 0.98, P.cream), 0, 0.86, 0.08))
  rig.add(at(rot(tube(0.26, 0.26, 0.14, P.rubber, 14), 0, 0, Math.PI / 2), 0, 0.26, 0.78))
  rig.add(detail(at(rot(tube(0.09, 0.09, 0.17, P.metalDark, 8), 0, 0, Math.PI / 2), 0, 0.26, 0.78)))
  for (const s of [-1, 1]) {
    rig.add(at(rot(box(0.09, 0.09, 1.7, P.wood), -0.1, 0, 0), 0.3 * s, 0.5, -0.32))
    rig.add(at(box(0.09, 0.44, 0.09, P.wood), 0.3 * s, 0.24, -0.48))
    rig.add(at(rot(box(0.07, 0.07, 0.62, P.woodDark), 0.6, 0, 0), 0.3 * s, 0.42, 0.5))
  }
  return rig
}

function buildWheelbarrow() {
  const g = new THREE.Group()
  // Nobody parks a barrow squarely on its legs; a catalogue photograph is not
  // a drawing. It has gone over onto one handle, wheel free in the air.
  g.add(at(rot(barrowRig(), 0.1, 0.35, -1.15), -0.42, 0.28, 0.16))
  return addOutline(g, { pixels: INK_WEIGHT.PROP })
}

/** Red barrow tipped over onto one handle, wheel off the dirt. ~2.3 long
 *  along Z with the handles, ~1.4 across. */
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
  return addOutline(g, { pixels: INK_WEIGHT.PROP })
}

/** Steel milk can with a red lid, ~1.05 tall. A cool metal note against all
 *  that warm wood — pairs well stood in twos and threes by a door. */
export function makeMilkCan() {
  return withSteps(STEPS.ARCH, buildMilkCan)
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
  return addOutline(g, { pixels: INK_WEIGHT.PROP })
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
const PECKER_SCALE = 0.78

function buildPeckingHen(seed) {
  const rnd = seeded(seed)
  const g = new THREE.Group()
  const rig = scl(new THREE.Group(), HEN_SCALE * PECKER_SCALE)
  // Pitched hard forward: head in the dirt, tail thrown up. A standing hen is
  // a duplicate of the player's; a pecking one is a different drawing.
  const body = at(rot(new THREE.Group(), 0.62, 0, 0), 0, 0.47, 0)
  body.add(scl(ball(0.28, P.hen), 1.06, 0.95, 1.25))
  body.add(at(rot(henHead(), 0.42, 0, 0), 0, 0.1, 0.36))
  body.add(henWing(-1), henWing(1), at(henTail(), 0, 0.02, -0.26))
  const [legL, legR] = [henLeg(-1), henLeg(1)]
  legL.position.z += 0.08
  legR.position.z -= 0.05
  rig.add(body, legL, legR)
  g.add(rot(rig, 0, rnd() * Math.PI * 2, 0))
  return addOutline(g, { pixels: INK_WEIGHT.PROP })
}

/**
 * Static decorative hen, head down mid-peck. Scaled to 0.78 of the player
 * hen and folded forward, so she stands about two thirds the protagonist's
 * height (1.36 vs 2.03) and never competes with her for the eye.
 * @param {number} [seed] omit for a fresh facing per call.
 */
export function makePeckingHen(seed = nextSeed()) {
  return withSteps(STEPS.CHARACTER, () => buildPeckingHen(seed))
}
