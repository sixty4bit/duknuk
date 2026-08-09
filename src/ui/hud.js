// ui/hud.js — DOM HUD injected into #hud. Cartoon-styled: chunky rounded
// cream panels, thick dark-brown borders, slight rotation tilts, pop-in
// animations. All elements are decorative overlays (pointer-events: none).

const STYLE_ID = 'duk-hud-style'
const INK = '#1a1208'
const CREAM = '#fff4d6'
const BARN_RED = '#c8352b'

const STYLE_CSS = `
#hud { --duk-ink: ${INK}; --duk-cream: ${CREAM}; --duk-red: ${BARN_RED}; }
.duk-vignette {
  position: fixed; inset: 0; pointer-events: none;
  background:
    radial-gradient(ellipse 75% 70% at 50% 46%,
      rgba(26, 18, 8, 0) 60%,
      rgba(48, 30, 12, 0.16) 100%);
  mix-blend-mode: multiply;
}
.duk-glow {
  /* warm key-light direction, screen blend so it adds light rather than
     draining it — pairs with the weak multiply vignette above */
  position: fixed; inset: 0; pointer-events: none;
  background:
    radial-gradient(ellipse 60% 55% at 78% 8%,
      rgba(255, 226, 168, 0.16) 0%,
      rgba(255, 226, 168, 0) 60%);
  mix-blend-mode: screen;
}
.duk-panel {
  background: var(--duk-cream);
  border: 3px solid var(--duk-ink);
  border-radius: 16px;
  box-shadow: 4px 5px 0 var(--duk-ink);
  color: var(--duk-ink);
  font-weight: 700;
  font-family: inherit;
}
.duk-money {
  /* top-right, opposite the hint balloon's bottom-left corner — the two
     panels sit on a diagonal so the UI doesn't pile all its weight on the
     same side as the balloon while the barn/paddock mass sits on the right.
     Stroke and shadow are restated here (not left to .duk-panel's default)
     so this chip is drawn with the same pen as the 3D scene: border-width
     matches INK_WEIGHT.HERO (toon.js, 4.5 css px), color is the shared INK
     constant, and the shadow is a hard fixed-pixel offset with zero blur —
     no soft drop-shadow, that's what dates a chip to modern mobile UI. */
  position: fixed; top: 16px; right: 16px;
  display: flex; align-items: center; gap: 10px;
  padding: 8px 8px 8px 18px;
  flex-direction: row-reverse;
  transform: rotate(1deg);
  animation: duk-squash-in 0.4s ease-out;
  border-width: 4.5px;
  box-shadow: 5px 6px 0 var(--duk-ink);
}
.duk-coin {
  width: 40px; height: 40px; border-radius: 50%;
  background: #ffd94a; border: 4px solid var(--duk-ink);
  display: flex; align-items: center; justify-content: center;
  font-size: 22px; line-height: 1; flex: none;
  box-shadow: inset 0 -3px 0 rgba(0,0,0,0.15);
  font-family: 'Arial Black', Impact, 'Anton', 'Arial Narrow Bold', Haettenschweiler, sans-serif;
}
.duk-coin.duk-bounce { animation: duk-coin-bounce 0.45s ease-out; }
.duk-money-amount {
  /* heavy slab display face — hand-inked title-card lettering, not a
     geometric app sans. 'Arial Black' leads the stack because headless
     screenshot renderers frequently lack Impact/Anton; Arial Black ships
     with (or is substituted by a Liberation-family equivalent on) every
     major desktop platform, so the heavy face survives font fallback. */
  font-family: 'Arial Black', Impact, 'Anton', 'Arial Narrow Bold', Haettenschweiler, sans-serif;
  text-transform: uppercase;
  font-size: 26px; letter-spacing: 0.8px;
}
.duk-money-amount.duk-bounce { animation: duk-text-bounce 0.35s ease-out; }
.duk-hint {
  /* bottom-left; the money chip has moved to top-right so the two panels
     balance the composition on a diagonal instead of both hugging the left
     edge against the barn/paddock mass on the right. Inset well past the
     portrait/tail overhang (-20px/-17px) so both clear the viewport edge
     with margin instead of clipping. */
  position: fixed; bottom: 24px; left: 40px;
  transform: rotate(-0.8deg);
  padding: 10px 26px 10px 34px; font-size: 15px; text-align: left;
  max-width: 40vw;
  /* stroke matches INK_WEIGHT.HERO (toon.js, 4.5 css px) and the shared INK
     color constant, and the shadow is restated as a hard fixed-pixel offset
     with zero blur, so this chip is inked by the same pen as the money chip
     and the 3D scene instead of reading as blurred modern mobile chrome */
  border-width: 4.5px;
  box-shadow: 5px 6px 0 var(--duk-ink);
  animation: duk-squash-in 0.4s ease-out;
}
.duk-hint::before {
  /* speech-bubble tail, ink outline — points left-down at the chicken
     avatar badge pinned to the panel's top-left corner, so the line reads
     as spoken by the chicken instead of by empty grass off to the right */
  content: '';
  position: absolute; top: 4px; left: -17px;
  width: 0; height: 0;
  border-top: 4px solid transparent;
  border-bottom: 11px solid transparent;
  border-right: 17px solid var(--duk-ink);
}
.duk-hint::after {
  /* tail cream fill, inset over the ink triangle */
  content: '';
  position: absolute; top: 6px; left: -12px;
  width: 0; height: 0;
  border-top: 3px solid transparent;
  border-bottom: 8px solid transparent;
  border-right: 12px solid var(--duk-cream);
}
.duk-hint-portrait {
  /* hangs outside the panel like a badge pinned to the corner, so it never
     overlaps the hint text */
  position: absolute; top: -20px; left: -20px;
  width: 34px; height: 34px; border-radius: 50%;
  background: #fff8ea; border: 3px solid var(--duk-ink);
  box-shadow: 2px 2px 0 var(--duk-ink);
  transform: rotate(-6deg);
}
.duk-hint-portrait::before {
  /* comb */
  content: '';
  position: absolute; top: -6px; left: 50%;
  transform: translateX(-50%);
  width: 12px; height: 8px;
  background: var(--duk-red); border: 2px solid var(--duk-ink);
  border-radius: 50% 50% 4px 4px;
}
.duk-hint-portrait::after {
  /* beak */
  content: '';
  position: absolute; bottom: 3px; left: 50%;
  transform: translateX(-50%);
  width: 0; height: 0;
  border-left: 5px solid transparent;
  border-right: 5px solid transparent;
  border-top: 6px solid #ffb238;
}
.duk-hint-text {
  position: relative;
  /* heavy slab display face — hand-inked title-card lettering. 'Arial
     Black' leads the stack so the heavy face survives fallback on renderers
     without Impact/Anton (see .duk-money-amount). */
  font-family: 'Arial Black', Impact, 'Anton', 'Arial Narrow Bold', Haettenschweiler, sans-serif;
  text-transform: uppercase;
  letter-spacing: 0.4px;
}
.duk-toasts {
  position: fixed; top: 16px; right: 16px; z-index: 10;
  display: flex; flex-direction: column; gap: 10px; align-items: flex-end;
}
.duk-toast {
  padding: 10px 18px; font-size: 15px; max-width: 280px;
  transform: rotate(1.2deg);
  animation: duk-pop-in 0.3s ease-out;
}
.duk-toast.duk-sad {
  background: #dfe6ea; border-color: #46545c; color: #3a464d;
}
.duk-toast.duk-out { animation: duk-pop-out 0.3s ease-in forwards; }
.duk-float-dollar {
  position: fixed; font-size: 28px; font-weight: 900; color: #2e8b2e;
  text-shadow: 2px 2px 0 var(--duk-ink);
  transform: translate(-50%, -50%);
  animation: duk-float-up 1.2s ease-out forwards;
  pointer-events: none;
}
.duk-patch-readout {
  position: fixed; padding: 6px 12px; font-size: 13px;
  transform: translate(-50%, -140%) rotate(-1deg);
  display: flex; flex-direction: column; gap: 4px; align-items: stretch;
  min-width: 100px;
  animation: duk-pop-in 0.2s ease-out;
}
.duk-meter-track {
  width: 100%; height: 8px; border-radius: 5px;
  border: 2px solid var(--duk-ink); background: #00000022; overflow: hidden;
}
.duk-meter-fill { height: 100%; border-radius: 3px; }

@keyframes duk-pop-in {
  0% { opacity: 0; transform: scale(0.4) rotate(-8deg); }
  60% { opacity: 1; transform: scale(1.08) rotate(2deg); }
  100% { opacity: 1; transform: scale(1) rotate(var(--duk-rot, 0deg)); }
}
@keyframes duk-squash-in {
  /* squash-and-stretch entrance: non-uniform scale overshoot, never a flat
     fade — the one thing a cartoon never does. */
  0% { opacity: 0; transform: scale(0.3, 1.5) rotate(-9deg); }
  35% { opacity: 1; transform: scale(1.3, 0.7) rotate(3deg); }
  55% { transform: scale(0.88, 1.15) rotate(-2deg); }
  75% { transform: scale(1.06, 0.95) rotate(1deg); }
  100% { transform: scale(1, 1) rotate(var(--duk-rot, 0deg)); }
}
@keyframes duk-pop-out {
  0% { opacity: 1; transform: scale(1) rotate(1.2deg); }
  100% { opacity: 0; transform: scale(0.5) rotate(6deg); }
}
@keyframes duk-coin-bounce {
  0% { transform: scale(1) translateY(0); }
  35% { transform: scale(1.3, 0.7) translateY(6px); }
  60% { transform: scale(0.85, 1.2) translateY(-10px); }
  100% { transform: scale(1) translateY(0); }
}
@keyframes duk-text-bounce {
  0% { transform: scale(1); }
  40% { transform: scale(1.35); }
  100% { transform: scale(1); }
}
@keyframes duk-float-up {
  0% { opacity: 1; transform: translate(-50%, -50%) scale(0.7); }
  20% { transform: translate(-50%, -60%) scale(1.15); }
  100% { opacity: 0; transform: translate(-50%, calc(-50% - 80px)) scale(1); }
}
`

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = STYLE_CSS
  document.head.appendChild(style)
}

