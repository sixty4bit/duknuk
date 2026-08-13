import * as THREE from 'three'
import { makeChicken, makeEgg } from '../art/models.js'
import { findPath } from './pathfind.js'
import * as audio from '../audio.js'

const WALK_SPEED = 2.3
const SAD_SPEED = 0.5
const ARRIVE_EPS = 0.12
const TURN_RATE = 6 // rad/s

const PECK_INTERVAL = 0.45
const PECK_AMOUNT = 0.18
// A peck tears up more grass than she digests — scratched-up turf, not food.
// This is the depletion-pace knob (carl 2026-08-10: "patch depletion needs to
// be a little faster still"): raising the peck RATE barely moves effective
// consumption because the eat/walk-home/lay cycle caps digestion at ~1 belly
// per ~37s, but waste scales patch drain directly without touching the egg
// economy. At 2x, net drain vs the 0.012 regrowth budget lands ~3x faster
// than digestion-only grazing.
const GRAZE_WASTE = 2
// A peck yielding under a quarter of the ask means the cell under her beak is
// grazed out — walk to better grass instead of sipping what regrowth trickles
// back. Waiting for exactly zero livelocked her: the patch's grow front
// deliberately refills the MOST-depleted cell, which is precisely the one she
// is standing on, so consumed stayed a hair above zero forever and a hen
// could park on one bare cell drinking the whole regrowth budget while her
// belly took minutes to fill.
const PECK_MIN_YIELD = PECK_AMOUNT * GRAZE_WASTE * 0.25
const PECK_DIP_ANGLE = 0.9

const SAD_CLUCK_INTERVAL = 6
const WANDER_INTERVAL = 3.5

const WALK_FREQ = 7
const LEG_SWING = 0.55
const BOB_AMOUNT = 0.05
const ROLL_AMOUNT = 0.06

const PAUSE_DURATION = 0.3
const SQUASH_DURATION = 0.5
const POP_DURATION = 0.2
const SETTLE_DURATION = 0.2
const EGG_SPAWN_AT = PAUSE_DURATION + SQUASH_DURATION
const LAY_DURATION = EGG_SPAWN_AT + POP_DURATION + SETTLE_DURATION

const EGG_POP_TIME = 0.25
const EGG_LIFETIME = 1.5
const EGG_FADE_TIME = 0.4

/** Patch radius per upgrade tier. Index === tier; the last one is `mature`. */
export const TIER_RADII = [4, 5.5, 7, 9]
export const MAX_TIER = TIER_RADII.length - 1

// A mature hen on a bare patch does not panic — she settles down and waits it
// out. Slower cadence than the starving cluck, and a peck at nothing now and
// then so the pose never freezes.
const WAIT_CLUCK_INTERVAL = 12
const WAIT_PECK_INTERVAL = 4.5
const WAIT_PECK_TIME = 0.5
const SIT_SETTLE_RATE = 3

/**
 * The sit pose, and the one number in it that is not a taste call.
 *
 * The rig lives inside a 1.8x inner group, so every offset here is nearly
 * doubled on screen — but the body may only sink 0.086 before it takes the hip
 * with it. The feathered thigh hangs off the BODY (models.js henThigh) while
 * the shank hangs off the LEG, and the two overlap by exactly that much at
 * rest; drop the body further and the hen sits with a gap where her hip was.
 * 0.08 spends the margin and keeps it, at 0.144 of visible world sink.
 *
 * The rest of the sit is bought with rotation instead, which costs no
 * clearance: the torso tips forward into a brood, the legs fold under, and a
 * mild spread flattens the silhouette against the dirt.
 */
const SIT_DROP = 0.08
const SIT_TILT = 0.14
const SIT_LEG_TUCK = 0.5
const SIT_SQUAT_Y = 0.94
const SIT_SQUAT_XZ = 1.06

const INK = 0x1a1208
const CREAM = 0xfff4d6
// Ring lives on the UNSCALED root, clear of the contact shadow (r 0.46) and of
// the feet, and above every ground decal she can stand on.
const RING_INNER = 0.62
const RING_OUTER = 0.78
const RING_Y = 0.09
const RING_DASHES = 12
const RING_DUTY = 0.58
const RING_SPIN = 0.35

