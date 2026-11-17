<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { Bell, Eye, EyeOff, Smartphone, TrendingUp, Wallet, PiggyBank, CircleDollarSign, ArrowUpRight, ArrowDownRight, Shield, Landmark, HandCoins, Send, QrCode, Copy, ScanLine, X } from 'lucide-vue-next'
import QRCode from 'qrcode'
import { Html5Qrcode } from 'html5-qrcode'
import { useBankStore } from '@/stores/bank'
import { parseBankQr } from '@/utils/qr'
import SidebarNav from '@/components/SidebarNav.vue'
import CreditCard from '@/components/CreditCard.vue'
import FinancialChart from '@/components/FinancialChart.vue'
import StatCard from '@/components/ui/StatCard.vue'

const store = useBankStore()
const currentUser = computed(() => store.currentUser)
const secureMode = ref(Boolean(store.currentUser?.secureMode))
const hideBalance = ref(false)
const loanForm = ref({ amount: 100000, term: 6 })
const transferForm = ref({ recipient: '', account: '', recipientId: '', amount: 250000, type: 'third' })
const transferMessage = ref('')
const loanMessage = ref('')
const qrModalOpen = ref(false)
const qrImage = ref('')
const scannerOpen = ref(false)
const scannerMessage = ref('')
const cardLimitInputs = reactive({})
const cardMessage = ref('')
const cardRequests = ref([])
const cardRequestsError = ref('')
const activeCards = computed(() => cardRequests.value.filter((card) => card.cardStatus === 'active'))
const pendingCardRequests = computed(() => cardRequests.value.filter((card) => card.cardStatus === 'pending'))
let transferScanner
const interestRateByTerm = { 3: 0.10, 6: 0.15, 9: 0.175, 12: 0.20 }
const loanSimulator = computed(() => {
  const amount = Number(loanForm.value.amount) || 100000
  const term = Number(loanForm.value.term) || 6
  const interest = amount * (interestRateByTerm[term] || interestRateByTerm[6])
  const total = amount + interest

  return {
    cuotaMensual: total / term,
    totalPagar: total,
    ahorroPagoAnticipado: amount * 0.03,
  }
})

const loanLevels = [
  { label: 'Base', value: 100000, color: 'bg-sky-400' },
  { label: 'Escalada', value: 200000, color: 'bg-indigo-400' },
  { label: 'Avanzado', value: 500000, color: 'bg-violet-400' },
  { label: 'Premium', value: 1500000, color: 'bg-emerald-400' },
]

const formatCurrency = (value) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value)

const summary = computed(() => [
  { title: 'Saldo disponible', value: hideBalance.value ? '••••••' : formatCurrency(store.availableBalance || 0), subtitle: `Total consolidado: ${formatCurrency(store.totalBalance || 0)}`, tone: 'default' },
  { title: 'Ahorro', value: hideBalance.value ? '••••••' : formatCurrency(currentUser.value?.savings || 0), subtitle: 'Meta activa', tone: 'success' },
  { title: 'Inversión', value: hideBalance.value ? '••••••' : formatCurrency(currentUser.value?.investments || 0), subtitle: 'Mercado', tone: 'warning' },
  { title: 'FastCredit', value: hideBalance.value ? '••••••' : formatCurrency(currentUser.value?.creditLimit || 100000), subtitle: 'Límite disponible', tone: 'danger' },
])

const latestTransactions = computed(() => store.transactions.filter((t) => t.userId === currentUser.value?.id).slice(0, 5))

const casinoTransactionLabel = (transaction) => {
  const description = String(transaction?.description || '').trim()
  if (!description || !/AVIATOR/i.test(description)) return description || 'Transacción'
  if (/Premio/i.test(description)) return 'Premio AVIATOR'
  if (/Apuesta/i.test(description)) return 'Apuesta AVIATOR'
  return description
}
const userLoans = computed(() => store.loans.filter((loan) => loan.userId === currentUser.value?.id))
const chartIncome = computed(() => store.transactions.filter((tx) => tx.userId === currentUser.value?.id && tx.type === 'income').slice(0, 7).reverse().map((tx) => tx.amount / 100000))
const chartExpense = computed(() => store.transactions.filter((tx) => tx.userId === currentUser.value?.id && tx.type !== 'income').slice(0, 7).reverse().map((tx) => tx.amount / 100000))