function meterColor(fullness) {
  if (fullness > 0.6) return '#4caf3c'
  if (fullness > 0.25) return '#e0b428'
  return '#8a5a2e'
}

export class HUD {
  constructor() {
    injectStyles()
    this.root = document.getElementById('hud')
    this._moneyValue = 0
    this._patchHideTimer = null
    this._tickRaf = null
    this._buildVignette()
    this._buildMoney()
    this._buildHint()
    this._buildToastLayer()
  }

  _buildVignette() {
    const vignette = document.createElement('div')
    vignette.className = 'duk-vignette'
    this.root.appendChild(vignette)
    const glow = document.createElement('div')
    glow.className = 'duk-glow'
    this.root.appendChild(glow)
  }

  _buildMoney() {
    const wrap = document.createElement('div')
    wrap.className = 'duk-money duk-panel'
    wrap.innerHTML = `
      <div class="duk-coin">$</div>
      <div class="duk-money-amount">0</div>
    `
    this.root.appendChild(wrap)
    this.coinEl = wrap.querySelector('.duk-coin')
    this.moneyEl = wrap.querySelector('.duk-money-amount')
  }

  _buildHint() {
    this.hintEl = document.createElement('div')
    this.hintEl.className = 'duk-hint duk-panel'
    this.hintEl.innerHTML = `
      <div class="duk-hint-portrait"></div>
      <span class="duk-hint-text">Click the grass to plant a patch for your chicken</span>
    `
    this.root.appendChild(this.hintEl)
    this.hintTextEl = this.hintEl.querySelector('.duk-hint-text')
  }

