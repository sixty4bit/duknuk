import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { World } from './world.js'
import { Patch } from './sim/patch.js'
import { Chicken, TIER_RADII, MAX_TIER } from './sim/chicken.js'
import { Coop } from './sim/coop.js'
import { Feeder } from './sim/feeder.js'
import { Collector } from './sim/collector.js'
import { Economy } from './economy.js'
import { HUD } from './ui/hud.js'
import { Shop } from './ui/shop.js'
import * as audio from './audio.js'

const app = document.getElementById('app')
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setSize(innerWidth, innerHeight)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFShadowMap // crisp cartoon shadows, not photographic blur
renderer.toneMapping = THREE.NoToneMapping // ink shader outputs raw color; keep models on the same scale
app.appendChild(renderer.domElement)

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.5, 600)
camera.position.set(-3, 6.5, 20)

const controls = new OrbitControls(camera, renderer.domElement)
controls.target.set(1, 1.2, -8)
controls.enableDamping = true
controls.maxPolarAngle = Math.PI * 0.46
controls.minPolarAngle = Math.PI * 0.34
controls.minDistance = 10
controls.maxDistance = 140
// Left button is the game's. Camera: right-drag pans, middle-drag rotates,
// wheel zooms, arrow keys pan.
controls.mouseButtons.LEFT = null
controls.mouseButtons.MIDDLE = THREE.MOUSE.ROTATE
controls.mouseButtons.RIGHT = THREE.MOUSE.PAN
controls.listenToKeyEvents(window)
controls.keyPanSpeed = 24
controls.update()

const world = new World(scene)
const economy = new Economy()
const hud = new HUD()
const shop = new Shop()
economy.onChange = () => { hud.setMoney(economy.money); refreshShop() }

// --- entities --------------------------------------------------------------

const coops = []
const chickens = []
const feeders = []
const collectors = []
let selectedChicken = null
let selectedCoop = null

function coopOf(chicken) {
  return coops.find((c) => c.chickens.includes(chicken)) ?? coops[0]
}

function screenXY(x, y, z) {
  const p = new THREE.Vector3(x, y, z).project(camera)
  return { x: (p.x * 0.5 + 0.5) * innerWidth, y: (-p.y * 0.5 + 0.5) * innerHeight }
}

/** After the 2nd coop, eggs pile up at the coop until somebody collects. */
function handleEgg(chicken, { premium = true } = {}) {
  audio.bawk()
  const home = coopOf(chicken)
  setTimeout(() => {
    const value = economy.eggPrice * (premium ? 1 : 0.7)
    if (coops.length >= 2) {
      home.addProduct(Math.round(value))
    } else {
      economy.sellEgg({ premium })
      audio.chaChing()
      const s = screenXY(home.position.x, 3, home.position.z)
      hud.floatDollar(s.x, s.y)
    }
  }, 650)
}

function addChicken(coop, { tier = 0 } = {}) {
  const hen = new Chicken(scene, world, coop)
  hen.setTier(tier)
  hen.onEgg = (info) => handleEgg(hen, info)
  coop.chickens.push(hen)
  chickens.push(hen)
  registerPickRoot(hen.mesh, 'chicken', hen)
  return hen
}

function collectFrom(coop) {
  const value = coop.collect()
  if (!value) return
  economy.money += value
  economy.onChange?.()
  audio.chaChing()
  const s = screenXY(coop.position.x, 3, coop.position.z)
  hud.floatDollar(s.x, s.y)
}

function select(chicken, coop) {
  selectedChicken?.setSelected(false)
  selectedCoop?.setSelected(false)
  selectedChicken = chicken ?? null
  selectedCoop = coop ?? null
  selectedChicken?.setSelected(true)
  selectedCoop?.setSelected(true)
  refreshShop()
}

function refreshShop() {
  shop.setState({
    money: economy.money,
    selection: selectedChicken
      ? { type: 'chicken', tier: selectedChicken.tier }
      : selectedCoop ? { type: 'coop' } : null,
    tiers: { current: selectedChicken?.tier ?? 0, max: MAX_TIER },
  })
}

// --- picking ---------------------------------------------------------------

const ray = new THREE.Raycaster()
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

function groundPoint(e) {
  const ndc = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1)
  ray.setFromCamera(ndc, camera)
  const hit = new THREE.Vector3()
  return ray.ray.intersectPlane(groundPlane, hit) ? hit : null
}

const pickRoots = new Map() // entity root mesh -> { kind, obj }

function registerPickRoot(mesh, kind, obj) {
  pickRoots.set(mesh, { kind, obj })
}

/** Mesh-first picking: what did the cursor actually TOUCH? A tall coop's roof
 * projects far from its ground footprint, so ground-plane proximity mispicks —
 * the click ray lands behind the building. Ink shells resolve to their owner
 * by walking up the parent chain. Ground proximity remains only as a
 * near-miss fallback for the small hens. */