const toggleSecureMode = () => {
  secureMode.value = !secureMode.value
  store.toggleSecureMode()
}

const requestFastCredit = async () => {
  const result = await store.requestLoan({
    amount: loanForm.value.amount,
    term: loanForm.value.term,
  })

  loanMessage.value = result.ok ? 'Crédito aprobado y registrado.' : result.message
  if (result.ok) {
    loanForm.value.amount = Math.max(100000, currentUser.value.creditLimit)
  }
}

const payFastCredit = async (loanId) => {
  const result = await store.payLoan(loanId)
  loanMessage.value = result.ok
    ? result.payment.scoreIncrease
      ? `Crédito liquidado a tiempo: score +${result.payment.scoreIncrease}. Nuevo límite: ${formatCurrency(currentUser.value?.creditLimit || 0)}.`
      : 'Pago registrado.'
    : result.message
}

const submitTransfer = async () => {
  const result = await store.transferMoney({
    recipient: transferForm.value.recipient,
    account: transferForm.value.account,
    recipientId: transferForm.value.recipientId,
    amount: transferForm.value.amount,
    type: transferForm.value.type,
  })

  transferMessage.value = result.ok ? 'Transferencia exitosa.' : result.message
}

const loadCardRequests = async () => {
  cardRequestsError.value = ''
  try {
    const result = await store.fetchCardRequests()
    cardRequests.value = result.requests
  } catch (error) {
    cardRequestsError.value = error.message
  }
}

const toggleCardLock = async (card) => {
  const result = await store.toggleCardLock(card)
  if (!result.ok) {
    cardMessage.value = result.message
    return
  }
  card.cardLocked = result.cardLocked
  cardMessage.value = `Tarjeta ${card.cardLocked ? 'bloqueada' : 'desbloqueada'}.`
}

const saveCardLimit = async (card) => {
  const value = cardLimitInputs[card.id]
  if (value === undefined || value === '' || !Number.isSafeInteger(Number(value))) {
    cardMessage.value = 'Ingresa un límite entero en COP.'
    return
  }
  const result = await store.updateCardLimit(card.id, Number(value))
  cardMessage.value = result.ok ? 'Límite de tarjeta actualizado.' : result.message
  if (result.ok) {
    card.cardLimit = result.cardLimit
    delete cardLimitInputs[card.id]
  }
}

const fillTransferFromQr = (value) => {
  try {
    const data = parseBankQr(value)
    transferForm.value.recipient = data.recipient
    transferForm.value.account = data.account
    transferForm.value.recipientId = data.recipientId
    transferMessage.value = `Cuenta leída: ${data.recipient || data.account}`
  } catch {
    transferMessage.value = 'El QR no pertenece a una cuenta Fastbank válida.'
  }
}

const stopTransferScanner = async () => {
  if (!transferScanner) return
  try {
    if (transferScanner.isScanning) await transferScanner.stop()
    await transferScanner.clear()
  } catch {
    // El navegador puede cerrar la cámara antes de que termine el escáner.
  }
  transferScanner = null
  scannerOpen.value = false
}

const startTransferScanner = async () => {
  scannerMessage.value = ''
  scannerOpen.value = true
  await nextTick()
  try {
    transferScanner = new Html5Qrcode('dashboard-transfer-qr-reader')
    await transferScanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 220, height: 220 } },
      async (decodedText) => {
        fillTransferFromQr(decodedText)
        await stopTransferScanner()
      },
      () => {},
    )
  } catch {
    scannerMessage.value = 'No se pudo acceder a la cámara. Revisa los permisos del navegador.'
    await stopTransferScanner()
  }
}