export class Chicken {
  constructor(scene, world, coop) {
    this.scene = scene
    this.world = world
    this.coop = coop
    this.mesh = makeChicken()
    this.mesh.position.set(coop.door.x, 0, coop.door.z)
    scene.add(this.mesh)

    this._captureBaseTransforms()
    this._thoughtBubble = this._createThoughtBubble()
    this._thoughtBubble.visible = false
    this.mesh.add(this._thoughtBubble)

    this.patch = null
    this._state = 'idle'
    this.belly = 0
    this.path = []
    this.pathIndex = 0
    this._t = 0
    this.eatTimer = 0
    this.layTimer = 0
    this.wanderTimer = 0
    this.sadTimer = 0
    this.eggs = []
    this._eggSpawned = false

    this.tier = 0
    this.feeder = null
    this.waitPeckTimer = WAIT_PECK_INTERVAL
    this._waitPeck = 0
    this._nextEggPremium = true
    this._selected = false
    this._ring = null

    this.onEgg = null
  }

  get position() {
    return this.mesh.position
  }

  get state() {
    return this._state
  }

  /** Top tier: eats, lays and waits out a bare patch without ever being replanted. */
  get mature() {
    return this.tier === MAX_TIER
  }

  _captureBaseTransforms() {
    const p = this.mesh.userData.parts
    this._baseBodyY = p.body.position.y
    this._baseBodyRotX = p.body.rotation.x
    this._baseHeadRotX = p.head.rotation.x
    this._baseTailRotZ = p.tail.rotation.z
    this._baseWingLRotZ = p.wingL.rotation.z
    this._baseWingRRotZ = p.wingR.rotation.z
    this._baseBodyScale = p.body.scale.clone()
    this._baseGroupScale = this.mesh.scale.clone()
    // parts live inside the 1.8x-scaled inner rig; the bubble hangs off the
    // unscaled root, so clear the comb (~1.85 world units) explicitly
    this._bubbleBaseY = 2.35
  }

  assignPatch(patch) {
    this.patch = patch
    this._applyTierRadius()
    if (GRAZE_INTERRUPTIBLE.has(this._state)) this._enterWalkToPatch()
  }

  /** Upgrade tier 0..3: grows the patch she grazes. Tier 3 makes her mature. */
  setTier(n) {
    this.tier = Math.max(0, Math.min(MAX_TIER, Math.round(n) || 0))
    this._applyTierRadius()
    if (this._state === 'starving' && this.mature) this._enterWaiting()
    return this.tier
  }

  _applyTierRadius() {
    const r = TIER_RADII[this.tier]
    if (!this.patch || Math.abs(this.patch.radius - r) < 1e-3) return
    this.patch.setRadius(r)
  }

  /** Assign a hopper she falls back on when the patch is bare. */
  useFeeder(feeder) {
    this.feeder = feeder ?? null
    if (!this._feederReady()) return
    const hungryIdle = this._state === 'idle' && this.belly < 1
    if (hungryIdle || this._state === 'starving' || this._state === 'waiting') this._enterWalkToFeeder()
  }

  _feederReady() {
    return !!this.feeder && this.feeder.hasFeed?.() !== false
  }

  /** Subtle dashed ink ring underfoot — the "this one is selected" read. */
  setSelected(on) {
    this._selected = !!on
    if (this._selected && !this._ring) {
      this._ring = createSelectionRing()
      this.mesh.add(this._ring)
    }
    if (this._ring) this._ring.visible = this._selected
  }

  update(dt) {
    this._t += dt
    this._updateEggs(dt)
    if (this._selected && this._ring) this._animateRing()
    switch (this._state) {
      case 'idle': this._animateIdle(dt); break
      case 'walkToPatch': this._updateWalkToPatch(dt); break
      case 'eat': this._updateEat(dt); break
      case 'starving': this._updateStarving(dt); break
      case 'waiting': this._updateWaiting(dt); break
      case 'walkToFeeder': this._updateWalkToFeeder(dt); break
      case 'eatFeeder': this._updateEatFeeder(dt); break
      case 'walkHome': this._updateWalkHome(dt); break
      case 'layEgg': this._updateLayEgg(dt); break
    }
  }

  // --- state transitions -----------------------------------------------------

  _pathTo(target) {
    const from = { x: this.mesh.position.x, z: this.mesh.position.z }
    this.path = findPath(this.world, from, { x: target.x, z: target.z })
    this.pathIndex = 0
  }

  _enterWalkToPatch() {
    this._state = 'walkToPatch'
    this._thoughtBubble.visible = false
    this._standUp()
    const target = this.patch.bestSpot(this.position) ?? this.patch.center
    this._pathTo(target)
  }