function pickEntity(e) {
  const ndc = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1)
  ray.setFromCamera(ndc, camera)
  for (const h of ray.intersectObjects([...pickRoots.keys()], true)) {
    if (h.object.userData.isOutline) continue
    let o = h.object
    while (o && !pickRoots.has(o)) o = o.parent
    if (o) return pickRoots.get(o)
  }
  const hit = groundPoint(e)
  if (!hit) return null
  let best = null
  for (const hen of chickens) {
    const d = Math.hypot(hit.x - hen.position.x, hit.z - hen.position.z)
    if (d < 1.4 && (!best || d < best.d)) best = { kind: 'chicken', obj: hen, d }
  }
  return best
}

function addCoop(pos) {
  const coop = new Coop(scene, world, pos)
  coops.push(coop)
  registerPickRoot(coop.mesh, 'coop', coop)
  return coop
}

// --- carry (RCT-style grab-and-place) --------------------------------------
// Press on a hen to pick her up; a footprint ring the size of her patch tier
// follows the cursor, colored by how much food that ground offers. Release to
// set her (and her patch) down there.

const carry = { hen: null, ring: null, valid: false }

function footprintColor(frac) {
  if (frac > 0.85) return 0x57b02c // lush — nearly all ground grazable
  if (frac > 0.5) return 0xd8b23a // thin — obstacles eat into it
  return 0xc8352b // bare/blocked
}

/** Fraction of the would-be patch disc that is actually grazable ground. */
function grazableFraction(x, z, radius) {
  let ok = 0, total = 0
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2
    const r = radius * (0.35 + 0.6 * ((i % 3) / 2))
    total++
    if (world.isWalkable(x + Math.cos(a) * r, z + Math.sin(a) * r)) ok++
  }
  return world.isWalkable(x, z) ? ok / total : 0
}

function makeFootprintRing(radius) {
  const geo = new THREE.RingGeometry(radius - 0.22, radius, 48)
  geo.rotateX(-Math.PI / 2)
  const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.75, depthWrite: false })
  const ring = new THREE.Mesh(geo, mat)
  ring.position.y = 0.06
  ring.renderOrder = 8
  return ring
}

function startCarry(hen) {
  carry.hen = hen
  carry.ring = makeFootprintRing(TIER_RADII[hen.tier])
  scene.add(carry.ring)
  select(hen, null)
  hud.setHint('Set her down on good grass — the ring shows what she’ll find there.')
}

function updateCarry(hit) {
  carry.hen.position.set(hit.x, 0.55, hit.z) // held aloft, FSM paused in the loop
  const frac = grazableFraction(hit.x, hit.z, TIER_RADII[carry.hen.tier])
  carry.valid = frac > 0
  carry.ring.material.color.setHex(footprintColor(frac))
  carry.ring.position.set(hit.x, 0.06, hit.z)
}

function endCarry(hit) {
  const hen = carry.hen
  scene.remove(carry.ring)
  carry.ring.geometry.dispose()
  carry.ring.material.dispose()
  carry.hen = null
  carry.ring = null
  const home = { x: coopOf(hen).door.x, z: coopOf(hen).door.z }
  const spot = carry.valid && hit ? hit : home
  hen.position.set(spot.x, 0, spot.z)
  if (!carry.valid || !hit) return hud.toast('No grass there — she flapped home.', { mood: 'sad' })
  if (hen.patch) hen.patch.moveTo({ x: spot.x, z: spot.z })
  else hen.patch = new Patch(scene, world, { x: spot.x, z: spot.z }, TIER_RADII[hen.tier])
  hen.assignPatch(hen.patch)
  hud.setHint('She’ll eat it bare — grab her to move her patch.')
}

// --- placement mode (coop / feeder) ----------------------------------------

const placing = { type: null, ring: null }

function beginPlacement(type) {
  cancelPlacement()
  placing.type = type
  placing.ring = makeFootprintRing(type === 'coop' ? 2.6 : 1.0)
  scene.add(placing.ring)
  hud.setHint(type === 'coop'
    ? 'Place the new coop — it needs elbow room from the others.'
    : 'Place the feeder near a hungry hen’s patch.')
}

function cancelPlacement() {
  if (!placing.ring) return
  scene.remove(placing.ring)
  placing.ring.geometry.dispose()
  placing.ring.material.dispose()
  placing.type = null
  placing.ring = null
}

function placementValid(hit) {
  if (!world.isWalkable(hit.x, hit.z)) return false
  if (placing.type !== 'coop') return true
  return coops.every((c) => Math.hypot(hit.x - c.position.x, hit.z - c.position.z) >= Coop.MIN_SPACING)
}