const generateQrCode = async () => {
  const code = store.generateQrCode()
  if (!code) {
    transferMessage.value = 'No se pudo generar el QR.'
    return
  }
  qrImage.value = await QRCode.toDataURL(code, { width: 320, margin: 3, errorCorrectionLevel: 'M', color: { dark: '#07141f', light: '#ffffff' } })
  qrModalOpen.value = true
}

const renderInitialQr = async () => {
  const code = store.generateQrCode()
  if (code) {
    qrImage.value = await QRCode.toDataURL(code, { width: 320, margin: 3, errorCorrectionLevel: 'M', color: { dark: '#07141f', light: '#ffffff' } })
  }
}

onMounted(() => {
  void renderInitialQr()
  void loadCardRequests()
})
onBeforeUnmount(stopTransferScanner)

const copyQrCode = async () => {
  const text = store.generateQrCode()
  if (!text) {
    transferMessage.value = 'No se pudo generar el QR.'
    return
  }
  await navigator.clipboard.writeText(text)
  transferMessage.value = 'Código QR copiado al portapapeles.'
}
</script>

<template>
  <div class="min-h-screen px-3 pb-10 pt-4 text-white sm:px-4 sm:pt-5 lg:px-6">
    <div class="mx-auto max-w-[1440px] lg:flex lg:gap-6 xl:gap-8">
      <SidebarNav />

      <div class="min-w-0 flex-1 space-y-5 lg:space-y-6">
        <header class="glass-panel rounded-[24px] border p-4 md:p-5">
          <div class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p class="text-xs uppercase tracking-[0.25em] text-sky-200/70">Resumen</p>
              <h1 class="mt-1 text-2xl font-semibold text-white md:text-[28px]">Hola, {{ currentUser?.firstName }}</h1>
              <p class="mt-1 text-sm text-slate-400">Tu panorama financiero, en un solo lugar.</p>
            </div>

            <div class="flex items-center gap-2 md:gap-3">
              <button type="button" title="Mostrar u ocultar saldos" class="rounded-xl border border-white/10 bg-white/5 p-2.5 text-slate-200 transition hover:bg-white/10" @click="hideBalance = !hideBalance">
                <Eye v-if="!hideBalance" class="h-4 w-4" />
                <EyeOff v-else class="h-4 w-4" />
              </button>
              <button type="button" title="Notificaciones" class="rounded-xl border border-white/10 bg-white/5 p-2.5 text-slate-200 transition hover:bg-white/10">
                <Bell class="h-4 w-4" />
              </button>
              <button type="button" title="Modo seguro" class="rounded-xl border border-white/10 bg-white/5 p-2.5 text-slate-200 transition hover:bg-white/10" @click="toggleSecureMode">
                <Shield class="h-4 w-4" />
              </button>
            </div>
          </div>
        </header>

        <section class="grid gap-5 xl:grid-cols-[minmax(0,1.08fr)_minmax(340px,0.92fr)] xl:items-start">
          <div class="min-w-0 space-y-5 lg:space-y-6">
            <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard v-for="item in summary" :key="item.title" :title="item.title" :value="item.value" :subtitle="item.subtitle" :tone="item.tone">
                <template #icon>
                  <Wallet v-if="item.title.includes('Saldo')" class="h-5 w-5 text-sky-300" />
                  <PiggyBank v-else-if="item.title.includes('Ahorro')" class="h-5 w-5 text-emerald-300" />
                  <TrendingUp v-else-if="item.title.includes('Inversión')" class="h-5 w-5 text-amber-300" />
                  <CircleDollarSign v-else class="h-5 w-5 text-rose-300" />
                </template>
              </StatCard>
            </div>

            <div class="glass-panel rounded-[26px] border p-4 sm:p-5">
              <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p class="text-xs uppercase tracking-[0.25em] text-sky-200/70">Tarjetas</p>
                  <h2 class="mt-1 text-lg font-semibold text-white sm:text-xl">Gestión de pagos</h2>
                </div>
                <div class="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-sky-100">
                  <Smartphone class="h-4 w-4" /> Débito + crédito
                </div>
              </div>
              <p v-if="cardRequestsError" role="alert" class="rounded-2xl border border-rose-400/30 bg-rose-500/10 p-4 text-sm text-rose-200">{{ cardRequestsError }}</p>
              <div v-else-if="!cardRequests.length" class="rounded-2xl border border-white/10 bg-slate-950/30 p-5 text-sm text-slate-300">
                <p>Aún no tienes tarjetas. Solicita primero una tarjeta de débito o crédito en formato físico o digital.</p>
                <router-link to="/pedir-tarjetas" class="mt-4 inline-flex rounded-full bg-gradient-to-r from-sky-400 to-indigo-500 px-4 py-2.5 font-medium text-slate-950">Pedir tarjeta</router-link>
              </div>
              <div v-else class="space-y-4">
                <article v-for="card in activeCards" :key="card.id" class="rounded-2xl border border-white/10 bg-slate-950/30 p-3 sm:p-4">
                  <CreditCard :card="card" :secure-mode="secureMode" />
                  <div class="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
                    <div v-if="card.cardKind === 'credit'" class="text-sm text-slate-300">Límite actual <strong class="ml-2 text-white">{{ formatCurrency(card.cardLimit) }}</strong></div>
                    <div v-else class="text-sm text-slate-400">Débito · compras con saldo disponible</div>
                    <template v-if="card.cardKind === 'credit'">
                      <input v-model.number="cardLimitInputs[card.id]" type="number" min="0" max="10000000" placeholder="Nuevo límite" :aria-label="`Nuevo límite para tarjeta ${card.id}`" class="rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-white" />
                      <button type="button" class="rounded-xl border border-white/10 px-4 py-2 text-sm" @click="saveCardLimit(card)">Actualizar límite</button>
                    </template>
                    <button type="button" :class="['rounded-xl border px-4 py-2 text-sm sm:col-start-3', card.cardLocked ? 'border-emerald-400/30 text-emerald-100' : 'border-sky-400/30 text-sky-100']" @click="toggleCardLock(card)">{{ card.cardLocked ? 'Desbloquear tarjeta' : 'Bloquear tarjeta' }}</button>
                  </div>
                </article>
                <article v-for="request in pendingCardRequests" :key="request.id" class="rounded-2xl border border-amber-400/20 bg-amber-500/5 p-4">
                  <p class="font-medium">Tarjeta de {{ request.cardKind === 'credit' ? 'crédito' : 'débito' }} física en preparación</p>
                  <p class="mt-1 text-sm text-slate-300">Lista aproximadamente el {{ request.estimatedReadyAt ? new Date(request.estimatedReadyAt).toLocaleDateString('es-CO') : 'en 7 días' }} y asignada a {{ request.address }}, {{ request.city }}, {{ request.department }}.</p>
                </article>
                <router-link to="/pedir-tarjetas" class="inline-flex rounded-full border border-white/10 px-4 py-2 text-sm text-sky-100 hover:bg-white/5">Pedir otra tarjeta</router-link>
                <p v-if="cardMessage" role="status" class="text-sm text-sky-200">{{ cardMessage }}</p>
              </div>
            </div>

            <div class="glass-panel rounded-[26px] border p-4 sm:p-5">
              <div class="mb-5 flex items-center justify-between">
                <div>
                  <p class="text-xs uppercase tracking-[0.25em] text-sky-200/70">FastCredit</p>
                  <h2 class="mt-1 text-lg font-semibold text-white sm:text-xl">Solicitar préstamo</h2>
                </div>
                <div class="flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-200">
                  <HandCoins class="h-4 w-4" /> desde 100.000 COP
                </div>
              </div>

              <div class="grid gap-4 md:grid-cols-2">
                <label class="block">
                  <span class="mb-2 block text-sm text-slate-300">Monto</span>
                  <input v-model.number="loanForm.amount" type="number" min="100000" :max="currentUser?.creditLimit || 100000" step="50000" class="w-full rounded-2xl border border-white/10 bg-slate-950/40 px-3 py-3 text-white outline-none focus:border-sky-400" />
                </label>
                <label class="block">
                  <span class="mb-2 block text-sm text-slate-300">Plazo</span>
                  <select v-model.number="loanForm.term" class="w-full rounded-2xl border border-white/10 bg-slate-950/40 px-3 py-3 text-white outline-none focus:border-sky-400">
                    <option :value="3">3 meses</option>
                    <option :value="6">6 meses</option>
                    <option :value="9">9 meses</option>
                    <option :value="12">12 meses</option>
                  </select>
                </label>
              </div>

              <div class="mt-5 flex flex-col gap-3 rounded-2xl border border-sky-400/20 bg-sky-500/5 p-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <p class="text-xs uppercase tracking-[0.25em] text-sky-200/70">Límite habilitado</p>
                  <p class="mt-2 text-2xl font-semibold text-white">{{ formatCurrency(currentUser?.creditLimit || 100000) }}</p>
                </div>
                <button type="button" @click="requestFastCredit" class="rounded-full bg-gradient-to-r from-sky-400 to-indigo-500 px-5 py-3 font-medium text-slate-950">Solicitar ahora</button>
              </div>
              <p v-if="loanMessage" class="mt-3 text-sm text-sky-200">{{ loanMessage }}</p>

              <div class="mt-6 space-y-3">
                <div v-for="loan in userLoans" :key="loan.id" class="flex flex-col gap-3 rounded-2xl border border-white/10 bg-slate-950/30 p-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p class="font-medium text-white">{{ formatCurrency(loan.amount) }}</p>
                    <p class="text-xs text-slate-400">Plazo {{ loan.term }} meses</p>
                  </div>
                  <div class="flex items-center gap-2">
                    <span :class="['rounded-full px-2 py-1 text-xs', loan.status === 'paid' ? 'bg-emerald-500/10 text-emerald-200' : 'bg-amber-500/10 text-amber-200']">
                      {{ loan.status === 'paid' ? 'Pagado' : 'Activo' }}
                    </span>
                    <button v-if="loan.status !== 'paid'" type="button" @click="payFastCredit(loan.id)" class="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-sky-100">Pagar</button>
                  </div>
                </div>
              </div>

              <div class="mt-6 rounded-[28px] border border-white/10 bg-slate-950/30 p-4">
                <div class="mb-4 flex items-center justify-between">
                  <div>
                    <p class="text-xs uppercase tracking-[0.25em] text-sky-200/70">Simulador</p>
                    <h3 class="mt-2 text-xl font-semibold text-white">Cuotas y escalamiento</h3>
                  </div>
                  <span class="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-200">Sin penalización</span>
                </div>

                <div class="grid gap-4 md:grid-cols-3">
                  <div class="rounded-2xl border border-white/10 bg-white/5 p-3">
                    <p class="text-xs uppercase tracking-[0.25em] text-slate-400">Cuota mensual</p>
                    <p class="mt-3 text-2xl font-semibold text-white">{{ formatCurrency(loanSimulator.cuotaMensual) }}</p>
                  </div>
                  <div class="rounded-2xl border border-white/10 bg-white/5 p-3">
                    <p class="text-xs uppercase tracking-[0.25em] text-slate-400">Total a pagar</p>
                    <p class="mt-3 text-2xl font-semibold text-white">{{ formatCurrency(loanSimulator.totalPagar) }}</p>
                  </div>
                  <div class="rounded-2xl border border-white/10 bg-white/5 p-3">
                    <p class="text-xs uppercase tracking-[0.25em] text-slate-400">Pago anticipado</p>
                    <p class="mt-3 text-2xl font-semibold text-white">{{ formatCurrency(loanSimulator.ahorroPagoAnticipado) }}</p>
                  </div>
                </div>

                <div class="mt-5">
                  <div class="mb-3 flex items-center justify-between text-xs uppercase tracking-[0.25em] text-slate-400">
                    <span>Límites escalables</span>
                    <span>{{ formatCurrency(currentUser?.creditLimit || 100000) }}</span>
                  </div>
                  <div class="grid gap-3 sm:grid-cols-4">
                    <div v-for="level in loanLevels" :key="level.label" class="rounded-2xl border border-white/10 bg-slate-950/40 p-3">
                      <div :class="['mb-3 h-2 rounded-full', level.color, currentUser?.creditLimit >= level.value ? 'opacity-100' : 'opacity-25']" />
                      <p class="text-xs uppercase tracking-[0.2em] text-slate-400">{{ level.label }}</p>
                      <p class="mt-2 text-lg font-semibold text-white">{{ formatCurrency(level.value) }}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="glass-panel rounded-[26px] border p-4 sm:p-5">
              <div class="mb-5 flex items-center justify-between">
                <div>
                  <p class="text-xs uppercase tracking-[0.25em] text-sky-200/70">Transferencias</p>
                  <h2 class="mt-1 text-lg font-semibold text-white sm:text-xl">Envía dinero rápido</h2>
                </div>
                <button type="button" aria-label="Escanear QR de cuenta" title="Escanear QR de cuenta" class="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-sky-400/30 bg-sky-500/10 text-sky-200 transition hover:border-sky-300 hover:bg-sky-500/20" @click="startTransferScanner">
                  <ScanLine class="h-5 w-5" />
                </button>
              </div>

              <div v-if="scannerOpen" class="mb-5 rounded-2xl border border-sky-400/25 bg-sky-500/5 p-3">
                <div class="mb-3 flex items-center justify-between gap-3">
                  <p class="text-sm text-sky-100">Escanea el QR de la cuenta destino</p>
                  <button type="button" aria-label="Cerrar escáner" class="rounded-lg p-1 text-slate-300 hover:bg-white/10" @click="stopTransferScanner"><X class="h-4 w-4" /></button>
                </div>
                <div id="dashboard-transfer-qr-reader" class="overflow-hidden rounded-xl bg-slate-950/60" />
                <p v-if="scannerMessage" class="mt-2 text-xs text-sky-200">{{ scannerMessage }}</p>
              </div>

              <div class="grid gap-4 md:grid-cols-2">
                <label class="block">
                  <span class="mb-2 block text-sm text-slate-300">Destinatario</span>
                  <input v-model="transferForm.recipient" type="text" class="w-full rounded-2xl border border-white/10 bg-slate-950/40 px-3 py-3 text-white outline-none focus:border-sky-400" />
                </label>
                <label class="block">
                  <span class="mb-2 block text-sm text-slate-300">Cuenta o teléfono</span>
                  <input v-model="transferForm.account" type="text" class="w-full rounded-2xl border border-white/10 bg-slate-950/40 px-3 py-3 text-white outline-none focus:border-sky-400" />
                </label>
                <label class="block md:col-span-2">
                  <span class="mb-2 block text-sm text-slate-300">Monto</span>
                  <input v-model.number="transferForm.amount" type="number" min="1000" step="1000" class="w-full rounded-2xl border border-white/10 bg-slate-950/40 px-3 py-3 text-white outline-none focus:border-sky-400" />
                </label>
              </div>

              <div class="mt-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <button type="button" @click="submitTransfer" class="inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-sky-400 to-indigo-500 px-5 py-3 font-medium text-slate-950">
                  <Send class="h-4 w-4" /> Enviar
                </button>
                <div v-if="transferMessage" class="text-sm text-sky-200">{{ transferMessage }}</div>
              </div>
            </div>
          </div>

          <div class="min-w-0 space-y-5 lg:space-y-6">
            <div class="glass-panel rounded-[26px] border p-4 sm:p-5">
              <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p class="text-xs uppercase tracking-[0.25em] text-sky-200/70">Flujo</p>
                  <h2 class="mt-1 text-lg font-semibold text-white sm:text-xl">Ingresos vs gastos</h2>
                </div>
                <button class="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-sky-100">Mensual</button>
              </div>
              <FinancialChart :income="chartIncome.length ? chartIncome : undefined" :expense="chartExpense.length ? chartExpense : undefined" />
            </div>

            <div class="glass-panel rounded-[26px] border p-4 sm:p-5">
              <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p class="text-xs uppercase tracking-[0.25em] text-sky-200/70">Actividad</p>
                  <h2 class="mt-1 text-lg font-semibold text-white sm:text-xl">Últimas transacciones</h2>
                </div>
                <button class="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-sky-100">Ver todo</button>
              </div>

              <div class="space-y-3">
                <div v-for="tx in latestTransactions" :key="tx.id" class="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-950/30 px-3 py-3">
                  <div class="flex items-center gap-3">
                    <div :class="['rounded-xl p-2', tx.type === 'income' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-rose-500/10 text-rose-300']">
                      <ArrowUpRight v-if="tx.type === 'income'" class="h-4 w-4" />
                      <ArrowDownRight v-else class="h-4 w-4" />
                    </div>
                    <div>
                      <p class="font-medium text-white">{{ casinoTransactionLabel(tx) }}</p>
                      <p class="text-xs text-slate-400">{{ tx.category }} · {{ tx.date }}</p>
                    </div>
                  </div>
                  <p :class="['font-semibold', tx.type === 'income' ? 'text-emerald-300' : 'text-rose-300']">
                    {{ tx.type === 'income' ? '+' : '-' }}{{ formatCurrency(tx.amount) }}
                  </p>
                </div>
              </div>
            </div>

            <div class="glass-panel rounded-[26px] border p-4 sm:p-5">
              <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p class="text-xs uppercase tracking-[0.25em] text-sky-200/70">Pago QR</p>
                  <h2 class="mt-1 text-lg font-semibold text-white sm:text-xl">Recibir dinero</h2>
                </div>
              </div>

              <div class="flex flex-col items-center justify-center gap-4 rounded-3xl border border-dashed border-sky-400/30 bg-slate-950/30 p-5">
                <div class="flex h-40 w-40 items-center justify-center rounded-2xl border border-white/10 bg-white p-3 shadow-lg shadow-sky-950/20">
                  <img v-if="qrImage" :src="qrImage" alt="Código QR de la cuenta Fastbank" class="h-full w-full rounded-lg" />
                  <QrCode v-else class="h-12 w-12 text-sky-700" />
                </div>
                <p class="text-xs text-slate-400">QR activo para {{ currentUser?.firstName }} {{ currentUser?.lastName }}</p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>

    <div v-if="qrModalOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm" @click.self="qrModalOpen = false">
      <section class="qr-modal w-full max-w-sm rounded-[28px] border border-white/15 bg-slate-900 p-6 text-center shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="qr-title">
        <p class="text-xs font-medium uppercase tracking-[0.24em] text-sky-200/70">Fastbank</p>
        <h2 id="qr-title" class="mt-2 text-xl font-semibold text-white">Mi QR</h2>
        <div class="mx-auto mt-5 w-fit rounded-2xl bg-white p-3"><img :src="qrImage" alt="Código QR de pago Fastbank" class="h-56 w-56" /></div>
        <p class="mt-4 font-medium text-white">{{ currentUser?.firstName }} {{ currentUser?.lastName }}</p>
        <p class="mt-1 text-xs text-slate-400">ID de usuario: {{ currentUser?.id }}</p>
        <div class="mt-5 flex gap-3"><button type="button" @click="copyQrCode" class="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-sky-100 transition hover:bg-white/10"><Copy class="mr-2 inline h-4 w-4" />Compartir</button><button type="button" @click="qrModalOpen = false" class="flex-1 rounded-xl bg-sky-400 px-4 py-3 text-sm font-medium text-slate-950">Cerrar</button></div>
      </section>
    </div>
  </div>
</template>
