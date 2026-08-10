// ui/shop.js — DOM shop injected into #hud. Bottom-right vertical stack of
// cartoon buttons in the same painted-title-card language as ui/hud.js:
// cream panels, thick ink borders, hard offset shadows (no blur), Arial
// Black lettering, squash-and-stretch pop animations. Unlike the rest of
// #hud (pointer-events: none), this stack is interactive.

const STYLE_ID = 'duk-shop-style'
const INK = '#1a1208'
const CREAM = '#fdf3dc'
const BARN_RED = '#c8352b'

// Tier ceiling mirrors chicken.js's `.tier` contract (0..3, tier 3 = mature).
// `setState`'s `tiers` argument may override the ceiling (`tiers.max`) and/or
// supply the selected chicken's current tier (`tiers.current`) when the
// caller doesn't stash it directly on `selection.tier` — both shapes are
// accepted defensively since main.js owns the exact call site.
const MAX_TIER = 3

const BUTTONS = [
  { id: 'buy-chicken', label: 'Chicken', price: 50, icon: 'chicken' },
  { id: 'upgrade-patch', label: 'Upgrade Patch', price: 40, icon: 'upgrade', needsChicken: true },
  { id: 'buy-mature', label: 'Mature Hen', price: 200, icon: 'mature' },
  { id: 'buy-feeder', label: 'Feeder', price: 100, icon: 'feeder' },
  { id: 'buy-coop', label: 'Coop', price: 250, icon: 'coop' },
  { id: 'hire-collector', label: 'Collector', price: 300, icon: 'collector' },
]

