<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { CircleHelp, Clock3, Gamepad2, Minus, Plus, ShieldCheck, Wallet } from 'lucide-vue-next'
import { useBankStore } from '@/stores/bank'
import { useAviatorStore } from '@/stores/aviator'
import SidebarNav from '@/components/SidebarNav.vue'
import AviatorCanvas from '@/components/AviatorCanvas.vue'

const bankStore = useBankStore()
const aviatorStore = useAviatorStore()
const activeTab = ref('all')
const quickAmounts = [5, 10, 20, 100]
const betAmounts = ref({ 1: 10000, 2: 10000 })
const autoCashout = ref({ 1: 2, 2: 2 })
const reducedMotion = ref(false)
const now = ref(Date.now())

const money = (value) => new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
}).format(value || 0)

const balance = computed(() => bankStore.availableBalance)
const roundStatus = computed(() => aviatorStore.phase)
const currentRound = computed(() => aviatorStore.round)
const historyRows = computed(() => (aviatorStore.history?.rounds || []).slice(0, 12))
const myBets = computed(() => aviatorStore.history?.bets || [])

const currentMultiplier = computed(() => {
  const round = currentRound.value
  if (!round || !round.startedAt || round.status !== 'flying') return 1
  const startedAt = Date.parse(round.startedAt)
  if (!Number.isFinite(startedAt)) return 1
  return Number(Math.max(1, Math.exp(Math.max(0, now.value - aviatorStore.clockOffset - startedAt) / 10000)).toFixed(2))
})

const finalMultiplier = computed(() => {
  const crash = Number(currentRound.value?.crashPoint || currentMultiplier.value || 1)
  return Number.isFinite(crash) ? Number(crash.toFixed(2)) : 1
})

const countdown = computed(() => {
  const round = currentRound.value
  if (!round || round.status !== 'betting' || !round.bettingEndsAt) return 0
  const timeLeft = Date.parse(round.bettingEndsAt) - (now.value - aviatorStore.clockOffset)
  return Math.max(0, Math.ceil(timeLeft / 1000))
})

const phaseTitle = computed(() => {
  if (roundStatus.value === 'betting') return 'Próxima ronda en'
  if (roundStatus.value === 'flying') return 'En vuelo'
  if (roundStatus.value === 'crashed') return 'Se fue'
  return 'Ronda en espera'
})

const phaseBadge = computed(() => {
  if (roundStatus.value === 'betting') return `Apuestas · ${countdown.value}s`
  if (roundStatus.value === 'flying') return 'Vuelo activo'
  if (roundStatus.value === 'crashed') return 'Resultado'
  return 'Ronda nueva'
})

const countdownProgress = computed(() => {
  if (roundStatus.value !== 'betting') return 0
  const total = 10
  return Math.max(0, Math.min(1, 1 - countdown.value / total))
})

const planeTransform = computed(() => {
  if (roundStatus.value !== 'flying') {
    return { x: 0, y: 0, rotation: 0 }
  }
  const multiplier = currentMultiplier.value || 1
  const x = 90 + Math.min(620, (multiplier - 1) * 42)
  const y = 360 - Math.min(220, (multiplier - 1) * 18)
  const rotation = Math.min(35, Math.max(-35, (multiplier - 1) * 6))
  return { x, y, rotation }
})

const multiplierColor = (value) => {
  const multiplier = Number.parseFloat(value)
  if (multiplier > 10) return 'border-pink-400/20 bg-pink-500/15 text-pink-200'
  if (multiplier >= 2) return 'border-violet-400/20 bg-violet-500/15 text-violet-200'
  return 'border-sky-400/20 bg-sky-500/15 text-sky-200'
}

const playerName = (value) => {
  if (!value) return 'Usuario'
  const name = String(value).trim()
  if (!name) return 'Usuario'
  if (name.length <= 4) return `${name.slice(0, 2)}••••${name.slice(-2) || name}`
  return `${name.slice(0, 2)}••••${name.slice(-2)}`
}

const fakePlayers = ['Ana', 'Mateo', 'Lucía', 'Daniel', 'Sofía', 'Javier', 'Valeria', 'Camilo', 'Paula', 'Nicolás', 'María', 'Tomás', 'Laura', 'Sebastián', 'Andrea', 'Diego']

