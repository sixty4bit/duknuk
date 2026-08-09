import * as THREE from 'three'
import { toonMaterial, addOutline } from './toon.js'

// Every builder returns a THREE.Group whose origin sits at ground contact and
// which faces +Z. Primitives only. Cartoon proportions beat real ones: big
// heads, fat silhouettes, chunky readable shapes at 50 m.

const INK = 0x1a1208
const P = {
  hen: 0xfffaf0,
  henShade: 0xefdfbe,
  comb: 0xe03a2c,
  beak: 0xf5a623,
  shell: 0xfdf3da,
  barnRed: 0xc8352b,
  barnDark: 0x9b2620,
  cream: 0xfff4d6,
  wood: 0xb07a3e,
  woodDark: 0x7d5228,
  dark: 0x2a1c10,
  hay: 0xe8b23c,
  hayDark: 0xc7902a,
  pig: 0xf4a3b6,
  pigDark: 0xd97e96,
  hoof: 0x4a3320,
  leaf: 0x4fa33c,
  leafLight: 0x74c94b,
  trunk: 0x8a5a2e,
  suit: 0x4a6fb0,
}

// ---------------------------------------------------------------- primitives

function meshOf(geometry, color, opts) {
  const m = new THREE.Mesh(geometry, toonMaterial(color, opts))
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

function extruded(shape, depth, color) {
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 8 })
  geo.translate(0, 0, -depth / 2)
  return meshOf(geo, color)
}

/** Deterministic wobble so every haystack/tree is identical between reloads. */
function seeded(seed) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}

// ------------------------------------------------------------------- chicken

function henComb() {
  const comb = new THREE.Group()
  for (const [y, z] of [[0.05, 0.08], [0.075, 0], [0.045, -0.08]]) {
    comb.add(at(scl(ball(0.065, P.comb, 14), 0.5, 1.4, 1.0), 0, y, z))
  }
  return comb
}