  _enterStarving() {
    this._state = 'starving'
    this.wanderTimer = 0
    this.sadTimer = SAD_CLUCK_INTERVAL
    this._thoughtBubble.visible = true
  }

  /** Bare patch: feeder first, then the mature hen's patient sit, then panic. */
  _enterHungry() {
    if (this._feederReady()) this._enterWalkToFeeder()
    else if (this.mature) this._enterWaiting()
    else this._enterStarving()
  }

  _enterWaiting() {
    this._state = 'waiting'
    this._thoughtBubble.visible = false
    this.sadTimer = 0
    this.waitPeckTimer = WAIT_PECK_INTERVAL
    this._waitPeck = 0
    this.path = []
    this.pathIndex = 0
  }

  _enterWalkToFeeder() {
    this._state = 'walkToFeeder'
    this._thoughtBubble.visible = false
    this._standUp()
    this._pathTo({ x: this.feeder.position.x, z: this.feeder.position.z })
  }

  _enterWalkHome() {
    this._state = 'walkHome'
    this._thoughtBubble.visible = false
    this._standUp()
    this._pathTo(this.coop.door)
  }

  // --- per-state update --------------------------------------------------------

  _updateWalkToPatch(dt) {
    const arrived = this._followPath(dt, WALK_SPEED)
    this._animateWalk()
    if (arrived) {
      this._state = 'eat'
      this.eatTimer = 0
    }
  }

  _updateEat(dt) {
    this._animateEat()
    if (!this.patch) { this._state = 'idle'; return }
    this.eatTimer -= dt
    if (this.eatTimer > 0) return
    this.eatTimer = PECK_INTERVAL
    const p = this.mesh.position
    const consumed = this.patch.eatAt(p.x, p.z, PECK_AMOUNT * GRAZE_WASTE)
    this.belly = Math.min(1, this.belly + Math.max(0, consumed / GRAZE_WASTE))
    if (this.belly >= 1) { this._enterWalkHome(); return }
    if (consumed < PECK_MIN_YIELD) this._handleDepletedCell()
  }

  _handleDepletedCell() {
    const next = this.patch.bestSpot(this.position)
    if (next) {
      this._pathTo(next)
      this._state = 'walkToPatch'
    } else {
      this._enterHungry()
    }
  }

  _updateStarving(dt) {
    this._animateSad()
    this.sadTimer += dt
    if (this.sadTimer >= SAD_CLUCK_INTERVAL) {
      this.sadTimer = 0
      audio.cluckSad()
    }
    if (this.patch) {
      const spot = this.patch.bestSpot(this.position)
      if (spot) { this._enterWalkToPatch(); return }
    }
    this._wander(dt)
  }

  _wander(dt) {
    this.wanderTimer -= dt
    if (this.wanderTimer <= 0 && this.patch) {
      this.wanderTimer = WANDER_INTERVAL
      this._pathTo(randomPointInPatch(this.patch))
    }
    this._followPath(dt, SAD_SPEED)
  }

  _updateWaiting(dt) {
    this._animateSit(dt)
    this.sadTimer += dt
    if (this.sadTimer >= WAIT_CLUCK_INTERVAL) {
      this.sadTimer = 0
      audio.cluckSad()
    }
    if (this._feederReady()) { this._enterWalkToFeeder(); return }
    if (this.patch?.bestSpot(this.position)) this._enterWalkToPatch()
  }

  _updateWalkToFeeder(dt) {
    const arrived = this._followPath(dt, WALK_SPEED)
    this._animateWalk()
    if (arrived) {
      this._state = 'eatFeeder'
      this.eatTimer = 0
    }
  }

  _updateEatFeeder(dt) {
    this._animateEat()
    if (!this._feederReady()) { this._enterFeederFallback(); return }
    this.eatTimer -= dt
    if (this.eatTimer > 0) return
    this.eatTimer = PECK_INTERVAL
    // Bought feed, not grazed grass: the egg it produces is not premium.
    this._nextEggPremium = false
    this.belly = Math.min(1, this.belly + PECK_AMOUNT)
    if (this.belly >= 1) this._enterWalkHome()
  }

  /** Hopper ran dry mid-meal. The assignment stands — she comes back when it
   *  is refilled (the waiting state re-checks every frame). */
  _enterFeederFallback() {
    if (this.patch?.bestSpot(this.position)) this._enterWalkToPatch()
    else if (this.mature) this._enterWaiting()
    else if (this.patch) this._enterStarving()
    else this._state = 'idle'
  }

