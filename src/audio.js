// audio.js — WebAudio-only sound effects, all synthesized, no assets.
// Shared AudioContext, lazily created on the first user gesture (call
// unlock() from any pointerdown) to satisfy browser autoplay policy.

const MASTER_GAIN = 0.25

let ctx = null
let master = null

function getCtx() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)()
    master = ctx.createGain()
    master.gain.value = MASTER_GAIN
    master.connect(ctx.destination)
  }
  return ctx
}

export function unlock() {
  const c = getCtx()
  if (c.state === 'suspended') c.resume()
}

// --- helpers -----------------------------------------------------------

function noiseBuffer(c, duration) {
  const n = Math.max(1, Math.floor(c.sampleRate * duration))
  const buf = c.createBuffer(1, n, c.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1
  return buf
}

function envGain(c, at, peak, attack, decay) {
  const g = c.createGain()
  g.gain.setValueAtTime(0, at)
  g.gain.linearRampToValueAtTime(peak, at + attack)
  g.gain.exponentialRampToValueAtTime(0.001, at + attack + decay)
  return g
}

function noiseBurst(c, at, duration, peak, filterFreq) {
  const src = c.createBufferSource()
  src.buffer = noiseBuffer(c, duration)
  const filter = c.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = filterFreq
  const g = envGain(c, at, peak, 0.005, duration)
  src.connect(filter)
  filter.connect(g)
  g.connect(master)
  src.start(at)
  src.stop(at + duration + 0.05)
}

function tone(c, { at, dur, type, freq, glide = [], vibrato, peak = 1, decay }) {
  const osc = c.createOscillator()
  osc.type = type
  osc.frequency.setValueAtTime(freq, at)
  for (const [t, f] of glide) osc.frequency.linearRampToValueAtTime(f, at + t)
  if (vibrato) {
    const lfo = c.createOscillator()
    const lfoGain = c.createGain()
    lfo.frequency.value = vibrato.rate
    lfoGain.gain.value = vibrato.depth
    lfo.connect(lfoGain)
    lfoGain.connect(osc.frequency)
    lfo.start(at)
    lfo.stop(at + dur + 0.1)
  }
  const g = envGain(c, at, peak, Math.min(0.02, dur * 0.15), decay ?? dur)
  osc.connect(g)
  g.connect(master)
  osc.start(at)
  osc.stop(at + dur + 0.1)
  return osc
}

// --- effects -------------------------------------------------------------

// Comedic two-syllable hen squawk: "ba-GAWK". Short low "ba" chirp, then a
// longer pitch-bent "GAWK" (sawtooth, 300 -> 550 -> 900 Hz) with vibrato and
// a noise transient at the attack of each syllable. ~0.6s total.
export function bawk() {
  const c = getCtx()
  const t0 = c.currentTime

  tone(c, { at: t0, dur: 0.1, type: 'sawtooth', freq: 260, glide: [[0.08, 340]], peak: 0.9, decay: 0.12 })
  noiseBurst(c, t0, 0.05, 0.5, 900)

  const t1 = t0 + 0.13
  tone(c, {
    at: t1,
    dur: 0.42,
    type: 'sawtooth',
    freq: 300,
    glide: [
      [0.12, 550],
      [0.3, 900],
      [0.42, 700],
    ],
    vibrato: { rate: 32, depth: 40 },
    peak: 1,
    decay: 0.45,
  })
  noiseBurst(c, t1, 0.06, 0.6, 1400)
}

// Cash register: two bright metallic dings (~2.5kHz, short decay) followed
// by a low drawer thunk.
export function chaChing() {
  const c = getCtx()
  const t0 = c.currentTime
  ding(c, t0)
  ding(c, t0 + 0.11)
  thunk(c, t0 + 0.24)
}

function ding(c, at) {
  // Metallic timbre: a few inharmonic partials decaying fast together.
  const partials = [2500, 3300, 4100]
  for (const f of partials) {
    tone(c, { at, dur: 0.18, type: 'triangle', freq: f, peak: 0.5 / partials.length, decay: 0.16 })
  }
}

function thunk(c, at) {
  const osc = c.createOscillator()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(160, at)
  osc.frequency.exponentialRampToValueAtTime(60, at + 0.12)
  const g = envGain(c, at, 0.8, 0.005, 0.15)
  osc.connect(g)
  g.connect(master)
  osc.start(at)
  osc.stop(at + 0.2)
  noiseBurst(c, at, 0.08, 0.3, 200)
}

// Starving signal: low descending 3-note cluck.
export function cluckSad() {
  const c = getCtx()
  const t0 = c.currentTime
  const notes = [220, 180, 140]
  notes.forEach((freq, i) => {
    const at = t0 + i * 0.16
    tone(c, { at, dur: 0.14, type: 'square', freq, glide: [[0.1, freq * 0.85]], peak: 0.4, decay: 0.16 })
  })
}