  _buildToastLayer() {
    this.toastLayer = document.createElement('div')
    this.toastLayer.className = 'duk-toasts'
    this.root.appendChild(this.toastLayer)
  }

  setMoney(n) {
    const from = this._moneyValue
    this._moneyValue = n
    this._tickTo(from, n)
    this._bounce(this.moneyEl)
    this._bounce(this.coinEl)
  }

  _tickTo(from, to) {
    cancelAnimationFrame(this._tickRaf)
    const duration = 300
    const start = performance.now()
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration)
      const value = Math.round(from + (to - from) * t)
      this.moneyEl.textContent = `$${value}`
      if (t < 1) this._tickRaf = requestAnimationFrame(step)
    }
    this._tickRaf = requestAnimationFrame(step)
  }

  _bounce(el) {
    el.classList.remove('duk-bounce')
    // force reflow so the animation restarts even if it's already mid-run
    void el.offsetWidth
    el.classList.add('duk-bounce')
  }

  toast(text, { mood = 'fun' } = {}) {
    const el = document.createElement('div')
    el.className = `duk-toast duk-panel${mood === 'sad' ? ' duk-sad' : ''}`
    el.textContent = text
    this.toastLayer.appendChild(el)
    setTimeout(() => {
      el.classList.add('duk-out')
      el.addEventListener('animationend', () => el.remove(), { once: true })
    }, 4000)
  }

  floatDollar(screenX, screenY) {
    const el = document.createElement('div')
    el.className = 'duk-float-dollar'
    el.textContent = '$'
    el.style.left = `${screenX}px`
    el.style.top = `${screenY}px`
    this.root.appendChild(el)
    el.addEventListener('animationend', () => el.remove(), { once: true })
  }

  patchReadout({ screenX, screenY, fullness }) {
    if (!this.patchEl) this._buildPatchReadout()
    const pct = Math.round(Math.max(0, Math.min(1, fullness)) * 100)
    this.patchEl.style.left = `${screenX}px`
    this.patchEl.style.top = `${screenY}px`
    this.patchEl.querySelector('.duk-meter-fill').style.width = `${pct}%`
    this.patchEl.querySelector('.duk-meter-fill').style.background = meterColor(fullness)
    this.patchEl.querySelector('.duk-patch-label').textContent = `${pct}% grazed`
    this.patchEl.style.display = 'flex'
    clearTimeout(this._patchHideTimer)
    this._patchHideTimer = setTimeout(() => {
      if (this.patchEl) this.patchEl.style.display = 'none'
    }, 2000)
  }

  _buildPatchReadout() {
    this.patchEl = document.createElement('div')
    this.patchEl.className = 'duk-patch-readout duk-panel'
    this.patchEl.innerHTML = `
      <span class="duk-patch-label">0% grazed</span>
      <div class="duk-meter-track"><div class="duk-meter-fill"></div></div>
    `
    this.root.appendChild(this.patchEl)
  }

  setHint(text) {
    this.hintTextEl.textContent = text
  }
}