  _updateWalkHome(dt) {
    const arrived = this._followPath(dt, WALK_SPEED)
    this._animateWalk()
    if (arrived) {
      this._state = 'layEgg'
      this.layTimer = 0
      this._eggSpawned = false
    }
  }

  _updateLayEgg(dt) {
    this.layTimer += dt
    const t = this.layTimer
    this._animateLay(t)
    if (!this._eggSpawned && t >= EGG_SPAWN_AT) {
      this._eggSpawned = true
      this._spawnEgg()
      const premium = this._nextEggPremium
      this._nextEggPremium = true
      this.onEgg?.({ premium })
    }
    if (t >= LAY_DURATION) {
      this.mesh.scale.copy(this._baseGroupScale)
      this.belly = 0
      if (this.patch) this._enterWalkToPatch()
      else if (this._feederReady()) this._enterWalkToFeeder()
      else this._state = 'idle'
    }
  }

  // --- movement / facing ---------------------------------------------------

  _followPath(dt, speed) {
    if (!this.path || this.pathIndex >= this.path.length) return true
    const target = this.path[this.pathIndex]
    const p = this.mesh.position
    const dx = target.x - p.x
    const dz = target.z - p.z
    const dist = Math.hypot(dx, dz)
    if (dist < ARRIVE_EPS) {
      this.pathIndex++
      return this.pathIndex >= this.path.length
    }
    const step = Math.min(dist, speed * dt)
    p.x += (dx / dist) * step
    p.z += (dz / dist) * step
    this._faceDirection(dx, dz, dt)
    return false
  }

  _faceDirection(dx, dz, dt) {
    if (dx === 0 && dz === 0) return
    const desired = Math.atan2(dx, dz)
    const delta = wrapAngle(desired - this.mesh.rotation.y)
    const turn = Math.min(Math.abs(delta), TURN_RATE * dt) * Math.sign(delta)
    this.mesh.rotation.y += turn
  }

  // --- procedural animation --------------------------------------------------

  _animateIdle(dt) {
    const p = this.mesh.userData.parts
    p.legL.rotation.x = lerpTowards(p.legL.rotation.x, 0, dt * 6)
    p.legR.rotation.x = lerpTowards(p.legR.rotation.x, 0, dt * 6)
    p.body.position.y = this._baseBodyY + Math.sin(this._t * 2) * 0.02
    this.mesh.rotation.z = lerpTowards(this.mesh.rotation.z, 0, dt * 6)
  }

  _animateWalk() {
    const p = this.mesh.userData.parts
    const phase = this._t * WALK_FREQ
    const swing = Math.sin(phase) * LEG_SWING
    p.legL.rotation.x = swing
    p.legR.rotation.x = -swing
    p.body.position.y = this._baseBodyY + Math.abs(Math.sin(phase)) * BOB_AMOUNT
    this.mesh.rotation.z = Math.sin(phase) * ROLL_AMOUNT
  }

  _animateEat() {
    const p = this.mesh.userData.parts
    const phase = 1 - Math.max(0, this.eatTimer) / PECK_INTERVAL
    const dip = Math.sin(phase * Math.PI)
    p.head.rotation.x = this._baseHeadRotX + dip * PECK_DIP_ANGLE
    p.body.scale.y = this._baseBodyScale.y * (1 - dip * 0.12)
    p.body.scale.x = this._baseBodyScale.x * (1 + dip * 0.06)
    p.tail.rotation.z = this._baseTailRotZ + Math.sin(this._t * 12) * 0.25
  }

  _animateSad() {
    const p = this.mesh.userData.parts
    p.head.rotation.x = this._baseHeadRotX + 0.2 + Math.sin(this._t * 1.2) * 0.03
    p.legL.rotation.x = Math.sin(this._t * 1.5) * 0.15
    p.legR.rotation.x = -Math.sin(this._t * 1.5) * 0.15
    p.body.position.y = this._baseBodyY - 0.03
    this._thoughtBubble.position.set(0, this._bubbleBaseY + Math.sin(this._t * 1.5) * 0.05, 0)
  }

