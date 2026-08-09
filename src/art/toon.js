import * as THREE from 'three'

// Golden-age theatrical-cartoon look: flat saturated toon ramps + bold ink
// outlines of CONSTANT SCREEN WIDTH. No textures, no assets, no dependencies.
//
// Ink is drawn by an inverted hull whose expansion happens in the vertex
// shader, in clip space, scaled by w. That makes the shell project to the same
// pixel width whatever the object's size or distance — the single property that
// separates hand-inked animation from cel-shaded 3D. Callers no longer pass a
// world-space thickness; there is one global constant.

const INK = 0x1a1208

/** Ink weight in CSS pixels at devicePixelRatio 1. One number, whole frame. */
const INK_PIXELS = 2.2
/** Ink never eats more than this share of an object's radius (tiny/far props). */
const INK_MAX_FRACTION = 0.32

/** Darkest ramp step. High floor keeps the dark plane a colour, not a hole. */
const SHADOW_FLOOR = 0.55
/** Hue shift at the dark end: shadows go warm instead of just going down. */
const SHADOW_WARM = [1.16, 0.97, 0.79]

const gradientMaps = new Map()
// Keyed by source geometry so hulls die with the model they belong to (eggs are
// spawned and disposed constantly).
const hullGeometries = new WeakMap()
const inkStyles = new Map()

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
const q = (v) => Math.round(v * 1e4)

// ------------------------------------------------------------------ toon ramp

/** RGB multiplier for ramp position `t` (0 = shadow plane, 1 = lit plane). */
function rampStep(t) {
  const value = SHADOW_FLOOR + (1 - SHADOW_FLOOR) * t
  const warmth = 1 - t
  return SHADOW_WARM.map((w) => clamp01(value * (1 + (w - 1) * warmth)))
}

/** Cached N-step toon ramp as a 1-D RGBA DataTexture with NearestFilter. */
function gradientMap(steps) {
  const n = Math.max(2, Math.min(8, Math.round(steps)))
  const cached = gradientMaps.get(n)
  if (cached) return cached
  const data = new Uint8Array(n * 4)
  for (let i = 0; i < n; i++) {
    const [r, g, b] = rampStep(i / (n - 1))
    data.set([Math.round(255 * r), Math.round(255 * g), Math.round(255 * b), 255], i * 4)
  }
  const tex = new THREE.DataTexture(data, n, 1, THREE.RGBAFormat)
  tex.minFilter = THREE.NearestFilter
  tex.magFilter = THREE.NearestFilter
  tex.generateMipmaps = false
  tex.unpackAlignment = 1
  tex.needsUpdate = true
  gradientMaps.set(n, tex)
  return tex
}

// three samples only the red channel of a gradient map, which can never shift
// hue. Widen it to RGB so the shadow plane can be a warm colour break.
const GREY_RAMP = 'return vec3( texture2D( gradientMap, coord ).r );'
const RGB_RAMP = 'return texture2D( gradientMap, coord ).rgb;'

function useColouredRamp(shader) {
  if (shader.fragmentShader.includes(GREY_RAMP)) {
    shader.fragmentShader = shader.fragmentShader.replace(GREY_RAMP, RGB_RAMP)
  }
}

const rampCacheKey = () => 'duknuk-rgb-ramp'

/**
 * Flat cel-shaded material.
 * @param {number|string|THREE.Color} color
 * @param {{steps?: number}} [opts] extra keys pass straight to MeshToonMaterial.
 *   Use `steps: 2` for architecture (one lit plane, one dark plane) and
 *   `steps: 3` for characters.
 */
export function toonMaterial(color, { steps = 4, ...rest } = {}) {
  const mat = new THREE.MeshToonMaterial({ color, gradientMap: gradientMap(steps), ...rest })
  mat.onBeforeCompile = useColouredRamp
  mat.customProgramCacheKey = rampCacheKey
  return mat
}

// ----------------------------------------------------------------- ink shader

// Shared by every ink material, so one write updates the whole frame.
const inkResolution = { value: new THREE.Vector2(1280, 720) }

function syncInkResolution() {
  if (typeof window === 'undefined') return
  inkResolution.value.set(
    Math.max(1, window.innerWidth || 1280),
    Math.max(1, window.innerHeight || 720)
  )
}
syncInkResolution()
if (typeof window !== 'undefined') window.addEventListener('resize', syncInkResolution)

const INK_VERT = /* glsl */ `
uniform vec2 uResolution;
uniform float uPixels;
attribute vec4 aInk;
#include <fog_pars_vertex>

void main() {
  vec4 mv = modelViewMatrix * vec4( position, 1.0 );
  vec4 clip = projectionMatrix * mv;
  vec3 n = aInk.xyz;

  if ( dot( n, n ) > 1e-8 ) {
    // vec4(dir, 0) drops the projection's translation column: pure direction.
    vec3 nClip = ( projectionMatrix * vec4( normalize( normalMatrix * n ), 0.0 ) ).xyz;
    vec2 nPix = vec2( nClip.x * uResolution.x, nClip.y * uResolution.y );
    float lenPix = length( nPix );
    if ( lenPix > 1e-6 ) {
      float px = uPixels;
      if ( aInk.w > 0.0 ) {
        // World units covered by one pixel at this depth (perspective or ortho).
        float perPixel = ( 2.0 * clip.w ) / ( uResolution.y * projectionMatrix[1][1] );
        float scale = length( ( modelViewMatrix * vec4( n, 0.0 ) ).xyz );
        px = min( px, ( aInk.w * scale ) / max( perPixel, 1e-6 ) );
      }
      clip.xy += ( nPix / lenPix ) * ( 2.0 * px / uResolution ) * clip.w;
    }
  }

  gl_Position = clip;
  #ifdef USE_FOG
    vFogDepth = - mv.z;
  #endif
}
`