function henHead() {
  const head = new THREE.Group()
  head.add(ball(0.16, P.hen))
  const comb = at(henComb(), 0, 0.13, 0.01)
  head.add(comb)
  head.add(at(rot(spike(0.058, 0.18, P.beak, 10), Math.PI / 2), 0, -0.02, 0.2))
  head.add(at(ball(0.045, P.comb, 12), 0, -0.1, 0.14))
  head.add(at(ball(0.033, P.comb, 12), 0, -0.15, 0.115))
  for (const s of [-1, 1]) {
    head.add(at(ball(0.052, P.shell, 12), 0.075 * s, 0.045, 0.115))
    head.add(detail(at(ball(0.029, INK, 10), 0.086 * s, 0.05, 0.145)))
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
  leg.add(at(tube(0.033, 0.04, 0.32, P.beak, 8), 0, -0.16, 0))
  const foot = at(new THREE.Group(), 0, -0.32, 0)
  foot.add(at(box(0.11, 0.05, 0.11, P.beak), 0, 0.025, 0.02))
  for (const a of [-0.55, 0, 0.55]) {
    foot.add(at(rot(box(0.05, 0.045, 0.18, P.beak), 0, a, 0), Math.sin(a) * 0.055, 0.025, 0.09))
  }
  leg.add(foot)
  return leg
}

/** White hen, ~0.9 to the head and ~1.05 to the comb tips: beach-ball body,
 *  oversized head, huge comb, stubby wings, skinny legs, big splayed feet. */
export function makeChicken() {
  const g = new THREE.Group()
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
  g.add(body, legL, legR)
  g.userData.parts = { body, head, comb: head.userData.comb, wingL, wingR, legL, legR, tail }
  return addOutline(g, { thickness: 0.028 })
}

// ----------------------------------------------------------------------- egg

/** Off-white egg, ~0.25 tall, resting on the ground. */
export function makeEgg() {
  const g = new THREE.Group()
  const h = 0.25
  const profile = []
  for (let i = 0; i <= 16; i++) {
    const t = (i / 16) * Math.PI
    const r = 0.104 * Math.sin(t) * (1 - 0.22 * Math.cos(t))
    profile.push(new THREE.Vector2(Math.max(0, r), (h / 2) * (1 - Math.cos(t))))
  }
  g.add(meshOf(new THREE.LatheGeometry(profile, 18), P.shell))
  return addOutline(g, { thickness: 0.021 })
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

/** Red hen-house on stumpy legs, ~2.6 wide, ramp up to a dark doorway. */
export function makeCoop() {
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
  return addOutline(g, { thickness: 0.07 })
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

function barnLoft() {
  const loft = new THREE.Group()
  loft.add(at(box(2.2, 2.0, 0.2, P.cream), 0, 5.45, 4.36))
  loft.add(at(box(1.72, 1.52, 0.2, P.dark), 0, 5.45, 4.44))
  loft.add(at(box(0.28, 0.28, 1.6, P.cream), 0, 6.8, 4.75))
  loft.add(at(tube(0.045, 0.045, 0.55, P.dark, 6), 0, 6.4, 5.4))
  return loft
}

/** Classic Saturday-morning barn: bulging gambrel, cream trim, X-braced doors. */
export function makeBarn() {
  const g = new THREE.Group()
  g.add(extruded(barnWallShape(), 8, P.barnRed))
  g.add(extruded(barnRoofShape(), 8.7, P.barnDark))
  for (const s of [-1, 1]) g.add(at(box(10.5, 0.32, 0.32, P.cream), 0, 4.16, 4.02 * s))
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) g.add(at(box(0.32, 4.2, 0.32, P.cream), 5.04 * sx, 2.1, 3.94 * sz))
  }
  g.add(barnDoors(), barnLoft())
  g.add(at(box(0.16, 4.4, 0.12, P.barnRed), 0, 2.3, 4.24))
  return addOutline(g, { thickness: 0.1 })
}

// --------------------------------------------------------------------- props

/** Post-and-rail fence running along +X, centered on the origin. */
export function makeFence(length = 6) {
  const g = new THREE.Group()
  const spans = Math.max(1, Math.round(length / 2.2))
  const gap = length / spans
  for (let i = 0; i <= spans; i++) {
    const post = rot(box(0.19, 1.2, 0.2, P.cream), 0, 0, (i % 2 ? 1 : -1) * 0.03)
    g.add(at(post, -length / 2 + i * gap, 0.55, 0))
  }
  for (const y of [0.84, 0.46]) g.add(at(box(length, 0.15, 0.12, P.cream), 0, y, 0.03))
  return addOutline(g, { thickness: 0.04 })
}

/** Golden hay mound, ~2.5 tall, with straw poking out at silly angles. */
export function makeHaystack() {
  const g = new THREE.Group()
  const profile = []
  for (let i = 0; i <= 11; i++) {
    const t = i / 12
    profile.push(new THREE.Vector2(1.5 * (1 - t) ** 0.62 * (1 + 0.14 * Math.sin(t * Math.PI)), t * 2.4))
  }
  profile.push(new THREE.Vector2(0, 2.52))
  g.add(meshOf(new THREE.LatheGeometry(profile, 20), P.hay))
  const rnd = seeded(7)
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + rnd() * 0.6
    const y = 0.35 + rnd() * 1.5
    const r = 1.4 * (1 - y / 2.5) ** 0.62
    const swivel = at(rot(new THREE.Group(), 0, a, 0), Math.sin(a) * r, y, Math.cos(a) * r)
    swivel.add(rot(spike(0.09, 0.62, P.hayDark, 6), 1.05 + rnd() * 0.3, 0, 0))
    g.add(swivel)
  }
  return addOutline(g, { thickness: 0.07 })
}

// ----------------------------------------------------------------------- pig