  /** Settles onto the dirt: body sinks and spreads, legs fold forward. */
  _animateSit(dt) {
    const p = this.mesh.userData.parts
    const k = dt * SIT_SETTLE_RATE
    p.body.position.y = lerpTowards(p.body.position.y, this._baseBodyY - SIT_DROP, k)
    p.body.rotation.x = lerpTowards(p.body.rotation.x, this._baseBodyRotX + SIT_TILT, k)
    p.body.scale.y = lerpTowards(p.body.scale.y, this._baseBodyScale.y * SIT_SQUAT_Y, k)
    p.body.scale.x = lerpTowards(p.body.scale.x, this._baseBodyScale.x * SIT_SQUAT_XZ, k)
    p.legL.rotation.x = lerpTowards(p.legL.rotation.x, SIT_LEG_TUCK, k)
    p.legR.rotation.x = lerpTowards(p.legR.rotation.x, SIT_LEG_TUCK, k)
    p.tail.rotation.z = this._baseTailRotZ + Math.sin(this._t * 1.1) * 0.08
    this.mesh.rotation.z = lerpTowards(this.mesh.rotation.z, 0, dt * 6)
    this._animateWaitPeck(dt)
  }

  /** A peck at nothing every few seconds — patience, not panic. */
  _animateWaitPeck(dt) {
    const p = this.mesh.userData.parts
    if (this._waitPeck > 0) {
      this._waitPeck = Math.max(0, this._waitPeck - dt)
      const dip = Math.sin((1 - this._waitPeck / WAIT_PECK_TIME) * Math.PI)
      p.head.rotation.x = this._baseHeadRotX + dip * PECK_DIP_ANGLE * 0.7
      return
    }
    p.head.rotation.x = lerpTowards(p.head.rotation.x, this._baseHeadRotX, dt * 4)
    this.waitPeckTimer -= dt
    if (this.waitPeckTimer > 0) return
    this.waitPeckTimer = WAIT_PECK_INTERVAL
    this._waitPeck = WAIT_PECK_TIME
  }

  /** Undo the sit — every other pose assumes the body is at rest height. */
  _standUp() {
    const p = this.mesh.userData.parts
    p.body.position.y = this._baseBodyY
    p.body.rotation.x = this._baseBodyRotX
    p.body.scale.copy(this._baseBodyScale)
    p.head.rotation.x = this._baseHeadRotX
    this._waitPeck = 0
  }

  _animateRing() {
    const s = 1 + Math.sin(this._t * 3.2) * 0.04
    this._ring.scale.set(s, 1, s)
    this._ring.rotation.y = this._t * RING_SPIN
  }

  _animateLay(t) {
    const p = this.mesh.userData.parts
    const popStart = PAUSE_DURATION + SQUASH_DURATION
    const settleStart = popStart + POP_DURATION
    let squashAmt = 0
    if (t >= PAUSE_DURATION && t < popStart) {
      squashAmt = (t - PAUSE_DURATION) / SQUASH_DURATION
    } else if (t >= popStart && t < settleStart) {
      squashAmt = 1 - (t - popStart) / POP_DURATION
    }
    const flapping = t >= PAUSE_DURATION && t < settleStart
    const flap = flapping ? Math.sin(t * 24) * 0.9 : 0
    p.wingL.rotation.z = this._baseWingLRotZ + flap
    p.wingR.rotation.z = this._baseWingRRotZ - flap
    const sy = 1 - squashAmt * 0.3
    const sxz = 1 + squashAmt * 0.15
    this.mesh.scale.set(this._baseGroupScale.x * sxz, this._baseGroupScale.y * sy, this._baseGroupScale.z * sxz)
  }

  // --- egg lifecycle -----------------------------------------------------------

  _spawnEgg() {
    const egg = makeEgg()
    egg.position.set(this.coop.door.x, 0, this.coop.door.z)
    egg.scale.setScalar(0.01)
    this.scene.add(egg)
    this.eggs.push({ mesh: egg, age: 0 })
  }

  _updateEggs(dt) {
    for (let i = this.eggs.length - 1; i >= 0; i--) {
      const e = this.eggs[i]
      e.age += dt
      this._animateEgg(e)
      if (e.age >= EGG_LIFETIME) {
        this.scene.remove(e.mesh)
        disposeObject(e.mesh)
        this.eggs.splice(i, 1)
      }
    }
  }