function confirmPlacement(hit) {
  const type = placing.type
  cancelPlacement()
  if (type === 'coop') {
    if (!economy.spend(Coop.COST)) return
    addCoop({ x: hit.x, z: hit.z })
    hud.toast(coops.length === 2 ? 'New coop! Eggs now wait at coops until you visit.' : 'New coop raised!')
  } else {
    if (!economy.spend(Feeder.COST)) return
    const feeder = new Feeder(scene, world, { x: hit.x, z: hit.z })
    feeders.push(feeder)
    if (selectedChicken) selectedChicken.useFeeder(feeder)
    hud.toast('Feeder stocked. Feeder eggs sell at 70%.')
  }
  refreshShop()
}

// --- shop actions ----------------------------------------------------------

shop.onAction = (id) => {
  const acts = {
    'buy-chicken': () => {
      const home = selectedCoop ?? coops.find((c) => c.chickens.length < Coop.CAPACITY)
      if (!home) return hud.toast('Every coop is full — build another.', { mood: 'sad' })
      if (!economy.spend(50)) return
      select(addChicken(home), null)
      hud.setHint('A new hen! Grab her and carry her to fresh grass.')
    },
    'upgrade-patch': () => {
      if (!selectedChicken || selectedChicken.tier >= MAX_TIER) return
      if (!economy.spend(40)) return
      selectedChicken.setTier(selectedChicken.tier + 1)
      hud.toast(selectedChicken.mature ? 'Fully mature — she runs herself now!' : 'Bigger patch!')
      refreshShop()
    },
    'buy-mature': () => {
      const home = selectedCoop ?? coops.find((c) => c.chickens.length < Coop.CAPACITY)
      if (!home) return hud.toast('Every coop is full — build another.', { mood: 'sad' })
      if (!economy.spend(200)) return
      select(addChicken(home, { tier: MAX_TIER }), null)
      hud.setHint('A mature hen — place her once and she runs herself.')
    },
    'buy-feeder': () => economy.canAfford(Feeder.COST) && beginPlacement('feeder'),
    'buy-coop': () => economy.canAfford(Coop.COST) && beginPlacement('coop'),
    'hire-collector': () => {
      if (coops.length < 2) return hud.toast('One coop collects itself — hire him when you spread out.', { mood: 'sad' })
      if (!economy.spend(Collector.COST)) return
      const guy = new Collector(scene, world, coops)
      guy.onCollect = (value) => {
        economy.money += value
        economy.onChange?.()
        audio.chaChing()
      }
      collectors.push(guy)
      hud.toast('Collector hired — he’ll walk the rounds.')
    },
  }
  acts[id]?.()
}

// --- input -----------------------------------------------------------------

let downAt = null
let downEntity = null

renderer.domElement.addEventListener('pointerdown', (e) => {
  audio.unlock()
  if (e.button !== 0) return
  downAt = { x: e.clientX, y: e.clientY, t: performance.now() }
  const hit = groundPoint(e)
  downEntity = hit && !placing.type ? pickEntity(e) : null
})

renderer.domElement.addEventListener('pointermove', (e) => {
  const hit = groundPoint(e)
  if (!hit) return
  if (placing.ring) {
    placing.ring.position.set(hit.x, 0.06, hit.z)
    placing.ring.material.color.setHex(placementValid(hit) ? 0x57b02c : 0xc8352b)
    return
  }
  if (carry.hen) return updateCarry(hit)
  // press-drag on a hen starts the carry once the cursor commits to moving
  if (downAt && downEntity?.kind === 'chicken' && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 8) {
    startCarry(downEntity.obj)
    updateCarry(hit)
  }
})

renderer.domElement.addEventListener('pointerup', (e) => {
  if (e.button !== 0 || !downAt) return
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y)
  const wasDown = downAt
  downAt = null
  const hit = groundPoint(e)

  if (carry.hen) return endCarry(hit)
  if (placing.type) {
    if (hit && placementValid(hit)) confirmPlacement(hit)
    else hud.toast('Not there.', { mood: 'sad' })
    return
  }
  if (moved > 6 || !hit) return // camera drag

  if (downEntity?.kind === 'chicken') return select(downEntity.obj, null)
  if (downEntity?.kind === 'coop') {
    select(null, downEntity.obj)
    collectFrom(downEntity.obj)
    return
  }

  // bare ground click: patch readout, or (re)plant the selected hen's patch
  const over = chickens.find((c) => c.patch &&
    Math.hypot(hit.x - c.patch.center.x, hit.z - c.patch.center.z) <= c.patch.radius)
  if (over) return hud.patchReadout({ screenX: e.clientX, screenY: e.clientY, fullness: over.patch.fullness() })
  if (!selectedChicken) return
  if (!world.isWalkable(hit.x, hit.z)) return hud.toast('Can’t graze there!', { mood: 'sad' })
  if (selectedChicken.patch) selectedChicken.patch.moveTo({ x: hit.x, z: hit.z })
  else selectedChicken.patch = new Patch(scene, world, { x: hit.x, z: hit.z }, TIER_RADII[selectedChicken.tier])
  selectedChicken.assignPatch(selectedChicken.patch)
  hud.setHint('She’ll eat it bare — grab her to move her, or click grass to move the patch.')
})

