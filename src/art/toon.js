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

/**
 * Default ink weight in CSS pixels at devicePixelRatio 1.
 *
 * 2.2px across a 1600px frame is a hairline: it reads as an edge shader, not as
 * a drawn line. 3.4 is the midfield weight a pen would lay down.
 */
const INK_PIXELS = 3.4

/**
 * Hand-inked animation does NOT use one line weight for everything — that is
 * the single loudest tell that a frame was rendered rather than drawn. The pen
 * gets heavier for the subject the shot is about, lighter for the forms behind
 * it, and thins toward nothing at the horizon. Pass these as `pixels` so the
 * hierarchy is stated in one place instead of scattered as magic numbers.
 */
export const INK_WEIGHT = {
  /** The shot's subject and the buildings it acts against. */
  HERO: 4.5,
  /** Midfield props: fences, hay, livestock, crops. The frame's baseline. */
  PROP: INK_PIXELS,
  /** Drawn ground shapes — a road in a cartoon is a shape, not a texture. */
  DECAL: 3.0,
  /** Treeline and horizon landmarks. Fade toward 0 with distance. */
  FAR: 2.0,
}

/** Ink never eats more than this share of an object's radius (tiny/far props). */
const INK_MAX_FRACTION = 0.32

/**
 * Darkest ramp step — the multiplier the dark cel plane keeps.
 *
 * At 0.55 the dark plane was only 45% down from the lit one, and world.js's
 * ambient lifted both, so on screen the two planes differed by roughly 15%:
 * grass, shaded barn wall and cast shadow all sat on one mid tone and the frame
 * had no value structure at all. Golden-age flats separate lit and shadow
 * closer to 2:1. Against the 0.45 ambient this lands near 1.75:1 — a real break
 * that still reads as a colour rather than a hole, because SHADOW_WARM carries
 * the dark end toward ochre instead of grey.
 */
const SHADOW_FLOOR = 0.4
/**
 * Characters run the 3-step ramp and are the smallest read in the frame. Their
 * local colours are already mid-value (cream hen, pink pig), so their dark
 * plane sits a hair above the architecture's or the animal goes to mud at
 * viewing size. Still far below the old flat 0.55.
 */
const CHARACTER_STEPS = 3
const CHARACTER_SHADOW_FLOOR = 0.44
/** Hue shift at the dark end: shadows go warm instead of just going down. */
const SHADOW_WARM = [1.16, 0.97, 0.79]

/** Ramps are cached by step count, so the floor can key off it directly. */
const shadowFloorFor = (steps) =>
  steps === CHARACTER_STEPS ? CHARACTER_SHADOW_FLOOR : SHADOW_FLOOR

const gradientMaps = new Map()
// Keyed by source geometry so hulls die with the model they belong to (eggs are
// spawned and disposed constantly).
const hullGeometries = new WeakMap()
const inkStyles = new Map()

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
const q = (v) => Math.round(v * 1e4)

// ------------------------------------------------------------------ toon ramp

/** RGB multiplier for ramp position `t` (0 = shadow plane, 1 = lit plane). */
function rampStep(t, floor) {
  const value = floor + (1 - floor) * t
  const warmth = 1 - t
  return SHADOW_WARM.map((w) => clamp01(value * (1 + (w - 1) * warmth)))
}

/** Cached N-step toon ramp as a 1-D RGBA DataTexture with NearestFilter. */
function gradientMap(steps) {
  const n = Math.max(2, Math.min(8, Math.round(steps)))
  const cached = gradientMaps.get(n)
  if (cached) return cached
  const data = new Uint8Array(n * 4)
  const floor = shadowFloorFor(n)
  for (let i = 0; i < n; i++) {
    const [r, g, b] = rampStep(i / (n - 1), floor)
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
function inkMaterial(color, pixels, flat) {
  const style = inkStyle(color, pixels)
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog])
  uniforms.uResolution = inkResolution
  uniforms.uPixels = style.uPixels
  uniforms.uColor = style.uColor
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: INK_VERT,
    fragmentShader: INK_FRAG,
    // A flat decal has no back: BackSide would cull its shell entirely.
    side: flat ? THREE.DoubleSide : THREE.BackSide,
    fog: true,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  })
}