const createSimulatedEntry = (index, statusOverride = 'active') => {
  const name = fakePlayers[index % fakePlayers.length]
  const amount = 10000 + ((index + 3) * 8900) + Math.round(Math.random() * 42000)
  const multiplierBase = 1.15 + ((index * 1.31) % 8.3) + Math.random() * 2.5
  const payout = Math.round(amount * multiplierBase)
  const status = statusOverride === 'active' ? (Math.random() > 0.55 ? 'winner' : 'loser') : statusOverride

  return {
    key: `sim-${Date.now()}-${index}-${Math.random().toString(16).slice(2, 8)}`,
    user: `${name.slice(0, 2)}••••${name.slice(-2)}`,
    amount,
    payout: status === 'winner' ? payout : 0,
    status,
  }
}

const simulatedEntries = ref([])

const syncSimulatedEntries = () => {
  const phase = roundStatus.value
  const entries = [...simulatedEntries.value]

  if (phase === 'betting') {
    const countTarget = 8 + Math.min(10, Math.max(0, Math.round((Date.now() / 1500) % 6)))
    if (entries.length < countTarget) {
      const toAdd = countTarget - entries.length
      for (let i = 0; i < toAdd; i += 1) {
        entries.push(createSimulatedEntry(entries.length + i, 'active'))
      }
    }
    while (entries.length > countTarget) {
      entries.shift()
    }
    simulatedEntries.value = entries
    return
  }

  if (phase === 'flying') {
    const nextList = entries
      .map((entry, index) => ({ ...entry, key: `${entry.key}-${index}`, status: Math.random() > 0.75 ? 'winner' : 'loser', payout: Math.random() > 0.7 ? Math.round((entry.amount || 0) * (1.2 + Math.random() * 2.4)) : 0 }))
      .slice(0, 10)
    simulatedEntries.value = nextList
    return
  }

  if (phase === 'crashed') {
    const resolved = entries
      .map((entry, index) => {
        const shouldWin = Math.random() > 0.55
        const multiplier = 1.2 + Math.random() * 4.5
        return {
          ...entry,
          key: `${entry.key}-resolved-${index}`,
          status: shouldWin ? 'winner' : 'loser',
          payout: shouldWin ? Math.round((entry.amount || 0) * multiplier) : 0,
        }
      })
      .slice(0, 8)
    simulatedEntries.value = resolved
    window.setTimeout(() => {
      if (roundStatus.value === 'crashed') {
        simulatedEntries.value = []
      }
    }, 1400)
  }
}

watch(roundStatus, () => {
  syncSimulatedEntries()
}, { immediate: true })

const currentBet = (slot) => {
  const bets = currentRound.value?.bets || []
  return bets.find((bet) => Number(bet.slot) === Number(slot)) || null
}

const activeLabel = (slot) => {
  const bet = currentBet(slot)
  if (bet && bet.status === 'active' && roundStatus.value === 'flying') return 'RETIRAR'
  if (bet && bet.status === 'active') return 'APUESTA REALIZADA'
  if (!bet && roundStatus.value === 'betting') return 'APOSTAR'
  if (bet && bet.status === 'cashed_out') return 'COBRADO'
  if (bet && bet.status === 'lost') return 'PERDIDA'
  if (roundStatus.value === 'betting') return 'CERRADO'
  return 'CERRADO'
}

const potentialWin = (slot) => {
  const bet = currentBet(slot)
  const amount = bet ? Number(bet.amount || 0) : Number(betAmounts.value[slot] || 0)
  if (!amount) return 0
  return amount * currentMultiplier.value
}

const getQuickValue = (slot, amount) => {
  betAmounts.value[slot] = Math.max(1000, Number((amount || 1) * 1000))
}

const adjustAmount = (slot, delta) => {
  const next = (Number(betAmounts.value[slot]) || 10000) + delta
  betAmounts.value[slot] = Math.max(1000, next)
}

const slotButtonDisabled = (slot) => {
  const status = activeLabel(slot)
  return aviatorStore.isBusy || status === 'CERRADO' || status === 'APUESTA REALIZADA'
}

