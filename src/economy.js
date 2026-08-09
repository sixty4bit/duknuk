// Economy — money, egg pricing, and the on-change hook the HUD listens to.

const PREMIUM_RATE = 1
const FEEDER_RATE = 0.7

export class Economy {
  constructor() {
    this.money = 0
    this.eggPrice = 12
    this.onChange = null
  }

  sellEgg({ premium = true } = {}) {
    const rate = premium ? PREMIUM_RATE : FEEDER_RATE
    const value = Math.round(this.eggPrice * rate)
    this.money += value
    this._notify()
    return value
  }

  canAfford(n) {
    return this.money >= n
  }

  spend(n) {
    if (!this.canAfford(n)) return false
    this.money -= n
    this._notify()
    return true
  }

  _notify() {
    if (this.onChange) this.onChange()
  }
}