// ------------------------------------------------------------------ ink hulls

const vkey = (pos, i) => `${q(pos.getX(i))},${q(pos.getY(i))},${q(pos.getZ(i))}`

/** Accumulate a direction onto a welded vertex key. */
function accumulate(map, key, x, y, z) {
  let acc = map.get(key)
  if (!acc) map.set(key, (acc = [0, 0, 0]))
  acc[0] += x
  acc[1] += y
  acc[2] += z
}

/** Average normals of coincident vertices so hard edges inflate without splitting. */
function weldedNormals(geometry) {
  const pos = geometry.attributes.position
  const nrm = geometry.attributes.normal
  const welded = new Map()
  for (let i = 0; i < pos.count; i++) {
    accumulate(welded, vkey(pos, i), nrm.getX(i), nrm.getY(i), nrm.getZ(i))
  }
  return welded
}

/** Triangles as [i, j, k] index triples, indexed or not. */
function triangles(geometry) {
  const index = geometry.index
  const count = index ? index.count : geometry.attributes.position.count
  const tris = []
  for (let i = 0; i < count; i += 3) {
    if (index) tris.push([index.getX(i), index.getX(i + 1), index.getX(i + 2)])
    else tris.push([i, i + 1, i + 2])
  }
  return tris
}

const EDGES = [[0, 1, 2], [1, 2, 0], [2, 0, 1]]

/** Undirected edge table keyed on welded endpoints; also sums the plane normal. */
function collectEdges(pos, tris, normalOut) {
  const [a, b, c, ac] = [0, 0, 0, 0].map(() => new THREE.Vector3())
  const edges = new Map()
  for (const t of tris) {
    a.fromBufferAttribute(pos, t[0])
    b.fromBufferAttribute(pos, t[1])
    c.fromBufferAttribute(pos, t[2])
    normalOut.add(b.sub(a).cross(ac.subVectors(c, a)))
    for (const [i, j, k] of EDGES) {
      const [ka, kb] = [vkey(pos, t[i]), vkey(pos, t[j])]
      const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
      const seen = edges.get(key)
      if (seen) seen.count++
      else edges.set(key, { count: 1, a: t[i], b: t[j], c: t[k] })
    }
  }
  return edges
}

/** Outward in-plane direction at each boundary vertex of a flat mesh. */
function boundaryDirections(geometry) {
  const pos = geometry.attributes.position
  const plane = new THREE.Vector3()
  const edges = collectEdges(pos, triangles(geometry), plane)
  const dirs = new Map()
  if (plane.lengthSq() < 1e-12) return dirs
  plane.normalize()
  const [a, b, c, dir, mid] = [0, 0, 0, 0, 0].map(() => new THREE.Vector3())
  for (const e of edges.values()) {
    if (e.count !== 1) continue
    a.fromBufferAttribute(pos, e.a)
    b.fromBufferAttribute(pos, e.b)
    c.fromBufferAttribute(pos, e.c)
    dir.subVectors(b, a).cross(plane).normalize()
    if (dir.dot(c.sub(mid.addVectors(a, b).multiplyScalar(0.5))) > 0) dir.negate()
    for (const i of [e.a, e.b]) accumulate(dirs, vkey(pos, i), dir.x, dir.y, dir.z)
  }
  return dirs
}

/**
 * Clone of `geometry` carrying vec4 aInk = (expansion direction, local cap).
 *
 * `flat` swaps welded face normals for outward *boundary* directions. A ground
 * decal's normals all point at the sky, so the usual hull inflates straight up
 * and draws nothing; a road in a cartoon is a drawn shape, and this is what
 * gives it its edge. Interior vertices get a zero direction and don't move.
 */