  _animateEgg(e) {
    const t = Math.min(1, e.age / EGG_POP_TIME)
    const pop = t < 1 ? 1 + 0.3 * Math.sin(t * Math.PI) : 1
    e.mesh.scale.setScalar(pop)
    const fadeStart = EGG_LIFETIME - EGG_FADE_TIME
    if (e.age > fadeStart) {
      const alpha = 1 - (e.age - fadeStart) / EGG_FADE_TIME
      setOpacity(e.mesh, Math.max(0, alpha))
    }
  }

  // --- thought bubble -----------------------------------------------------------

  _createThoughtBubble() {
    const material = new THREE.SpriteMaterial({
      map: createThoughtBubbleTexture(),
      transparent: true,
      depthTest: false,
    })
    const sprite = new THREE.Sprite(material)
    sprite.scale.set(0.7, 0.7, 1)
    sprite.renderOrder = 10
    return sprite
  }
}

// --- module-level helpers --------------------------------------------------------

/** States a fresh patch assignment may cut short. Laying is never interrupted. */
const GRAZE_INTERRUPTIBLE = new Set([
  'idle', 'starving', 'waiting', 'eat', 'walkToPatch', 'walkToFeeder', 'eatFeeder',
])

/**
 * Hand-drawn selection ring: a cream halo with a dashed ink line over it, lying
 * flat under the hen. It hangs off the UNSCALED root — the rig inside is 1.8x,
 * so a ring parented in there would be drawn at nearly twice the radius.
 * Marked `isOutline` so main.js's picker steps over it like any other ink.
 */
function createSelectionRing() {
  const group = new THREE.Group()
  group.position.y = RING_Y
  const halo = new THREE.Mesh(
    new THREE.RingGeometry(RING_INNER - 0.05, RING_OUTER + 0.05, 40),
    ringMaterial(CREAM, 0.3)
  )
  halo.rotation.x = -Math.PI / 2
  group.add(markAsInk(halo, 2))
  const arc = (Math.PI * 2 * RING_DUTY) / RING_DASHES
  const geo = new THREE.RingGeometry(RING_INNER, RING_OUTER, 5, 1, 0, arc)
  const mat = ringMaterial(INK, 0.92)
  for (let i = 0; i < RING_DASHES; i++) {
    const dash = new THREE.Mesh(geo, mat)
    // Euler XYZ: the z spin runs first, in the ring's own plane, then x lays it flat.
    dash.rotation.set(-Math.PI / 2, 0, (i / RING_DASHES) * Math.PI * 2)
    group.add(markAsInk(dash, 3))
  }
  return markAsInk(group, 3)
}

function ringMaterial(color, opacity) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -14,
    polygonOffsetUnits: -14,
  })
}

function markAsInk(object, renderOrder) {
  object.userData.isOutline = true
  object.userData.noOutline = true
  object.renderOrder = renderOrder
  object.castShadow = false
  object.receiveShadow = false
  return object
}

function wrapAngle(a) {
  return ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI
}

function lerpTowards(a, b, t) {
  return a + (b - a) * Math.min(1, Math.max(0, t))
}

function randomPointInPatch(patch) {
  const angle = Math.random() * Math.PI * 2
  const r = Math.random() * patch.radius * 0.8
  return { x: patch.center.x + Math.cos(angle) * r, z: patch.center.z + Math.sin(angle) * r }
}

function setOpacity(object, alpha) {
  object.traverse((child) => {
    if (!child.isMesh) return
    const materials = Array.isArray(child.material) ? child.material : [child.material]
    for (const m of materials) {
      m.transparent = true
      m.opacity = alpha
    }
  })
}

function disposeObject(object) {
  object.traverse((child) => {
    if (!child.isMesh) return
    child.geometry?.dispose()
    const materials = Array.isArray(child.material) ? child.material : [child.material]
    for (const m of materials) m?.dispose()
  })
}

function circle(ctx, x, y, r) {
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
}

function createThoughtBubbleTexture() {
  const size = 128
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#fff4d6'
  ctx.strokeStyle = '#1a1208'
  ctx.lineWidth = 4
  circle(ctx, 24, 104, 7)
  circle(ctx, 38, 86, 11)
  ctx.beginPath()
  ctx.ellipse(78, 46, 40, 32, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.strokeStyle = '#8a9a3a'
  ctx.lineWidth = 5
  ctx.beginPath()
  ctx.moveTo(78, 64)
  ctx.quadraticCurveTo(66, 40, 80, 20)
  ctx.stroke()
  const tex = new THREE.CanvasTexture(c)
  tex.needsUpdate = true
  return tex
}
