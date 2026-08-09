import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { World } from './world.js'
import { Patch } from './sim/patch.js'
import { Chicken } from './sim/chicken.js'
import { Economy } from './economy.js'
import { HUD } from './ui/hud.js'
import { makeCoop } from './art/models.js'
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
camera.position.set(-1, 9.5, 23)

const controls = new OrbitControls(camera, renderer.domElement)
controls.target.set(-1.5, 1.8, -7)
controls.enableDamping = true
controls.maxPolarAngle = Math.PI * 0.46
controls.minPolarAngle = Math.PI * 0.34
controls.minDistance = 10
controls.maxDistance = 90
controls.mouseButtons.LEFT = null // left click is for the game; pan/rotate on right/middle
controls.update()

const world = new World(scene)
const economy = new Economy()
const hud = new HUD()
economy.onChange = () => hud.setMoney(economy.money)
hud.setMoney(economy.money)

// --- coop ---
const coopMesh = makeCoop()
const coopPos = new THREE.Vector3(-6, 0, -2)
coopMesh.position.copy(coopPos)
coopMesh.rotation.y = Math.PI / 6
scene.add(coopMesh)
world.addObstacle(coopPos.x, coopPos.z, 2.2)
const doorLocal = coopMesh.userData.door?.position ?? new THREE.Vector3(0, 0, 1.6)
const doorWorld = coopMesh.localToWorld(doorLocal.clone())
const coop = { position: coopPos, door: { x: doorWorld.x, z: doorWorld.z } }

// --- the chicken ---
const chicken = new Chicken(scene, world, coop)
let patch = null

chicken.onEgg = () => {
  audio.bawk()
  setTimeout(() => {
    economy.sellEgg({ premium: true })
    audio.chaChing()
    const p = coopPos.clone().setY(3).project(camera)
    hud.floatDollar((p.x * 0.5 + 0.5) * innerWidth, (-p.y * 0.5 + 0.5) * innerHeight)
  }, 650)
}

// --- input: click grass to plant/move the patch ---
const ray = new THREE.Raycaster()
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

function groundPoint(e) {
  const ndc = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1)
  ray.setFromCamera(ndc, camera)
  const hit = new THREE.Vector3()
  return ray.ray.intersectPlane(groundPlane, hit) ? hit : null
}

let downAt = null
renderer.domElement.addEventListener('pointerdown', (e) => {
  audio.unlock()
  if (e.button === 0) downAt = { x: e.clientX, y: e.clientY }
})
renderer.domElement.addEventListener('pointerup', (e) => {
  if (e.button !== 0 || !downAt) return
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y)
  downAt = null
  if (moved > 6) return // drag, not a click
  const hit = groundPoint(e)
  if (!hit) return

  if (patch && Math.hypot(hit.x - patch.center.x, hit.z - patch.center.z) <= patch.radius) {
    hud.patchReadout({ screenX: e.clientX, screenY: e.clientY, fullness: patch.fullness() })
    return
  }
  if (!world.isWalkable(hit.x, hit.z)) {
    hud.toast('Can’t graze there!', { mood: 'sad' })
    return
  }
  if (!patch) {
    patch = new Patch(scene, world, { x: hit.x, z: hit.z }, 4)
    chicken.assignPatch(patch)
    hud.setHint('She’ll eat it bare — click fresh grass to move her patch.')
  } else {
    patch.moveTo({ x: hit.x, z: hit.z })
    chicken.assignPatch(patch)
  }
})

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
})

const clock = new THREE.Clock()
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05)
  controls.update()
  patch?.update(dt)
  chicken.update(dt)
  renderer.render(scene, camera)
})