const STYLE_CSS = `
#hud { --duk-ink: ${INK}; --duk-cream: ${CREAM}; --duk-red: ${BARN_RED}; }
.duk-shop {
  position: fixed; right: 16px; bottom: 16px; z-index: 6;
  display: flex; flex-direction: column-reverse; gap: 10px;
  pointer-events: none;
}
.duk-shop-btn {
  pointer-events: auto;
  display: flex; align-items: center; gap: 10px;
  padding: 7px 14px 7px 7px;
  background: var(--duk-cream);
  border: 4.5px solid var(--duk-ink);
  border-radius: 16px 12px 18px 10px;
  box-shadow: 5px 6px 0 var(--duk-ink);
  color: var(--duk-ink);
  font-family: inherit;
  cursor: pointer;
  transform: rotate(0.6deg);
  transition: transform 0.08s ease-out;
}
.duk-shop-btn:nth-child(even) { transform: rotate(-0.6deg); }
.duk-shop-btn:hover:not(:disabled) { transform: scale(1.04) rotate(0deg); }
.duk-shop-btn:active:not(:disabled) { transform: scale(0.96) rotate(0deg); }
.duk-shop-btn:disabled {
  /* A painted title card is opaque — no translucent chrome that lets the 3D
     world show through. Unaffordable state is a flat desaturated card fill
     with a muted ink border, expressed by overriding the shared ink/cream/
     red tokens locally so every icon technique (background fill, var-driven
     border, triangle border-color) mutes together without a grayscale
     filter — the icons are hand-built shapes, so they just get a muted
     variant fill instead of a photographic desaturation effect. */
  cursor: not-allowed;
  --duk-ink: #7d7158;
  --duk-cream: #e3dcc9;
  --duk-red: #b98f76;
  background: var(--duk-cream);
  border-color: var(--duk-ink);
  box-shadow: 5px 6px 0 var(--duk-ink);
}
.duk-shop-btn:disabled .duk-shop-icon--mature {
  background: #cfc6ad;
}
.duk-shop-btn:disabled .duk-shop-icon--mature::before,
.duk-shop-btn:disabled .duk-shop-icon--mature::after {
  background: var(--duk-ink);
}
.duk-shop-btn:disabled .duk-shop-icon--collector::before {
  background: #cbbf9e;
}
.duk-shop-btn:disabled .duk-shop-icon--collector::after {
  background: #d8cead;
}
.duk-shop-btn:disabled .duk-shop-icon--chicken::after {
  border-top-color: #cbbf9e;
}
.duk-shop-btn.duk-bounce { animation: duk-shop-bounce 0.4s ease-out; }
.duk-shop-info {
  display: flex; flex-direction: column; align-items: flex-start;
  min-width: 74px;
}
.duk-shop-label {
  font-family: 'Arial Black', Impact, 'Anton', 'Arial Narrow Bold', Haettenschweiler, sans-serif;
  text-transform: uppercase;
  font-size: 12px; letter-spacing: 0.3px; line-height: 1.15;
}
.duk-shop-tier {
  font-size: 10px; font-weight: 700; opacity: 0.75;
}
.duk-shop-tier:empty { display: none; }
.duk-shop-price {
  font-family: 'Arial Black', Impact, 'Anton', 'Arial Narrow Bold', Haettenschweiler, sans-serif;
  font-size: 14px; margin-left: auto; padding-left: 6px;
}
.duk-shop-btn:disabled .duk-shop-price { color: #b3261e; }

.duk-shop-icon {
  flex: none; width: 38px; height: 38px; position: relative;
  border: 3.5px solid var(--duk-ink);
  border-radius: 48% 52% 53% 47% / 52% 47% 53% 48%;
  box-shadow: 2px 2px 0 var(--duk-ink);
  background: var(--duk-cream);
}
/* buy-chicken: cream head badge, red comb, orange beak — same vocabulary
   as hud.js's .duk-hint-portrait, scaled down to icon size. */
.duk-shop-icon--chicken::before {
  content: ''; position: absolute; top: -7px; left: 50%;
  transform: translateX(-50%);
  width: 13px; height: 9px;
  background: var(--duk-red); border: 2px solid var(--duk-ink);
  border-radius: 50% 50% 4px 4px;
}
.duk-shop-icon--chicken::after {
  content: ''; position: absolute; bottom: 2px; left: 50%;
  transform: translateX(-50%);
  width: 0; height: 0;
  border-left: 5px solid transparent; border-right: 5px solid transparent;
  border-top: 6px solid #ffb238;
}
/* upgrade-patch: grass-green badge with a bold up chevron. */
.duk-shop-icon--upgrade { background: #bfe6a0; }
.duk-shop-icon--upgrade::before {
  content: ''; position: absolute; top: 10px; left: 50%;
  width: 16px; height: 16px;
  border-top: 3.5px solid var(--duk-ink); border-left: 3.5px solid var(--duk-ink);
  transform: translate(-50%, 0) rotate(45deg);
}
/* buy-mature: gold badge (matches hud.js's coin fill) with a sparkle. */
.duk-shop-icon--mature { background: linear-gradient(180deg, #ffe27a 0 50%, #f0a92e 50% 100%); }
.duk-shop-icon--mature::before,
.duk-shop-icon--mature::after {
  content: ''; position: absolute; top: 50%; left: 50%;
  width: 20px; height: 4px; background: var(--duk-ink);
  transform: translate(-50%, -50%) rotate(45deg);
}
.duk-shop-icon--mature::after { transform: translate(-50%, -50%) rotate(-45deg); }
/* buy-feeder: hopper trapezoid, cream + red per feeder's real-world colors. */
.duk-shop-icon--feeder { background: var(--duk-cream); }
.duk-shop-icon--feeder::before {
  content: ''; position: absolute; top: 6px; left: 50%;
  transform: translateX(-50%);
  width: 20px; height: 16px;
  background: var(--duk-red); border: 2px solid var(--duk-ink);
  clip-path: polygon(15% 0, 85% 0, 65% 100%, 35% 100%);
}
/* buy-coop: tiny red roof over a cream body, echoing makeCoop(). */
.duk-shop-icon--coop { background: var(--duk-cream); }
.duk-shop-icon--coop::before {
  content: ''; position: absolute; top: 12px; left: 50%;
  transform: translateX(-50%);
  width: 22px; height: 10px;
  background: var(--duk-cream); border: 2px solid var(--duk-ink); border-top: none;
}
.duk-shop-icon--coop::after {
  content: ''; position: absolute; top: 4px; left: 50%;
  transform: translateX(-50%);
  width: 0; height: 0;
  border-left: 13px solid transparent; border-right: 13px solid transparent;
  border-bottom: 10px solid var(--duk-red);
  filter: drop-shadow(0 2px 0 var(--duk-ink));
}
/* hire-collector: straw hat — wide tan brim, small crown. */
.duk-shop-icon--collector { background: var(--duk-cream); }
.duk-shop-icon--collector::before {
  content: ''; position: absolute; top: 18px; left: 50%;
  transform: translateX(-50%);
  width: 28px; height: 8px; border-radius: 50%;
  background: #e0b04a; border: 2px solid var(--duk-ink);
}
.duk-shop-icon--collector::after {
  content: ''; position: absolute; top: 7px; left: 50%;
  transform: translateX(-50%);
  width: 14px; height: 12px; border-radius: 50% 50% 20% 20%;
  background: #e8bf63; border: 2px solid var(--duk-ink); border-bottom: none;
}

@keyframes duk-shop-bounce {
  0% { transform: scale(1); }
  30% { transform: scale(1.22, 0.82); }
  55% { transform: scale(0.9, 1.14); }
  100% { transform: scale(1); }
}
`

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = STYLE_CSS
  document.head.appendChild(style)
}