const placeBet = async (slot) => {
  const amount = Number(betAmounts.value[slot] || 0)
  const result = await aviatorStore.placeBet({
    slot,
    amount,
    autoCashout: Number(autoCashout.value[slot] || 1.01),
  })
  if (!result.ok) console.error(result.message)
}

const cashOut = async (slot) => {
  const result = await aviatorStore.cashOut({ slot })
  if (!result.ok) console.error(result.message)
}

const slotNotice = ref({ 1: '', 2: '' })
const slotNoticeType = ref({ 1: 'info', 2: 'info' })
const cashoutSuccessBanner = ref({ visible: false, amount: 0, label: '' })

const setSlotNotice = (slot, message, type = 'info') => {
  const normalized = String(message || '').trim()
  slotNotice.value[slot] = normalized
  slotNoticeType.value[slot] = type
}

const setCashoutSuccessBanner = (amount) => {
  if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) return
  cashoutSuccessBanner.value = {
    visible: true,
    amount: Number(amount),
    label: `¡Ganaste ${money(Number(amount))}!`,
  }
  window.clearTimeout(window.__aviatorCashoutBannerTimer)
  window.__aviatorCashoutBannerTimer = window.setTimeout(() => {
    cashoutSuccessBanner.value.visible = false
  }, 3500)
}

const actionForSlot = async (slot) => {
  const bet = currentBet(slot)
  if (aviatorStore.isBusy) return
  if (!bet && roundStatus.value === 'betting') {
    const result = await placeBet(slot)
    setSlotNotice(slot, result.ok ? 'Apuesta realizada.' : result.message, result.ok ? 'success' : 'error')
    return
  }
  if (bet && bet.status === 'active' && roundStatus.value === 'flying') {
    const result = await cashOut(slot)
    if (result.ok && Number(result.data?.bet?.payout || 0) > 0) {
      setCashoutSuccessBanner(Number(result.data?.bet?.payout || 0))
    }
    setSlotNotice(slot, result.ok ? 'Retiro realizado.' : result.message, result.ok ? 'success' : 'error')
  }
}

const payLabel = (slot) => {
  const label = activeLabel(slot)
  if (label === 'RETIRAR') return `RETIRAR ${money(potentialWin(slot))}`
  return label
}

const panelRows = computed(() => {
  const realRows = [...(currentRound.value?.bets || []), ...myBets.value].slice(0, 8)
  const all = [...realRows, ...simulatedEntries.value]
  const source = activeTab.value === 'mine'
    ? myBets.value.length
      ? myBets.value
      : simulatedEntries.value.slice(0, 4)
    : activeTab.value === 'top'
      ? [...all].sort((a, b) => Number(b.payout || b.amount || 0) - Number(a.payout || a.amount || 0))
      : all

  return source.map((entry, index) => ({
    key: entry.id || entry.key || `${activeTab.value}-${index}`,
    user: entry.user || 'Usuario',
    amount: Number(entry.amount || 0),
    payout: Number(entry.payout || 0),
    status: entry.status || 'active',
  })).slice(0, 12)
})

onMounted(() => {
  const media = window.matchMedia('(prefers-reduced-motion: reduce)')
  reducedMotion.value = media.matches
  const syncMotion = (event) => {
    reducedMotion.value = event.matches
  }
  media.addEventListener?.('change', syncMotion)
  window.__aviatorMotionListener = syncMotion

  const tick = () => {
    now.value = Date.now()
  }
  tick()
  const timer = window.setInterval(tick, 100)
  window.__aviatorTick = timer
  const simulatedTimer = window.setInterval(syncSimulatedEntries, 1200)
  window.__aviatorSimulatedTick = simulatedTimer

  aviatorStore.loadState()
  aviatorStore.loadHistory()
  aviatorStore.connectSse()

  const syncOnVisible = () => {
    if (document.visibilityState === 'visible') {
      now.value = Date.now()
      aviatorStore.loadState()
      aviatorStore.loadHistory()
      aviatorStore.connectSse()
    }
  }
  document.addEventListener('visibilitychange', syncOnVisible)
  window.__aviatorVisibilitySync = syncOnVisible
})