const INK_FRAG = /* glsl */ `
uniform vec3 uColor;
#include <fog_pars_fragment>

void main() {
  gl_FragColor = vec4( uColor, 1.0 );
  #include <fog_fragment>
  #include <colorspace_fragment>
}
`

/** Colour + weight uniform objects, shared by reference across every shell. */
function inkStyle(color, pixels) {
  const key = `${new THREE.Color(color).getHexString()}|${q(pixels)}`
  let style = inkStyles.get(key)
  if (!style) {
    style = { uColor: { value: new THREE.Color(color) }, uPixels: { value: pixels } }
    inkStyles.set(key, style)
  }
  return style
}

/**
 * Each shell owns its material — callers dispose models by traversing and
 * disposing every material they find, and a shared one would take the whole
 * frame's ink with it. Only the uniform objects are shared, so a single write
 * to `inkResolution` still re-weights the entire scene.
 */
function inkMaterial(color, pixels) {
  const style = inkStyle(color, pixels)
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog])
  uniforms.uResolution = inkResolution
  uniforms.uPixels = style.uPixels
  uniforms.uColor = style.uColor
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: INK_VERT,
    fragmentShader: INK_FRAG,
    side: THREE.BackSide,
    fog: true,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  })
}

// ------------------------------------------------------------------ ink hulls

/** Average normals of coincident vertices so hard edges inflate without splitting. */
function weldedNormals(geometry) {
  const pos = geometry.attributes.position
  const nrm = geometry.attributes.normal
  const welded = new Map()
  for (let i = 0; i < pos.count; i++) {
    const key = `${q(pos.getX(i))},${q(pos.getY(i))},${q(pos.getZ(i))}`
    let acc = welded.get(key)
    if (!acc) welded.set(key, (acc = [0, 0, 0]))
    acc[0] += nrm.getX(i)
    acc[1] += nrm.getY(i)
    acc[2] += nrm.getZ(i)
  }
  return { pos, welded }
}

/** Clone of `geometry` carrying vec4 aInk = (welded normal, local width cap). */
function buildHull(geometry, maxLocalWidth) {
  const geo = geometry.clone()
  if (!geo.attributes.normal) geo.computeVertexNormals()
  const { pos, welded } = weldedNormals(geo)
  const ink = new Float32Array(pos.count * 4)
  const n = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    const acc = welded.get(`${q(pos.getX(i))},${q(pos.getY(i))},${q(pos.getZ(i))}`)
    n.set(acc[0], acc[1], acc[2])
    if (n.lengthSq() > 1e-10) n.normalize()
    else n.set(0, 0, 0)
    ink.set([n.x, n.y, n.z, maxLocalWidth], i * 4)
  }
  geo.deleteAttribute('normal')
  geo.deleteAttribute('uv')
  geo.setAttribute('aInk', new THREE.BufferAttribute(ink, 4))
  geo.computeBoundingSphere()
  return geo
}

function hullFor(geometry, maxLocalWidth) {
  let variants = hullGeometries.get(geometry)
  if (!variants) hullGeometries.set(geometry, (variants = new Map()))
  const key = q(maxLocalWidth)
  let hull = variants.get(key)
  if (!hull) variants.set(key, (hull = buildHull(geometry, maxLocalWidth)))
  return hull
}

/** Widest world-space extent the ink may reach on this object. */
function inkWidthCap(object3d) {
  const sphere = new THREE.Box3().setFromObject(object3d).getBoundingSphere(new THREE.Sphere())
  return Number.isFinite(sphere.radius) ? sphere.radius * INK_MAX_FRACTION : 0
}

function outlineFor(mesh, color, pixels, maxWorldWidth) {
  const scale = mesh.getWorldScale(new THREE.Vector3())
  const s = Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z)) || 1
  const shell = new THREE.Mesh(hullFor(mesh.geometry, maxWorldWidth / s), inkMaterial(color, pixels))
  shell.name = 'outline'
  shell.userData.isOutline = true
  shell.castShadow = false
  shell.receiveShadow = false
  shell.renderOrder = -1
  return shell
}

/**
 * Bold ink outline on every Mesh descendant, at a constant on-screen width.
 * Outlines are parented to their source mesh, so they follow procedural
 * animation for free. Meshes with `userData.noOutline` (pupils, nostrils) skip.
 * @param {THREE.Object3D} object3d
 * @param {{color?: number, thickness?: number, pixels?: number}} [opts]
 *   `thickness` is legacy world-space weight and is ignored — ink weight is a
 *   global constant now. `pixels` nudges it for a subject that must read first.
 * @returns {THREE.Object3D} the same object, for chaining.
 */
export function addOutline(object3d, { color = INK, thickness = 0.035, pixels = INK_PIXELS } = {}) {
  void thickness // signature kept; world-space weight is what we are fixing.
  object3d.updateWorldMatrix(true, true)
  const targets = []
  object3d.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return
    if (o.userData.isOutline || o.userData.noOutline || o.userData.hasOutline) return
    o.userData.hasOutline = true
    targets.push(o)
  })
  const maxWorldWidth = inkWidthCap(object3d)
  for (const mesh of targets) mesh.add(outlineFor(mesh, color, pixels, maxWorldWidth))
  return object3d
}
