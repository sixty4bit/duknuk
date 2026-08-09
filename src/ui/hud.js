// ui/hud.js — DOM HUD injected into #hud. Cartoon-styled: chunky rounded
// cream panels, thick dark-brown borders, slight rotation tilts, pop-in
// animations. All elements are decorative overlays (pointer-events: none).

const STYLE_ID = 'duk-hud-style'
const INK = '#1a1208'
const CREAM = '#fff4d6'
const BARN_RED = '#c8352b'

const STYLE_CSS = `
#hud { --duk-ink: ${INK}; --duk-cream: ${CREAM}; --duk-red: ${BARN_RED}; }
.duk-panel {
  background: var(--duk-cream);
  border: 4px solid var(--duk-ink);
  border-radius: 16px;
  box-shadow: 3px 4px 0 var(--duk-ink);
  color: var(--duk-ink);
  font-weight: 700;
  font-family: inherit;
}
.duk-money {
  position: fixed; top: 16px; left: 16px;
  display: flex; align-items: center; gap: 10px;
  padding: 8px 18px 8px 8px;
  transform: rotate(-1deg);
  animation: duk-pop-in 0.35s ease-out;
}
.duk-coin {
  width: 40px; height: 40px; border-radius: 50%;
  background: #ffd94a; border: 4px solid var(--duk-ink);
  display: flex; align-items: center; justify-content: center;
  font-size: 22px; line-height: 1; flex: none;
  box-shadow: inset 0 -3px 0 rgba(0,0,0,0.15);
}
.duk-coin.duk-bounce { animation: duk-coin-bounce 0.45s ease-out; }
.duk-money-amount { font-size: 26px; letter-spacing: 0.5px; }
.duk-money-amount.duk-bounce { animation: duk-text-bounce 0.35s ease-out; }
.duk-hint {
  position: fixed; bottom: 22px; left: 50%;
  transform: translateX(-50%) rotate(0.6deg);
  padding: 8px 20px; font-size: 15px; text-align: center;
  max-width: 70vw;
  animation: duk-pop-in 0.35s ease-out;
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
    this._buildMoney()
    this._buildHint()
    this._buildToastLayer()
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
    this.hintEl.textContent = 'Click the grass to plant a patch for your chicken'
    this.root.appendChild(this.hintEl)
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
    this.hintEl.textContent = text
  }
}