function buildHull(geometry, maxLocalWidth, flat) {
  const geo = geometry.clone()
  if (!geo.attributes.normal) geo.computeVertexNormals()
  const pos = geo.attributes.position
  const dirs = flat ? boundaryDirections(geo) : weldedNormals(geo)
  const ink = new Float32Array(pos.count * 4)
  const n = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    const acc = dirs.get(vkey(pos, i)) || [0, 0, 0]
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

function hullFor(geometry, maxLocalWidth, flat) {
  let variants = hullGeometries.get(geometry)
  if (!variants) hullGeometries.set(geometry, (variants = new Map()))
  const key = `${q(maxLocalWidth)}|${flat ? 1 : 0}`
  let hull = variants.get(key)
  if (!hull) variants.set(key, (hull = buildHull(geometry, maxLocalWidth, flat)))
  return hull
}

/** Widest world-space extent the ink may reach on this object. */
function inkWidthCap(object3d) {
  const sphere = new THREE.Box3().setFromObject(object3d).getBoundingSphere(new THREE.Sphere())
  return Number.isFinite(sphere.radius) ? sphere.radius * INK_MAX_FRACTION : 0
}

function outlineFor(mesh, color, pixels, maxWorldWidth, flat) {
  const scale = mesh.getWorldScale(new THREE.Vector3())
  const s = Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z)) || 1
  const hull = hullFor(mesh.geometry, maxWorldWidth / s, flat)
  const shell = new THREE.Mesh(hull, inkMaterial(color, pixels, flat))
  shell.name = 'outline'
  shell.userData.isOutline = true
  // Kept so setInkWeight() can re-key the shared uniform without a re-walk.
  shell.userData.inkColor = color
  shell.castShadow = false
  shell.receiveShadow = false
  // Draws before its source mesh, so a coincident decal wins the equal-depth
  // test over the shell's interior and only the boundary ring survives.
  shell.renderOrder = -1
  return shell
}

/**
 * Bold ink outline on every Mesh descendant, at a constant on-screen width.
 * Outlines are parented to their source mesh, so they follow procedural
 * animation for free. Meshes with `userData.noOutline` (pupils, nostrils) skip.
 * @param {THREE.Object3D} object3d
 * @param {{color?: number, thickness?: number, pixels?: number, flat?: boolean}} [opts]
 *   `thickness` is legacy world-space weight and is ignored — ink weight is a
 *   global constant now. `pixels` places the object in the weight hierarchy;
 *   use `INK_WEIGHT`. `flat: true` inks a ground decal (path, patch disc) along
 *   its boundary instead of its face normals — see buildHull.
 * @returns {THREE.Object3D} the same object, for chaining.
 */
export function addOutline(
  object3d,
  { color = INK, thickness = 0.035, pixels = INK_PIXELS, flat = false } = {}
) {
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
  for (const mesh of targets) mesh.add(outlineFor(mesh, color, pixels, maxWorldWidth, flat))
  return object3d
}

/**
 * Re-weight an already-inked object's line, in place.
 *
 * The lever for atmospheric perspective: place a treeline, then thin its ink
 * toward 0 with distance so the horizon recedes instead of sitting at the same
 * pen weight as the barn. `pixels <= 0.05` hides the shells outright rather
 * than drawing a sub-pixel shimmer. Cheap — it only swaps a shared uniform
 * object reference, so call it at placement time, not per frame.
 * @param {THREE.Object3D} object3d an object already passed through addOutline.
 * @param {number} pixels new on-screen weight.
 * @returns {THREE.Object3D} the same object, for chaining.
 */
export function setInkWeight(object3d, pixels) {
  object3d.traverse((o) => {
    if (!o.userData?.isOutline || !o.material?.uniforms) return
    if (pixels <= 0.05) {
      o.visible = false
      return
    }
    o.visible = true
    o.material.uniforms.uPixels = inkStyle(o.userData.inkColor ?? INK, pixels).uPixels
  })
  return object3d
}
