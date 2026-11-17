<script setup>
import { computed, ref } from 'vue'
import { HandCoins } from 'lucide-vue-next'
import { useBankStore } from '@/stores/bank'
import SidebarNav from '@/components/SidebarNav.vue'

const store = useBankStore()
const form = ref({ amount: 100000, term: 6 })
const message = ref('')
const interestByTerm = { 3: 0.10, 6: 0.15, 9: 0.175, 12: 0.20 }
const money = (value) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value)
const currentScore = computed(() => store.currentUser?.trustScore ?? 60)
const creditLimit = computed(() => store.creditAssessment?.limit ?? store.getMaxLoanLimitForTrust(currentScore.value))
const creditLevel = computed(() => store.creditAssessment?.level || (
  currentScore.value >= 90 ? 'Premium' : currentScore.value >= 80 ? 'Avanzado' : currentScore.value >= 70 ? 'Escalada' : 'Base'
))
const simulation = computed(() => {
  const amount = Number(form.value.amount) || 0
  const interest = amount * (interestByTerm[form.value.term] || interestByTerm[6])
  const total = amount + interest
  return { payment: total / form.value.term, total, interest }
})
const loans = computed(() => store.loans.filter((loan) => loan.userId === store.currentUser?.id))
const hasActiveLoan = computed(() => loans.value.some((loan) => loan.status === 'active'))
const request = async () => {
  const result = await store.requestLoan(form.value)
  message.value = result.ok ? 'Crédito aprobado y depositado en tu saldo.' : result.message
}
const pay = async (loanId) => {
  const result = await store.payLoan(loanId)
  message.value = result.ok
    ? result.payment.scoreIncrease
      ? `Crédito liquidado a tiempo. Tu score subió ${result.payment.scoreIncrease} puntos y tu nuevo límite es ${money(store.creditAssessment?.limit || creditLimit.value)}.`
      : 'Pago registrado.'
    : result.message
}
</script>

<template>
  <div class="min-h-screen px-4 pb-10 pt-5 text-white lg:px-6">
    <div class="mx-auto max-w-7xl lg:flex lg:gap-8">
      <SidebarNav />
      <main class="flex-1 space-y-6">
        <header class="glass-panel rounded-[28px] border p-6">
          <p class="text-xs uppercase tracking-[0.25em] text-sky-200/70">FastCredit</p>
          <h1 class="mt-2 text-3xl font-semibold">Crédito</h1>
          <p class="mt-2 text-slate-400">Nivel {{ creditLevel }} · Score {{ currentScore }} · Límite actual {{ money(creditLimit) }} · máximo del programa {{ money(1500000) }}</p>
          <p class="mt-2 text-sm text-slate-400">Empiezas con hasta $100.000 COP. Al liquidar cada crédito dentro del plazo, sumas 10 puntos y puedes avanzar hasta el nivel Premium.</p>
        </header>

        <section class="glass-panel rounded-[30px] border p-5">
          <div class="grid gap-4 md:grid-cols-2">
            <label class="text-sm text-slate-300">Monto<input v-model.number="form.amount" type="number" min="100000" :max="creditLimit" class="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/40 px-3 py-3 text-white" /><span class="mt-1 block text-xs text-slate-400">Desde $100.000 hasta {{ money(creditLimit) }} COP</span></label>
            <label class="text-sm text-slate-300">Plazo<select v-model.number="form.term" class="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/40 px-3 py-3 text-white"><option :value="3">3 meses</option><option :value="6">6 meses</option><option :value="9">9 meses</option><option :value="12">12 meses</option></select></label>
          </div>
          <div class="mt-5 grid gap-3 sm:grid-cols-3">
            <div class="rounded-2xl border border-white/10 bg-white/5 p-4"><span class="text-xs text-slate-400">Cuota</span><strong class="mt-2 block text-xl">{{ money(simulation.payment) }}</strong></div>
            <div class="rounded-2xl border border-white/10 bg-white/5 p-4"><span class="text-xs text-slate-400">Intereses</span><strong class="mt-2 block text-xl text-amber-200">{{ money(simulation.interest) }}</strong></div>
            <div class="rounded-2xl border border-white/10 bg-white/5 p-4"><span class="text-xs text-slate-400">Total</span><strong class="mt-2 block text-xl">{{ money(simulation.total) }}</strong></div>
          </div>
          <button type="button" :disabled="hasActiveLoan" @click="request" class="mt-5 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-emerald-400 to-sky-400 px-5 py-3 font-medium text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"><HandCoins class="h-4 w-4" /> {{ hasActiveLoan ? 'Paga tu crédito activo primero' : 'Solicitar crédito' }}</button>
          <p v-if="message" class="mt-3 text-sm text-sky-200">{{ message }}</p>
        </section>

        <section class="glass-panel rounded-[30px] border p-5">
          <h2 class="text-xl font-semibold">Créditos activos</h2>
          <div class="mt-4 space-y-3">
            <article v-for="loan in loans" :key="loan.id" class="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div class="flex items-center justify-between"><span>{{ money(loan.amount) }}</span><span class="text-amber-200">{{ loan.status === 'paid' ? 'Pagado' : 'Activo' }}</span></div>
              <p class="mt-2 text-xs text-slate-400">{{ loan.term }} meses · saldo pendiente {{ money(loan.remainingBalance) }}</p>
              <button v-if="loan.status === 'active'" type="button" class="mt-3 rounded-full border border-white/10 px-4 py-2 text-sm" @click="pay(loan.id)">Pagar cuota</button>
            </article>
            <p v-if="!loans.length" class="text-sm text-slate-400">No tienes créditos registrados.</p>
          </div>
        </section>
      </main>
    </div>
  </div>
</template>
