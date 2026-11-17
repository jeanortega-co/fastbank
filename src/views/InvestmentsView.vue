<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { Activity, AlertTriangle, CalendarClock, Clock3, TrendingDown, TrendingUp, Wallet } from 'lucide-vue-next'
import { useBankStore } from '@/stores/bank'
import SidebarNav from '@/components/SidebarNav.vue'

const store = useBankStore()
const selectedSymbol = ref('')
const isChartVisible = ref(false)
const isInstrumentPickerOpen = ref(false)
const chartDays = ref(30)
const marketError = ref('')
const amount = ref(100000)
const termDays = ref(30)
const message = ref('')
const isLoading = ref(true)
const isBuying = ref(false)
const busyPositionId = ref('')
const money = (value) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value || 0)
const dateTime = (value) => new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
const availableBalance = computed(() => store.currentUser?.balance || 0)
const instruments = computed(() => store.investmentInstruments)
const positions = computed(() => store.investmentPositions)
const activePositions = computed(() => positions.value.filter((position) => position.status === 'active'))
const closedPositions = computed(() => positions.value.filter((position) => position.status === 'closed'))
const activeValue = computed(() => activePositions.value.reduce((sum, position) => sum + position.currentValue, 0))
const selectedInstrument = computed(() => instruments.value.find((instrument) => instrument.symbol === selectedSymbol.value) || null)
const chartPlot = { left: 12, top: 12, width: 654, height: 210 }
const chartCandles = computed(() => {
  const candles = selectedInstrument.value?.liveCandles?.slice(-chartDays.value) || []
  if (!candles.length) return []

  const minimum = Math.min(...candles.map((candle) => candle.low))
  const maximum = Math.max(...candles.map((candle) => candle.high))
  const padding = (maximum - minimum || maximum * 0.005) * 0.12
  const chartMinimum = minimum - padding
  const chartRange = maximum - minimum + padding * 2 || 1
  const yForPrice = (price) => chartPlot.top + chartPlot.height - ((price - chartMinimum) / chartRange) * chartPlot.height
  const slotWidth = chartPlot.width / candles.length

  return candles.map((candle, index) => {
    const openY = yForPrice(candle.open)
    const closeY = yForPrice(candle.close)
    const bodyHeight = Math.max(Math.abs(closeY - openY), 4)

    return {
      ...candle,
      x: chartPlot.left + index * slotWidth + slotWidth / 2,
      y: (openY + closeY) / 2 - bodyHeight / 2,
      height: bodyHeight,
      wickTop: yForPrice(candle.high),
      wickBottom: yForPrice(candle.low),
      width: Math.min(10, slotWidth * 0.56),
      direction: candle.close > candle.open ? 'up' : candle.close < candle.open ? 'down' : 'flat',
    }
  })
})
const chartPerformance = computed(() => {
  if (chartCandles.value.length < 2) return selectedInstrument.value?.change || 0
  const first = chartCandles.value[0].open
  const last = chartCandles.value.at(-1).close
  return Number((((last - first) / first) * 100).toFixed(2))
})
const liveDirection = computed(() => chartCandles.value.at(-1)?.direction || 'flat')
const chartPriceTicks = computed(() => {
  if (!chartCandles.value.length) return []
  const minimum = Math.min(...chartCandles.value.map((candle) => candle.low))
  const maximum = Math.max(...chartCandles.value.map((candle) => candle.high))
  const padding = (maximum - minimum || maximum * 0.005) * 0.12
  const chartRange = maximum - minimum + padding * 2 || 1

  return Array.from({ length: 5 }, (_, index) => {
    const ratio = index / 4
    return {
      price: maximum + padding - ratio * chartRange,
      y: chartPlot.top + ratio * chartPlot.height,
    }
  })
})
const chartDateLabels = computed(() => {
  if (!chartCandles.value.length) return []
  const lastIndex = chartCandles.value.length - 1
  const indices = [...new Set([0, Math.floor(lastIndex / 2), lastIndex])]

  return indices.map((index) => ({
    x: chartPlot.left + (index + 0.5) / chartCandles.value.length * chartPlot.width,
    label: index === lastIndex
      ? 'En vivo'
      : `${Math.round((lastIndex - index) * 3)} s`,
  }))
})
const chartPriceLabel = (value) => new Intl.NumberFormat('es-CO', {
  notation: 'compact',
  maximumFractionDigits: 2,
}).format(value)
const estimatedShares = computed(() => {
  const value = Number(amount.value)
  if (!selectedInstrument.value || !Number.isFinite(value) || value <= 0) return 0
  return value / selectedInstrument.value.price
})
const maturityDate = computed(() => new Date(Date.now() + Number(termDays.value) * 86400000))
let liveChartTimeout
let liveChartSyncId = 0
const scheduleLiveMarketRefresh = (syncId) => {
  if (syncId !== liveChartSyncId) return
  const delay = 3000 - (Date.now() % 3000) + 40
  liveChartTimeout = setTimeout(async () => {
    try {
      await store.fetchInvestments()
      if (syncId === liveChartSyncId) marketError.value = ''
    } catch (error) {
      if (syncId === liveChartSyncId) marketError.value = error.message || 'No se pudo actualizar la cotización.'
    } finally {
      scheduleLiveMarketRefresh(syncId)
    }
  }, delay)
}