function pigHead() {
  const head = new THREE.Group()
  head.add(at(ball(0.33, P.pig), 0.58, 0.4, 0.04))
  head.add(at(rot(tube(0.19, 0.21, 0.2, P.pigDark, 14), 0, 0, Math.PI / 2), 0.96, 0.33, 0.12))
  for (const s of [-1, 1]) head.add(detail(at(ball(0.035, INK, 8), 1.06, 0.33, 0.12 + 0.07 * s)))
  for (const s of [-1, 1]) {
    const ear = scl(spike(0.17, 0.3, P.pigDark, 8), 1, 1, 0.45)
    head.add(at(rot(ear, 0.55, 0, -0.75), 0.46, 0.6, 0.02 + 0.2 * s))
  }
  // Closed eye rides high on the skull so it stays readable from the tycoon
  // camera whatever yaw the world drops the pig in at.
  const lid = meshOf(new THREE.TorusGeometry(0.1, 0.03, 6, 16, Math.PI), INK)
  head.add(detail(at(rot(lid, -0.93, 0.36, 0), 0.7, 0.66, 0.23)))
  return head
}

/** Four stubby legs poking out of the belly: two on the ground, two flopped on top. */
function pigLegs() {
  const legs = new THREE.Group()
  for (const x of [0.36, -0.34]) {
    for (const [y, splay] of [[0.13, 0.16], [0.46, -0.14]]) {
      const hip = at(rot(new THREE.Group(), 0, splay * Math.sign(x), 0), x, y, 0.42)
      hip.add(at(rot(tube(0.11, 0.13, 0.52, P.pig, 10), Math.PI / 2, 0, 0), 0, 0, 0.26))
      hip.add(at(rot(tube(0.14, 0.12, 0.13, P.hoof, 8), Math.PI / 2, 0, 0), 0, 0, 0.57))
      legs.add(hip)
    }
  }
  return legs
}

/** Pink pig flopped on its side, big round belly, fast asleep. ~1.9 long. */
export function makePig() {
  const g = new THREE.Group()
  g.add(at(scl(ball(0.48, P.pig), 1.3, 0.8, 1.0), 0, 0.38, 0))
  g.add(at(scl(ball(0.42, P.pig), 1.15, 0.85, 0.85), -0.04, 0.4, 0.3))
  g.add(pigHead(), pigLegs())
  const tail = meshOf(new THREE.TorusGeometry(0.11, 0.035, 6, 14), P.pigDark)
  g.add(at(rot(tail, 0, 0.5, 0), -0.64, 0.44, -0.06))
  return addOutline(g, { thickness: 0.05 })
}

// ---------------------------------------------------------------------- tree

/** Broccoli-blob tree, ~5 tall. */
export function makeTree() {
  const g = new THREE.Group()
  g.add(at(rot(tube(0.26, 0.46, 1.9, P.trunk, 10), 0, 0, 0.04), 0, 0.94, 0))
  g.add(at(rot(tube(0.13, 0.17, 0.9, P.trunk, 8), 0, 0.4, 0.85), -0.4, 2.05, 0.1))
  const canopy = at(new THREE.Group(), 0, 2.85, 0)
  const blobs = [
    [0, 0.55, 0, 1.3, P.leafLight],
    [-1.0, -0.05, 0.2, 0.95, P.leaf],
    [0.98, 0.08, -0.22, 1.0, P.leaf],
    [0.18, -0.22, 0.92, 0.86, P.leafLight],
    [-0.3, 0.32, -0.92, 0.9, P.leaf],
    [0.55, 0.88, 0.38, 0.78, P.leafLight],
  ]
  for (const [x, y, z, r, c] of blobs) canopy.add(at(ball(r, c, 18), x, y, z))
  g.add(canopy)
  return addOutline(g, { thickness: 0.09 })
}

// ------------------------------------------------------------------ salesman

/** Traveling-salesman NPC placeholder, ~1.8 tall. Unused in phase 1. */
export function makeSalesman() {
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
  return addOutline(g, { thickness: 0.04 })
}