onBeforeUnmount(() => {
  if (window.__aviatorMotionListener) {
    window.matchMedia('(prefers-reduced-motion: reduce)').removeEventListener?.('change', window.__aviatorMotionListener)
  }
  if (window.__aviatorTick) {
    window.clearInterval(window.__aviatorTick)
    delete window.__aviatorTick
  }
  if (window.__aviatorSimulatedTick) {
    window.clearInterval(window.__aviatorSimulatedTick)
    delete window.__aviatorSimulatedTick
  }
  if (window.__aviatorVisibilitySync) {
    document.removeEventListener('visibilitychange', window.__aviatorVisibilitySync)
    delete window.__aviatorVisibilitySync
  }
  aviatorStore.disconnectSse()
})
</script>

<template>
  <div class="min-h-screen px-4 pb-10 pt-5 text-white lg:px-6">
    <div class="mx-auto max-w-[1500px] lg:flex lg:gap-8">
      <SidebarNav />

      <main class="min-w-0 flex-1 space-y-5">
        <header class="glass-panel flex flex-wrap items-center justify-between gap-4 rounded-[28px] border p-5 sm:p-6">
          <div>
            <p class="text-xs uppercase tracking-[0.25em] text-sky-200/70">Entretenimiento</p>
            <h1 class="mt-2 flex items-center gap-2 text-2xl font-semibold sm:text-3xl">
              <Gamepad2 class="h-6 w-6 text-sky-300" />
              Casino
            </h1>
            <p class="mt-1 text-sm text-slate-400">AVIATOR · Juego en vivo</p>
          </div>

          <div class="flex items-center gap-3 rounded-2xl border border-sky-400/20 bg-sky-500/10 px-4 py-3">
            <Wallet class="h-5 w-5 text-sky-300" />
            <div>
              <p class="text-xs uppercase tracking-[0.16em] text-sky-200/70">Saldo disponible</p>
              <p class="mt-0.5 text-lg font-semibold text-white">{{ money(balance) }}</p>
            </div>
          </div>
        </header>

        <section class="glass-panel overflow-hidden rounded-[28px] border p-3 sm:p-5">
          <div class="flex items-center justify-between gap-3">
            <div class="flex min-w-0 items-center gap-2">
              <span class="shrink-0 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Últimas rondas</span>
              <div class="flex min-w-0 gap-2 overflow-x-auto py-1">
                <span
                  v-for="(round, index) in historyRows"
                  :key="`${round.id || index}`"
                  :class="['shrink-0 rounded-full border px-3 py-1 text-xs font-semibold', multiplierColor(`${Number(round.crashPoint || 1).toFixed(2)}x`)]"
                >
                  {{ Number(round.crashPoint || 1).toFixed(2) }}x
                </span>
              </div>
            </div>
            <span class="hidden shrink-0 items-center gap-1.5 rounded-full border border-white/10 px-3 py-1.5 text-xs text-slate-300 sm:inline-flex">
              <ShieldCheck class="h-3.5 w-3.5 text-emerald-300" />
              Provably fair
            </span>
          </div>
        </section>

        <section class="grid min-w-0 gap-5 xl:grid-cols-[minmax(230px,0.72fr)_minmax(0,2fr)]">
          <aside class="glass-panel min-w-0 rounded-[28px] border p-4 sm:p-5">
            <div class="flex items-center justify-between gap-3">
              <div>
                <p class="text-xs uppercase tracking-[0.18em] text-sky-200/70">En esta ronda</p>
                <h2 class="mt-1 text-lg font-semibold">Apuestas totales</h2>
              </div>
              <span class="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-semibold text-slate-200">
                {{ currentRound?.status ? phaseBadge : '—' }}
              </span>
            </div>

            <div class="mt-4 grid grid-cols-3 rounded-xl border border-white/10 bg-slate-950/40 p-1 text-center text-xs">
              <button type="button" @click="activeTab = 'all'" class="rounded-lg px-2 py-2 font-medium" :class="activeTab === 'all' ? 'bg-white/10 text-white' : 'text-slate-400'">Todas</button>
              <button type="button" @click="activeTab = 'mine'" class="rounded-lg px-2 py-2" :class="activeTab === 'mine' ? 'bg-white/10 text-white' : 'text-slate-400'">Mis apuestas</button>
              <button type="button" @click="activeTab = 'top'" class="rounded-lg px-2 py-2" :class="activeTab === 'top' ? 'bg-white/10 text-white' : 'text-slate-400'">Top</button>
            </div>

            <div class="mt-4 grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-3 px-2 text-[10px] uppercase tracking-[0.12em] text-slate-500">
              <span>Usuario</span>
              <span>Apuesta</span>
              <span>Ganancia</span>
            </div>

            <div class="mt-2 space-y-2">
              <template v-if="panelRows.length">
                <div
                  v-for="row in panelRows"
                  :key="row.key"
                  class="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 rounded-xl border border-white/5 bg-slate-950/35 px-3 py-3"
                >
                  <span class="truncate text-sm font-medium text-slate-200">{{ row.user ? playerName(row.user) : 'Usuario' }}</span>
                  <span class="text-xs text-slate-400">{{ row.amount ? money(row.amount) : '—' }}</span>
                  <span class="text-xs" :class="row.payout ? 'text-emerald-300' : 'text-slate-500'">{{ row.payout ? money(row.payout) : '—' }}</span>
                </div>
              </template>
              <div v-else class="rounded-xl border border-dashed border-white/10 bg-slate-950/20 px-3 py-6 text-center text-sm text-slate-400">
                Aún no hay apuestas en esta ronda
              </div>
            </div>
          </aside>

          <div class="min-w-0 space-y-5">
            <section class="aviator-stage relative flex min-h-[300px] flex-col items-center justify-center overflow-hidden rounded-[28px] border border-white/10 px-4 py-8 sm:min-h-[390px] sm:py-10">
              <div class="absolute left-4 top-4 flex items-center gap-2 rounded-full border border-white/10 bg-black/40 px-3 py-1.5 text-xs text-slate-300">
                <Clock3 class="h-3.5 w-3.5 text-amber-300" />
                {{ roundStatus === 'betting' ? `Apuestas · ${countdown}s` : roundStatus === 'flying' ? 'Vuelo activo' : 'Ronda cerrada' }}
              </div>

                <div v-if="cashoutSuccessBanner.visible" class="absolute left-1/2 top-5 z-20 -translate-x-1/2 rounded-[22px] border border-emerald-300/40 bg-gradient-to-r from-emerald-500/15 via-emerald-400/10 to-teal-400/15 px-6 py-4 text-center shadow-[0_0_40px_rgba(52,211,153,0.28)] backdrop-blur-md">
                  <p class="text-[9px] font-black uppercase tracking-[0.42em] text-emerald-200/90">Retiro exitoso</p>
                  <p class="mt-2 text-2xl font-black tracking-tight text-emerald-100 sm:text-3xl">{{ cashoutSuccessBanner.label }}</p>
                </div>

                <div class="relative z-10 text-center">
                  <p class="text-xs font-semibold uppercase tracking-[0.3em] text-rose-300/80">AVIATOR</p>
                  <p class="mt-2 text-6xl font-black tracking-tight text-white drop-shadow-[0_0_30px_rgba(244,63,94,0.25)] sm:text-8xl">{{ currentMultiplier.toFixed(2) }}x</p>
                  <p class="mt-2 text-sm text-slate-400">
                    {{ roundStatus === 'betting' ? `Próxima ronda en ${countdown}s` : roundStatus === 'flying' ? 'En vuelo' : roundStatus === 'crashed' ? `Se fue ${finalMultiplier.toFixed(2)}x` : 'Ronda en espera' }}
                  </p>
                </div>

              <div v-if="roundStatus === 'betting'" class="relative z-10 mt-5 w-full max-w-md">
                <div class="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300">
                  <span>{{ phaseTitle }}</span>
                  <span>{{ countdown }}s</span>
                </div>
                <div class="h-2.5 overflow-hidden rounded-full bg-slate-800/80">
                  <div class="h-full rounded-full bg-gradient-to-r from-sky-400 via-violet-500 to-pink-500 transition-[width] duration-200" :style="{ width: `${(countdownProgress * 100).toFixed(2)}%` }" />
                </div>
              </div>

              <AviatorCanvas
                :phase="roundStatus"
                :multiplier="currentMultiplier"
                :final-multiplier="finalMultiplier"
                :reduced-motion="reducedMotion"
                :countdown="countdown"
                :now="now"
                :round="currentRound"
              />
            </section>

            <div class="grid gap-4 lg:grid-cols-2">
              <article v-for="slot in 2" :key="slot" class="glass-panel min-w-0 rounded-[26px] border p-4 sm:p-5">
                <div class="flex items-center justify-between gap-3">
                  <div class="inline-flex rounded-full border border-white/10 bg-slate-950/40 p-1 text-xs">
                    <button type="button" class="rounded-full bg-white/10 px-3 py-1.5 font-medium text-white">Apostar</button>
                    <button type="button" class="px-3 py-1.5 text-slate-400">Automático</button>
                  </div>
                  <span class="text-xs text-slate-500">Apuesta {{ slot }}</span>
                </div>

                <div class="mt-4 grid grid-cols-[minmax(0,1fr)_minmax(110px,1.15fr)] gap-3">
                  <div class="min-w-0">
                    <div class="flex h-12 items-center justify-between rounded-xl border border-white/10 bg-slate-950/60 px-3">
                      <span class="truncate text-lg font-semibold text-slate-200">{{ money(betAmounts[slot] || 0) }}</span>
                      <div class="flex shrink-0 gap-1">
                        <button type="button" @click="adjustAmount(slot, -1000)" aria-label="Disminuir monto" class="h-7 w-7 rounded-lg bg-white/5 text-slate-200">
                          <Minus class="mx-auto h-3.5 w-3.5" />
                        </button>
                        <button type="button" @click="adjustAmount(slot, 1000)" aria-label="Aumentar monto" class="h-7 w-7 rounded-lg bg-white/5 text-slate-200">
                          <Plus class="mx-auto h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    <div class="mt-2 grid grid-cols-4 gap-1.5">
                      <button v-for="amount in quickAmounts" :key="amount" type="button" @click="getQuickValue(slot, amount)" class="rounded-full border border-white/10 bg-white/5 px-1 py-1.5 text-[10px] text-slate-200">{{ amount }}</button>
                    </div>
                  </div>

                  <button
                    type="button"
                    :disabled="slotButtonDisabled(slot)"
                    @click="actionForSlot(slot)"
                    class="flex min-h-[76px] items-center justify-center rounded-2xl px-3 text-center text-base font-black tracking-wide sm:text-lg"
                    :class="activeLabel(slot) === 'RETIRAR' ? 'bg-orange-500 text-white' : 'bg-emerald-600 text-emerald-50'"
                  >
                    {{ activeLabel(slot) }}
                  </button>
                </div>

                <div v-if="activeLabel(slot) === 'RETIRAR'" class="mt-3 flex items-center justify-between rounded-xl border border-orange-500/20 bg-orange-500/5 px-3 py-2 text-xs text-orange-100">
                  <span>Premio en vivo</span>
                  <strong>{{ money(potentialWin(slot)) }}</strong>
                </div>

                <div v-if="slotNotice[slot]" class="mt-3 rounded-xl border px-3 py-2 text-xs" :class="slotNoticeType[slot] === 'error' ? 'border-red-500/20 bg-red-500/10 text-red-200' : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200'">
                  {{ slotNotice[slot] }}
                </div>

                <div class="mt-3 flex items-center gap-2 rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2 text-xs text-slate-300">
                  <span>Auto</span>
                  <input v-model.number="autoCashout[slot]" type="number" min="1.01" max="1000" step="0.01" class="w-full rounded-lg border border-white/10 bg-slate-900 px-2 py-1 text-right text-white outline-none" />
                  <span>x</span>
                </div>
              </article>
            </div>
          </div>
        </section>

        <footer class="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300/15 bg-amber-400/5 px-4 py-3 text-sm text-slate-300">
          <span class="flex items-center gap-2">
            <CircleHelp class="h-4 w-4 shrink-0 text-amber-300" />
            Se puede perder dinero al jugar. Juega responsablemente y nunca apuestes más de lo que puedes permitirte perder.
          </span>
          <span class="text-xs text-slate-500">{{ aviatorStore.error || aviatorStore.success || 'Sin mensajes del servidor' }}</span>
        </footer>
      </main>
    </div>
  </div>
</template>

<style scoped>
.aviator-stage {
  background-color: #09090b;
  background-image: repeating-conic-gradient(from 220deg at 50% 100%, rgba(255, 255, 255, 0.035) 0deg 8deg, transparent 8deg 18deg);
}
</style>