// --- world seed ------------------------------------------------------------

function seedStart() {
  const coop = addCoop({ x: -6, z: -2 })
  select(addChicken(coop), null)
  hud.setHint('Click the grass to plant a patch for your chicken')
}

/** Deterministic mid-game farm for screenshots and balancing (?demo=midgame). */
function seedMidgame() {
  economy.money = 800
  const spots = [{ x: -6, z: -2 }, { x: -24, z: 14 }, { x: 22, z: 16 }]
  spots.forEach((s) => addCoop(s))
  const layout = [
    { c: 0, tier: 3, px: -13, pz: 6, drain: 0.7 }, { c: 0, tier: 2, px: -2, pz: 8, drain: 0.35 },
    { c: 0, tier: 1, px: -12, pz: -8, drain: 0.1 }, { c: 1, tier: 3, px: -30, pz: 22, drain: 0.55 },
    { c: 1, tier: 2, px: -18, pz: 22, drain: 0.85 }, { c: 1, tier: 0, px: -28, pz: 6, drain: 0 },
    { c: 2, tier: 3, px: 28, pz: 10, drain: 0.45 }, { c: 2, tier: 1, px: 16, pz: 24, drain: 0.2 },
    { c: 2, tier: 2, px: 30, pz: 24, drain: 0.6 },
  ]
  layout.forEach((l) => {
    const hen = addChicken(coops[l.c], { tier: l.tier })
    const spot = nearestWalkable(l.px, l.pz)
    if (!spot) return
    hen.patch = new Patch(scene, world, spot, TIER_RADII[l.tier])
    drainPatch(hen.patch, l.drain)
    hen.position.set(spot.x, 0, spot.z) // stage her on her patch, not in a door pile
    hen.assignPatch(hen.patch)
  })
  feeders.push(new Feeder(scene, world, { x: -9, z: 2 }), new Feeder(scene, world, { x: 25, z: 20 }))
  const guy = new Collector(scene, world, coops)
  guy.onCollect = (v) => { economy.money += v; economy.onChange?.() }
  collectors.push(guy)
  coops[1].addProduct(36)
  coops[2].addProduct(24)
  economy.onChange?.()
  // wide establishing shot so all three coops and their grazing hens are on stage
  camera.position.set(-2, 26, 46)
  controls.target.set(0, 0, 2)
  controls.update()
}

/** Deterministic outward spiral to the nearest grazable ground. */
function nearestWalkable(x, z) {
  if (world.isWalkable(x, z)) return { x, z }
  for (let r = 1; r <= 8; r++) {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2
      const cx = x + Math.cos(a) * r
      const cz = z + Math.sin(a) * r
      if (world.isWalkable(cx, cz)) return { x: cx, z: cz }
    }
  }
  return null
}

/** Pre-drain a patch deterministically so demo patches show every stage. */
function drainPatch(patch, frac) {
  const r = patch.radius
  const bites = Math.floor(frac * r * r * 4)
  for (let i = 0; i < bites; i++) {
    const a = i * 2.399963 // golden angle: even, deterministic coverage
    const rr = r * Math.sqrt(((i * 7919) % 1000) / 1000) * frac
    patch.eatAt(patch.center.x + Math.cos(a) * rr, patch.center.z + Math.sin(a) * rr, 1)
  }
}

if (new URLSearchParams(location.search).get('demo') === 'midgame') seedMidgame()
else seedStart()
refreshShop()

addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return
  if (carry.hen) {
    carry.valid = false
    endCarry(null)
  }
  cancelPlacement()
  select(null, null)
})

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
})

window.__duk = { world, chickens, coops, collectors, economy, camera, screenXY, sel: () => ({ chicken: selectedChicken, coop: selectedCoop }) } // debug/testing handle

const clock = new THREE.Clock()
renderer.setAnimationLoop(() => {
  controls.update()
  // Fixed-step accumulator: on slow machines a frame can span several sim
  // steps — step repeatedly so game time tracks wall time instead of crawling.
  let acc = Math.min(clock.getDelta(), 0.25)
  while (acc > 1e-4) {
    const dt = Math.min(acc, 0.05)
    acc -= dt
    for (const hen of chickens) {
      hen.patch?.update(dt)
      if (hen !== carry.hen) hen.update(dt) // a carried hen dangles, FSM on hold
    }
    for (const guy of collectors) guy.update(dt)
  }
  renderer.render(scene, camera)
})