const startLiveMarketRefresh = () => {
  liveChartSyncId += 1
  clearTimeout(liveChartTimeout)
  scheduleLiveMarketRefresh(liveChartSyncId)
}

onUnmounted(() => {
  liveChartSyncId += 1
  clearTimeout(liveChartTimeout)
})

const chartPoints = (history) => {
  if (!history?.length) return ''
  const prices = history.map((point) => point.price)
  const minimum = Math.min(...prices)
  const range = Math.max(...prices) - minimum || 1
  return prices.map((price, index) => `${(index / (prices.length - 1)) * 100},${34 - ((price - minimum) / range) * 30}`).join(' ')
}

const showInstrumentChart = (instrument) => {
  selectedSymbol.value = instrument.symbol
  isChartVisible.value = true
  if (typeof document !== 'undefined') {
    requestAnimationFrame(() => document.getElementById('instrument-chart')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }
}

const chooseInstrumentToInvest = (instrument) => {
  selectedSymbol.value = instrument.symbol
  isInstrumentPickerOpen.value = false
  if (typeof document !== 'undefined') {
    requestAnimationFrame(() => document.getElementById('investment-order')?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  }
}

const selectInstrument = (instrument) => {
  selectedSymbol.value = instrument.symbol
  isInstrumentPickerOpen.value = false
}

const refresh = async () => {
  isLoading.value = true
  message.value = ''
  try {
    const data = await store.fetchInvestments()
    if (!selectedSymbol.value && data.instruments.length) selectedSymbol.value = data.instruments[0].symbol
    if (data.availableBalance !== undefined && store.currentUser) store.currentUser.balance = data.availableBalance
    marketError.value = ''
  } catch (error) {
    message.value = error.message || 'No se pudo cargar el mercado de inversiones.'
  } finally {
    isLoading.value = false
  }
}

const buy = async () => {
  if (!selectedInstrument.value || isBuying.value) return
  message.value = ''
  isBuying.value = true
  const result = await store.buyInvestment({
    symbol: selectedSymbol.value,
    amount: amount.value,
    termDays: termDays.value,
  })
  isBuying.value = false
  if (!result.ok) {
    message.value = result.message
    return
  }
  message.value = `Inversión en ${selectedInstrument.value.name} registrada. El monto quedará comprometido hasta el ${dateTime(maturityDate.value)}.`
  amount.value = 100000
}

const withdraw = async (position) => {
  if (busyPositionId.value) return
  message.value = ''
  busyPositionId.value = position.id
  const result = await store.withdrawInvestment(position.id)
  busyPositionId.value = ''
  message.value = result.ok
    ? `Retiro completado. Se abonó ${money(store.investmentPositions.find((item) => item.id === position.id)?.payout || 0)} a tu saldo disponible.`
    : result.message
}

onMounted(async () => {
  await refresh()
  startLiveMarketRefresh()
})
</script>

<template>
  <div class="min-h-screen px-4 pb-10 pt-5 text-white lg:px-6">
    <div class="mx-auto max-w-7xl lg:flex lg:gap-8">
      <SidebarNav />
      <main class="min-w-0 flex-1 space-y-6">
        <header class="glass-panel rounded-[28px] border p-6">
          <p class="text-xs uppercase tracking-[0.25em] text-sky-200/70">Mercado de acciones</p>
          <h1 class="mt-2 text-3xl font-semibold">Inversiones</h1>
          <p class="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
            Explora tendencias y precios de referencia; el valor de una inversión puede subir o bajar. El monto comprometido se descuenta del saldo disponible y, al vencimiento, recibirás el valor que tenga entonces.
          </p>
        </header>

        <section class="grid gap-4 sm:grid-cols-2">
          <article class="glass-panel flex items-center gap-4 rounded-[26px] border p-5">
            <span class="rounded-2xl bg-sky-400/10 p-3 text-sky-200"><Wallet class="h-5 w-5" /></span>
            <div>
              <p class="text-sm text-slate-400">Saldo disponible</p>
              <p class="mt-1 text-2xl font-semibold">{{ money(availableBalance) }}</p>
            </div>
          </article>
          <article class="glass-panel flex items-center gap-4 rounded-[26px] border p-5">
            <span class="rounded-2xl bg-violet-400/10 p-3 text-violet-200"><TrendingUp class="h-5 w-5" /></span>
            <div>
              <p class="text-sm text-slate-400">Valor actual comprometido</p>
              <p class="mt-1 text-2xl font-semibold">{{ money(activeValue) }}</p>
            </div>
          </article>
        </section>

        <section>
          <div class="mb-4 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 class="text-xl font-semibold">Acciones disponibles</h2>
              <p class="mt-1 text-sm text-slate-400">Tendencia y variación reciente de cada empresa</p>
            </div>
            <button type="button" class="text-sm text-sky-200 hover:text-white" :disabled="isLoading" @click="refresh">
              {{ isLoading ? 'Actualizando…' : 'Actualizar cotizaciones' }}
            </button>
          </div>

          <div v-if="isLoading" class="glass-panel rounded-[26px] border p-6 text-slate-300">Cargando cotizaciones…</div>
          <div v-else class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <article
              v-for="instrument in instruments"
              :key="instrument.symbol"
              :class="['glass-panel rounded-[26px] border p-5 transition', selectedSymbol === instrument.symbol ? 'border-sky-300/60 ring-1 ring-sky-300/30' : '']"
            >
              <div class="flex items-start justify-between gap-3">
                <div>
                  <h3 class="text-lg font-semibold">{{ instrument.name }}</h3>
                  <p class="mt-1 text-xs uppercase tracking-[0.2em] text-slate-400">{{ instrument.symbol }} · {{ instrument.sector }}</p>
                </div>
                <component :is="instrument.change >= 0 ? TrendingUp : TrendingDown" :class="['h-5 w-5', instrument.change >= 0 ? 'text-emerald-300' : 'text-rose-300']" />
              </div>
              <div class="mt-4 flex items-end justify-between gap-3">
                <div>
                  <p class="text-xs text-slate-400">Precio de referencia</p>
                  <p class="mt-1 text-xl font-semibold">{{ money(instrument.price) }}</p>
                </div>
                <span :class="['text-sm font-medium', instrument.change >= 0 ? 'text-emerald-300' : 'text-rose-300']">
                  {{ instrument.change > 0 ? '+' : '' }}{{ instrument.change }}%
                </span>
              </div>
              <svg viewBox="0 0 100 38" preserveAspectRatio="none" class="mt-4 h-12 w-full overflow-visible" role="img" :aria-label="`Tendencia reciente de ${instrument.name}`">
                <polyline
                  :points="chartPoints(instrument.history)"
                  fill="none"
                  :stroke="instrument.change >= 0 ? '#6ee7b7' : '#fda4af'"
                  stroke-width="2"
                  vector-effect="non-scaling-stroke"
                />
              </svg>
              <div class="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  class="rounded-full border border-white/10 bg-white/5 px-3 py-2.5 text-sm font-semibold text-slate-100 transition hover:bg-white/10"
                  @click="showInstrumentChart(instrument)"
                >
                  Ver acciones
                </button>
                <button
                  type="button"
                  class="rounded-full bg-sky-300 px-3 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-sky-200"
                  @click="chooseInstrumentToInvest(instrument)"
                >
                  Invertir
                </button>
              </div>
            </article>
          </div>
          <p v-if="marketError" role="alert" class="mt-4 rounded-xl border border-rose-300/20 bg-rose-300/10 px-4 py-3 text-sm text-rose-100">
            {{ marketError }}
          </p>
        </section>

        <section v-if="isChartVisible && selectedInstrument" id="instrument-chart" class="glass-panel scroll-mt-6 overflow-hidden rounded-[28px] border p-5 sm:p-6">
          <div class="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
            <div>
              <div class="flex items-center gap-2">
                <Activity class="h-5 w-5 text-sky-300" />
                <p class="text-xs uppercase tracking-[0.2em] text-sky-200/70">{{ selectedInstrument.symbol }} · {{ selectedInstrument.name }}</p>
              </div>
              <div class="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <h2 class="text-3xl font-semibold">{{ money(selectedInstrument.price) }}</h2>
                <span :class="['text-sm font-semibold', chartPerformance >= 0 ? 'text-emerald-300' : 'text-rose-300']">
                  {{ chartPerformance > 0 ? '+' : '' }}{{ chartPerformance }}%
                </span>
              </div>
              <p class="mt-1 text-sm text-slate-400">Variación de la cotización · últimas {{ chartDays }} velas</p>
            </div>
            <div class="flex items-center gap-2 rounded-full border border-white/10 bg-slate-950/30 p-1">
              <button
                v-for="range in [7, 30]"
                :key="range"
                type="button"
                :class="['rounded-full px-4 py-2 text-sm transition', chartDays === range ? 'bg-sky-300 font-semibold text-slate-950' : 'text-slate-300 hover:bg-white/5']"
                @click="chartDays = range"
              >
                {{ range }} velas
              </button>
            </div>
          </div>
          <div class="mt-5 overflow-hidden rounded-2xl border border-white/10 bg-[#20242c] p-2 sm:p-4">
            <div class="mb-2 flex items-center gap-2 px-2 text-xs text-slate-300">
              <span class="relative flex h-2 w-2">
                <span :class="['absolute inline-flex h-full w-full animate-ping rounded-full opacity-60', liveDirection === 'down' ? 'bg-rose-400' : 'bg-emerald-400']" />
                <span :class="['relative inline-flex h-2 w-2 rounded-full', liveDirection === 'down' ? 'bg-rose-400' : 'bg-emerald-400']" />
              </span>
              Cotización: {{ liveDirection === 'up' ? 'subiendo' : liveDirection === 'down' ? 'bajando' : 'en vivo' }}
            </div>
            <svg
              :key="`${selectedInstrument.symbol}-${chartDays}`"
              viewBox="0 0 760 270"
              preserveAspectRatio="none"
              class="investment-candle-chart h-56 w-full sm:h-72"
              role="img"
              :aria-label="`Gráfico animado de ${selectedInstrument.name} con ${chartDays} velas que suben y bajan cada 3 segundos`"
            >
              <rect x="0" y="0" width="760" height="270" fill="#20242c" />
              <g aria-hidden="true">
                <line
                  v-for="tick in chartPriceTicks"
                  :key="tick.y"
                  :x1="chartPlot.left"
                  :x2="chartPlot.left + chartPlot.width"
                  :y1="tick.y"
                  :y2="tick.y"
                  stroke="#a1a1aa"
                  stroke-opacity="0.18"
                />
                <line
                  v-for="index in 6"
                  :key="`vertical-${index}`"
                  :x1="chartPlot.left + (index - 1) * chartPlot.width / 5"
                  :x2="chartPlot.left + (index - 1) * chartPlot.width / 5"
                  :y1="chartPlot.top"
                  :y2="chartPlot.top + chartPlot.height"
                  stroke="#a1a1aa"
                  stroke-opacity="0.12"
                />
                <text
                  v-for="tick in chartPriceTicks"
                  :key="`label-${tick.y}`"
                  x="678"
                  :y="tick.y + 4"
                  fill="#a1a1aa"
                  class="investment-chart-axis-label"
                >
                  {{ chartPriceLabel(tick.price) }}
                </text>
              </g>
              <g
                v-for="(candle, index) in chartCandles"
                :key="`${selectedInstrument.symbol}-${candle.id}`"
                :class="['investment-candle', `investment-candle--${candle.direction}`]"
                :style="{ animationDelay: `${Math.min(index * 14, 350)}ms` }"
                :aria-label="`Vela ${index + 1}: ${money(candle.close)}, ${candle.direction === 'up' ? 'sube' : candle.direction === 'down' ? 'baja' : 'sin variación'}`"
              >
                <title>{{ money(candle.close) }} · {{ candle.direction === 'up' ? 'Sube' : candle.direction === 'down' ? 'Baja' : 'Sin variación' }}</title>
                <line
                  :x1="candle.x"
                  :x2="candle.x"
                  :y1="candle.wickTop"
                  :y2="candle.wickBottom"
                  :stroke="candle.direction === 'up' ? '#00c176' : candle.direction === 'down' ? '#f04438' : '#a1a1aa'"
                  stroke-width="1.5"
                  vector-effect="non-scaling-stroke"
                />
                <rect
                  :x="candle.x - candle.width / 2"
                  :y="candle.y"
                  :width="candle.width"
                  :height="candle.height"
                  :fill="candle.direction === 'up' ? '#00c176' : candle.direction === 'down' ? '#f04438' : '#a1a1aa'"
                  rx="1"
                />
              </g>
              <g aria-hidden="true" fill="#a1a1aa" font-size="11">
                <text
                  v-for="label in chartDateLabels"
                  :key="`${label.x}-${label.label}`"
                  :x="label.x"
                  y="250"
                  text-anchor="middle"
                  class="investment-chart-axis-label"
                >
                  {{ label.label }}
                </text>
              </g>
            </svg>
          </div>
          <p class="mt-3 text-xs leading-5 text-slate-400">La gráfica y el valor actual de tus inversiones usan la misma cotización de referencia, actualizada cada 3 segundos. Si baja, también puede bajar el valor de tu inversión; al vencimiento se abonará el valor calculado con la cotización de ese momento. Estas cotizaciones son referenciales y no corresponden a operaciones en una bolsa real.</p>
        </section>

        <section id="investment-order" class="glass-panel scroll-mt-6 rounded-[28px] border p-5 sm:p-6">
          <div>
            <h2 class="text-xl font-semibold">Definir inversión</h2>
            <p class="mt-1 text-sm text-slate-400">Elige cuánto invertir y durante cuánto tiempo deseas mantener el dinero.</p>
          </div>
          <div v-if="selectedInstrument" class="mt-5 space-y-4">
            <div class="rounded-2xl border border-sky-300/20 bg-gradient-to-r from-sky-400/[0.09] via-indigo-400/[0.07] to-transparent p-4 sm:p-5">
              <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div class="flex min-w-0 items-center gap-3">
                  <span class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-slate-950/40 text-sm font-bold tracking-wide text-sky-100">
                    {{ selectedInstrument.symbol.slice(0, 2) }}
                  </span>
                  <div class="min-w-0">
                    <p class="text-xs uppercase tracking-[0.18em] text-sky-200/70">Empresa seleccionada</p>
                    <h3 class="mt-1 truncate text-lg font-semibold">{{ selectedInstrument.name }} <span class="text-sm font-medium text-slate-400">· {{ selectedInstrument.symbol }}</span></h3>
                    <p class="mt-0.5 text-sm text-slate-400">{{ selectedInstrument.sector }}</p>
                  </div>
                </div>
                <div class="flex items-center justify-between gap-4 sm:justify-end">
                  <div class="sm:text-right">
                    <p class="text-xs text-slate-400">Precio de referencia</p>
                    <p class="mt-1 text-lg font-semibold">{{ money(selectedInstrument.price) }}</p>
                  </div>
                  <span :class="['rounded-full px-3 py-1.5 text-sm font-semibold', selectedInstrument.change >= 0 ? 'bg-emerald-300/10 text-emerald-200' : 'bg-rose-300/10 text-rose-200']">
                    {{ selectedInstrument.change > 0 ? '+' : '' }}{{ selectedInstrument.change }}%
                  </span>
                </div>
              </div>
              <button
                type="button"
                class="mt-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-sky-300/30 hover:bg-sky-300/10 hover:text-white"
                :aria-expanded="isInstrumentPickerOpen"
                aria-controls="investment-company-picker"
                @click="isInstrumentPickerOpen = !isInstrumentPickerOpen"
              >
                {{ isInstrumentPickerOpen ? 'Cerrar selector' : 'Cambiar empresa' }}
                <span aria-hidden="true">{{ isInstrumentPickerOpen ? '−' : '+' }}</span>
              </button>
            </div>

            <div v-if="isInstrumentPickerOpen" id="investment-company-picker" class="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              <button
                v-for="instrument in instruments"
                :key="instrument.symbol"
                type="button"
                :aria-pressed="selectedSymbol === instrument.symbol"
                :class="[
                  'flex min-w-0 items-center justify-between gap-3 rounded-2xl border p-3 text-left transition',
                  selectedSymbol === instrument.symbol
                    ? 'border-sky-300/50 bg-sky-300/10 ring-1 ring-sky-300/20'
                    : 'border-white/10 bg-slate-950/20 hover:border-white/20 hover:bg-white/[0.04]',
                ]"
                @click="selectInstrument(instrument)"
              >
                <span class="flex min-w-0 items-center gap-3">
                  <span :class="['flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xs font-bold', selectedSymbol === instrument.symbol ? 'bg-sky-300/15 text-sky-100' : 'bg-white/[0.06] text-slate-200']">
                    {{ instrument.symbol.slice(0, 2) }}
                  </span>
                  <span class="min-w-0">
                    <span class="block truncate text-sm font-semibold text-white">{{ instrument.name }}</span>
                    <span class="mt-0.5 block text-xs text-slate-400">{{ instrument.symbol }}</span>
                  </span>
                </span>
                <span :class="['shrink-0 text-xs font-medium', instrument.change >= 0 ? 'text-emerald-300' : 'text-rose-300']">
                  {{ instrument.change > 0 ? '+' : '' }}{{ instrument.change }}%
                </span>
              </button>
            </div>

            <div class="grid gap-4 md:grid-cols-2">
            <label class="block">
              <span class="mb-2 block text-sm text-slate-300">Monto (COP)</span>
              <input v-model.number="amount" type="number" min="10000" :max="availableBalance" step="1000" inputmode="numeric" class="w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-white" />
              <span class="mt-1 block text-xs text-slate-400">Mínimo $10.000 · Disponible {{ money(availableBalance) }}</span>
            </label>
            <fieldset class="min-w-0">
              <legend class="mb-2 text-sm text-slate-300">Elige el plazo</legend>
              <div class="grid grid-cols-2 gap-2">
                <button
                  v-for="term in [
                    { days: 7, title: '7 días', detail: 'Corto plazo' },
                    { days: 30, title: '30 días', detail: '1 mes' },
                    { days: 90, title: '90 días', detail: '3 meses' },
                    { days: 180, title: '180 días', detail: '6 meses' },
                  ]"
                  :key="term.days"
                  type="button"
                  :aria-pressed="termDays === term.days"
                  :class="[
                    'rounded-2xl border px-3 py-3 text-left transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300',
                    termDays === term.days
                      ? 'border-sky-300/60 bg-sky-300/10 shadow-[0_0_20px_rgba(56,189,248,0.1)]'
                      : 'border-white/10 bg-slate-950/35 hover:border-white/20 hover:bg-white/[0.04]',
                  ]"
                  @click="termDays = term.days"
                >
                  <span :class="['block text-sm font-semibold', termDays === term.days ? 'text-sky-100' : 'text-slate-100']">
                    {{ term.title }}
                  </span>
                  <span class="mt-1 block text-xs text-slate-400">{{ term.detail }}</span>
                </button>
              </div>
            </fieldset>
            <div class="rounded-2xl border border-sky-300/15 bg-sky-300/5 p-4">
              <p class="text-sm text-slate-300">Estimación al precio de referencia actual</p>
              <p class="mt-2 text-lg font-semibold">{{ estimatedShares.toFixed(6) }} acciones fraccionadas</p>
              <p class="mt-1 text-sm text-slate-400">Plazo hasta {{ dateTime(maturityDate) }}</p>
            </div>
            </div>
          </div>
          <div class="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
            <button
              type="button"
              :disabled="isBuying || !selectedInstrument || Number(amount) < 10000 || Number(amount) > availableBalance"
              class="rounded-full bg-gradient-to-r from-sky-400 to-indigo-500 px-6 py-3 font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
              @click="buy"
            >
              {{ isBuying ? 'Registrando…' : 'Confirmar inversión' }}
            </button>
            <p class="text-xs leading-5 text-slate-400">El monto queda bloqueado hasta el vencimiento. No se puede retirar antes del plazo.</p>
          </div>
          <p v-if="message" role="status" class="mt-4 rounded-xl border border-sky-300/15 bg-sky-300/5 px-4 py-3 text-sm text-sky-100">{{ message }}</p>
        </section>

        <section class="glass-panel rounded-[28px] border p-5 sm:p-6">
          <div class="flex items-center gap-2">
            <CalendarClock class="h-5 w-5 text-sky-200" />
            <h2 class="text-xl font-semibold">Inversiones activas</h2>
          </div>
          <div v-if="!activePositions.length" class="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-sm text-slate-400">
            Cuando confirmes una inversión, aquí verás su valor actualizado, plazo y fecha de retiro.
          </div>
          <div v-else class="mt-4 space-y-3">
            <article v-for="position in activePositions" :key="position.id" class="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div class="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-2">
                    <h3 class="font-semibold">{{ position.name }} <span class="text-slate-400">({{ position.symbol }})</span></h3>
                    <span class="rounded-full bg-amber-300/10 px-2.5 py-1 text-xs text-amber-200">{{ position.canWithdraw ? 'Plazo cumplido' : 'Dinero comprometido' }}</span>
                  </div>
                  <p class="mt-2 text-sm text-slate-400">Invertido {{ money(position.amount) }} · {{ position.shares.toFixed(6) }} acciones fraccionadas</p>
                  <p class="mt-1 flex items-center gap-1.5 text-xs text-slate-400"><Clock3 class="h-3.5 w-3.5" /> Retiro disponible desde {{ dateTime(position.maturesAt) }}</p>
                </div>
                <div class="flex flex-wrap items-center justify-between gap-4 lg:justify-end">
                  <div>
                    <p class="text-xs text-slate-400">Valor actual</p>
                    <p class="mt-1 text-lg font-semibold">{{ money(position.currentValue) }}</p>
                    <p :class="['text-sm', position.profitLoss >= 0 ? 'text-emerald-300' : 'text-rose-300']">
                      {{ position.profitLoss >= 0 ? '+' : '' }}{{ money(position.profitLoss) }} ({{ position.changePercent }}%)
                    </p>
                  </div>
                  <button
                    v-if="position.canWithdraw"
                    type="button"
                    :disabled="busyPositionId === position.id"
                    class="rounded-full bg-emerald-300 px-4 py-2.5 text-sm font-semibold text-slate-950 disabled:opacity-50"
                    @click="withdraw(position)"
                  >
                    {{ busyPositionId === position.id ? 'Procesando…' : `Retirar ${money(position.currentValue)}` }}
                  </button>
                  <span v-else class="text-xs text-slate-400">El retiro se habilita al vencimiento</span>
                </div>
              </div>
            </article>
          </div>
        </section>

        <section v-if="closedPositions.length" class="glass-panel rounded-[28px] border p-5 sm:p-6">
          <div class="flex items-center gap-2">
            <AlertTriangle class="h-5 w-5 text-slate-300" />
            <h2 class="text-xl font-semibold">Inversiones finalizadas</h2>
          </div>
          <div class="mt-4 space-y-3">
            <article v-for="position in closedPositions" :key="position.id" class="flex flex-col justify-between gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:flex-row sm:items-center">
              <div>
                <h3 class="font-semibold">{{ position.name }} ({{ position.symbol }}) · {{ position.termDays }} días</h3>
                <p class="mt-1 text-xs text-slate-400">Retirada el {{ dateTime(position.closedAt) }}</p>
              </div>
              <div class="sm:text-right">
                <p class="text-sm text-slate-300">Invertido {{ money(position.amount) }} · Retirado {{ money(position.payout) }}</p>
                <p :class="['mt-1 text-sm font-medium', position.profitLoss >= 0 ? 'text-emerald-300' : 'text-rose-300']">
                  Resultado: {{ position.profitLoss >= 0 ? '+' : '' }}{{ money(position.profitLoss) }} ({{ position.changePercent }}%)
                </p>
              </div>
            </article>
          </div>
        </section>
      </main>
    </div>
  </div>
</template>

<style scoped>
.investment-candle-chart {
  animation: chart-enter 420ms ease-out both;
}

.investment-candle {
  opacity: 0;
  transform-box: fill-box;
  transform-origin: center bottom;
  animation: candle-enter 460ms cubic-bezier(0.2, 0.75, 0.25, 1) both;
}

.investment-candle line,
.investment-candle rect {
  transition: x 700ms ease, y 700ms ease, x1 700ms ease, x2 700ms ease, y1 700ms ease, y2 700ms ease, fill 250ms ease;
}

.investment-candle:hover {
  filter: brightness(1.35);
}

.investment-chart-axis-label {
  font-size: 11px;
}

@keyframes chart-enter {
  from {
    opacity: 0.35;
    transform: translateY(6px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes candle-enter {
  from {
    opacity: 0;
    transform: scaleY(0.35);
  }

  to {
    opacity: 1;
    transform: scaleY(1);
  }
}

@media (max-width: 640px) {
  .investment-chart-axis-label {
    font-size: 17px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .investment-candle-chart,
  .investment-candle,
  .investment-candle line,
  .investment-candle rect {
    animation: none;
    opacity: 1;
    transform: none;
    transition: none;
  }
}
</style>
