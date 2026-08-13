import * as THREE from 'three'
import { makeHawk } from '../art/models.js'
import * as audio from '../audio.js'

// Raid cadence. The grace period keeps the opening minutes about learning the
// egg loop, not about a bird the player has no tools against yet.
const FIRST_RAID_GRACE = 90
const RAID_GAP_MIN = 50
const RAID_GAP_MAX = 90

// Risk by distance to the NEAREST coop: the yard is safe, the lush far field
// is hawk country — that trade is the whole point of the mechanic.
const SAFE_DIST = 14
const RISK_SCALE = 30
const P_MAX = 0.9

const SWOOP_TIME = 2.8
const CRUISE_HEIGHT = 17
const SWOOP_REACH = 38
const HAWK_SCALE = 1.9

const FEATHER_COUNT = 10
const FEATHER_LIFE = 1.3

/** Chance a hawk strike lands at distance `d` from the nearest coop. */
export function hawkRisk(d) {
  return Math.min(P_MAX, Math.max(0, (d - SAFE_DIST) / RISK_SCALE))
}

/**
 * Hawk raids: on a timer, a hawk picks a hen and dives. A guardian zone
 * covering her always foils the strike; otherwise it lands with probability
 * hawkRisk(distance to nearest coop). The swoop is one quadratic bezier from
 * cruise height through the hen and back up, so every outcome — kill, foil,
 * miss — reads as the same bird making one committed pass.
 */
export class HawkRaids {
  constructor(scene, { targets, guardians, coops, onKill, onFoil, onMiss }) {
    this.scene = scene
    this.targets = targets
    this.guardians = guardians
    this.coops = coops
    this.onKill = onKill
    this.onFoil = onFoil
    this.onMiss = onMiss
    this.timer = FIRST_RAID_GRACE
    this.raid = null
    this._feathers = []
  }

  update(dt) {
    this._updateFeathers(dt)
    if (this.raid) return this._updateSwoop(dt)
    this.timer -= dt
    if (this.timer > 0) return
    this.timer = RAID_GAP_MIN + Math.random() * (RAID_GAP_MAX - RAID_GAP_MIN)
    this._beginRaid()
  }

  /** Test hook and the timer's action: dive at `hen` (or a random target). */
  forceRaid(hen = null) {
    this._beginRaid(hen)
  }

  _beginRaid(forced = null) {
    const hen = forced ?? this._pickTarget()
    if (!hen) return
    const guardian = this.guardians.find((g) => g.covers(hen.position.x, hen.position.z)) ?? null
    const outcome = guardian ? 'foil' : Math.random() < hawkRisk(this._coopDistance(hen)) ? 'kill' : 'miss'
    const dir = Math.random() * Math.PI * 2
    const over = { x: Math.cos(dir) * SWOOP_REACH, z: Math.sin(dir) * SWOOP_REACH }
    const mesh = makeHawk()
    mesh.scale.setScalar(HAWK_SCALE)
    this.scene.add(mesh)
    this.raid = { hen, guardian, outcome, over, mesh, t: 0, resolved: false }
    audio.screech()
  }

  _pickTarget() {
    const eligible = this.targets()
    if (!eligible.length) return null
    return eligible[Math.floor(Math.random() * eligible.length)]
  }

  _coopDistance(hen) {
    let best = Infinity
    for (const c of this.coops) {
      best = Math.min(best, Math.hypot(hen.position.x - c.position.x, hen.position.z - c.position.z))
    }
    return best
  }

  _updateSwoop(dt) {
    const raid = this.raid
    raid.t += dt / SWOOP_TIME
    if (raid.t >= 1) return this._endRaid()
    // A foiled hawk pulls up short: the dive aborts well off the ground, so
    // the guardian visibly denies the strike instead of the bird phasing
    // through. `nadir` is where the CURVE should bottom out at t=0.5; the
    // bezier control point that produces it is 2*nadir - cruise.
    const nadir = raid.outcome === 'foil' ? CRUISE_HEIGHT * 0.4 : 0.6
    const ctrlY = 2 * nadir - CRUISE_HEIGHT
    const hx = raid.hen.position.x
    const hz = raid.hen.position.z
    const p = raid.t
    const q = 1 - p
    // Quadratic bezier: entry point -> hen (low) -> exit point, per axis.
    const x = q * q * (hx + raid.over.x) + 2 * q * p * hx + p * p * (hx - raid.over.x)
    const z = q * q * (hz + raid.over.z) + 2 * q * p * hz + p * p * (hz - raid.over.z)
    const y = q * q * CRUISE_HEIGHT + 2 * q * p * ctrlY + p * p * CRUISE_HEIGHT
    raid.mesh.position.set(x, y, z)
    raid.mesh.rotation.y = Math.atan2(-raid.over.x, -raid.over.z)
    raid.mesh.rotation.x = (0.5 - p) * 1.1
    const flap = Math.sin(raid.t * Math.PI * 10) * 0.35
    raid.mesh.userData.parts.wingL.rotation.z = -flap
    raid.mesh.userData.parts.wingR.rotation.z = flap
    if (!raid.resolved && raid.t >= 0.5) this._resolve(raid)
  }

  _resolve(raid) {
    raid.resolved = true
    if (raid.outcome === 'kill') {
      this._featherBurst(raid.hen.position.x, raid.hen.position.z)
      this.onKill?.(raid.hen)
    } else if (raid.outcome === 'foil') {
      this.onFoil?.(raid.hen, raid.guardian)
    } else {
      this.onMiss?.(raid.hen)
    }
  }

  _endRaid() {
    this.scene.remove(this.raid.mesh)
    this.raid.mesh.traverse((o) => {
      o.geometry?.dispose()
      o.material?.dispose()
    })
    this.raid = null
  }

  /** Cartoon death: a puff of white feathers where the hen was. */
  _featherBurst(x, z) {
    for (let i = 0; i < FEATHER_COUNT; i++) {
      const geo = new THREE.PlaneGeometry(0.28, 0.14)
      const mat = new THREE.MeshBasicMaterial({
        color: 0xfff4d6,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.set(x, 0.7, z)
      mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0)
      const a = Math.random() * Math.PI * 2
      this.scene.add(mesh)
      this._feathers.push({
        mesh,
        vx: Math.cos(a) * (0.8 + Math.random() * 1.4),
        vz: Math.sin(a) * (0.8 + Math.random() * 1.4),
        vy: 1.6 + Math.random() * 1.8,
        spin: (Math.random() - 0.5) * 8,
        life: FEATHER_LIFE,
      })
    }
  }

  _updateFeathers(dt) {
    for (const f of this._feathers) {
      f.life -= dt
      f.vy -= 5.5 * dt // gravity, softened — feathers, not cannonballs
      f.mesh.position.x += f.vx * dt
      f.mesh.position.y = Math.max(0.05, f.mesh.position.y + f.vy * dt)
      f.mesh.position.z += f.vz * dt
      f.mesh.rotation.z += f.spin * dt
      f.mesh.material.opacity = Math.min(1, f.life / (FEATHER_LIFE * 0.5))
      if (f.life <= 0) {
        this.scene.remove(f.mesh)
        f.mesh.geometry.dispose()
        f.mesh.material.dispose()
      }
    }
    this._feathers = this._feathers.filter((f) => f.life > 0)
  }
}