export class Shop {
  constructor() {
    injectStyles()
    this.root = document.getElementById('hud')
    this.onAction = null
    this._money = 0
    this._buildButtons()
  }

  _buildButtons() {
    this.shopEl = document.createElement('div')
    this.shopEl.className = 'duk-shop'
    this.buttons = {}
    for (const cfg of BUTTONS) {
      const btn = this._buildButton(cfg)
      this.shopEl.appendChild(btn)
      this.buttons[cfg.id] = btn
    }
    this.root.appendChild(this.shopEl)
  }

  _buildButton(cfg) {
    const btn = document.createElement('button')
    btn.className = 'duk-shop-btn'
    btn.dataset.action = cfg.id
    btn.innerHTML = `
      <span class="duk-shop-icon duk-shop-icon--${cfg.icon}"></span>
      <span class="duk-shop-info">
        <span class="duk-shop-label">${cfg.label}</span>
        <span class="duk-shop-tier"></span>
      </span>
      <span class="duk-shop-price">$${cfg.price}</span>
    `
    btn.addEventListener('click', () => {
      this._bounce(btn)
      this.onAction?.(cfg.id)
    })
    return btn
  }

  _bounce(el) {
    el.classList.remove('duk-bounce')
    void el.offsetWidth // force reflow so the animation restarts mid-run
    el.classList.add('duk-bounce')
  }

  setState({ money = 0, selection = null, tiers = null } = {}) {
    this._money = money
    const maxTier = tiers?.max ?? MAX_TIER
    const chickenSelected = selection?.type === 'chicken'
    const tier = chickenSelected ? (selection.tier ?? tiers?.current ?? 0) : null
    const mature = chickenSelected && tier >= maxTier

    for (const cfg of BUTTONS) {
      const contextOk = !cfg.needsChicken || (chickenSelected && !mature)
      const enabled = money >= cfg.price && contextOk
      this.buttons[cfg.id].disabled = !enabled
    }
    this._updateTierReadout(chickenSelected ? tier : null, maxTier)
  }

  _updateTierReadout(tier, maxTier) {
    const el = this.buttons['upgrade-patch'].querySelector('.duk-shop-tier')
    el.textContent = tier === null ? '' : `Tier ${tier}/${maxTier}`
  }
}
