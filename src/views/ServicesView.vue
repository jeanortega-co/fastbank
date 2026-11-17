<script setup>
import { computed, ref } from 'vue'
import { ArrowDownToLine, ArrowUpRight, BadgeCheck, Check, ReceiptText, Smartphone, Wallet } from 'lucide-vue-next'
import { billableServices, mobileRechargePlans, serviceCategories } from '@/data/serviceCatalog'
import { useBankStore } from '@/stores/bank'
import SidebarNav from '@/components/SidebarNav.vue'

const store = useBankStore()
const categoryId = ref(serviceCategories[0].id)
const serviceId = ref(billableServices.find((service) => service.category === categoryId.value).id)
const planId = ref('')
const reference = ref('')
const amount = ref('')
const message = ref('')
const paymentSucceeded = ref(false)
const isSubmitting = ref(false)

const services = computed(() => billableServices.filter((service) => service.category === categoryId.value))
const selectedService = computed(() => billableServices.find((service) => service.id === serviceId.value))
const isMobileRecharge = computed(() => selectedService.value?.category === 'mobile')
const plans = computed(() => mobileRechargePlans[serviceId.value] || [])
const selectedPlan = computed(() => plans.value.find((plan) => plan.id === planId.value))
const availableBalance = computed(() => store.currentUser?.balance || 0)
const payments = computed(() => store.transactions
  .filter((transaction) => transaction.userId === store.currentUser?.id && transaction.category === 'Pagos y recargas')
  .slice(0, 8))
const money = (value) => new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
}).format(value || 0)
const dateTime = (value) => new Intl.DateTimeFormat('es-CO', {
  dateStyle: 'medium',
  timeStyle: 'short',
}).format(new Date(value))

const selectCategory = (category) => {
  categoryId.value = category.id
  serviceId.value = billableServices.find((service) => service.category === category.id).id
  planId.value = mobileRechargePlans[serviceId.value]?.[0]?.id || ''
  reference.value = ''
  message.value = ''
  paymentSucceeded.value = false
}

const selectService = (service) => {
  serviceId.value = service.id
  planId.value = mobileRechargePlans[service.id]?.[0]?.id || ''
  reference.value = ''
  message.value = ''
  paymentSucceeded.value = false
}

const submitPayment = async () => {
  if (isMobileRecharge.value && !selectedPlan.value) {
    message.value = 'Selecciona un plan de recarga.'
    paymentSucceeded.value = false
    return
  }
  message.value = ''
  paymentSucceeded.value = false
  isSubmitting.value = true
  const result = await store.payService({
    serviceId: serviceId.value,
    reference: reference.value,
    amount: isMobileRecharge.value ? selectedPlan.value.price : amount.value,
    planId: isMobileRecharge.value ? selectedPlan.value.id : undefined,
  })
  isSubmitting.value = false
  paymentSucceeded.value = result.ok
  message.value = result.ok
    ? 'Pago registrado. Esta operación es una simulación dentro de Fastbank; no se envió al proveedor.'
    : result.message
  if (result.ok) {
    amount.value = ''
  }
}

</script>

<template>
  <div class="min-h-screen px-4 pb-10 pt-5 text-white lg:px-6">
    <div class="mx-auto max-w-7xl lg:flex lg:gap-8">
      <SidebarNav />
      <main class="flex-1 space-y-6">
        <header class="glass-panel rounded-[28px] border p-6">
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p class="text-xs uppercase tracking-[0.25em] text-sky-200/70">Operaciones cotidianas</p>
              <h1 class="mt-2 text-3xl font-semibold">Pagos y recargas</h1>
              <p class="mt-2 max-w-2xl text-slate-400">Organiza desde Fastbank los pagos de servicios públicos, recargas móviles, transporte y suscripciones digitales.</p>
            </div>
            <div class="rounded-2xl border border-sky-400/20 bg-sky-500/10 px-4 py-3">
              <p class="text-xs uppercase tracking-[0.16em] text-sky-200/70">Saldo disponible</p>
              <p class="mt-1 text-xl font-semibold text-white">{{ money(availableBalance) }}</p>
            </div>
          </div>
        </header>

        <section class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Categorías de pagos">
          <button
            v-for="category in serviceCategories"
            :key="category.id"
            type="button"
            :aria-pressed="categoryId === category.id"
            :class="['glass-panel flex items-center gap-3 rounded-2xl border p-4 text-left transition hover:border-sky-300/40', categoryId === category.id ? 'border-sky-300/50 bg-sky-400/10' : 'border-white/10']"
            @click="selectCategory(category)"
          >
            <span class="rounded-xl bg-sky-400/10 p-2 text-sky-200">
              <Smartphone v-if="category.id === 'mobile'" class="h-5 w-5" />
              <ArrowUpRight v-else-if="category.id === 'transport'" class="h-5 w-5" />
              <BadgeCheck v-else-if="category.id === 'subscriptions'" class="h-5 w-5" />
              <ReceiptText v-else class="h-5 w-5" />
            </span>
            <span class="font-medium">{{ category.label }}</span>
          </button>
        </section>

        <div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(300px,0.8fr)]">
          <section class="glass-panel rounded-[30px] border p-5 sm:p-6">
            <div class="flex items-center gap-3">
              <div class="rounded-2xl bg-sky-400/10 p-3 text-sky-200"><Wallet class="h-5 w-5" /></div>
              <div>
                <h2 class="text-xl font-semibold">Realizar un pago o recarga</h2>
                <p class="mt-1 text-sm text-slate-400">Elige el servicio y completa los datos solicitados.</p>
              </div>
            </div>

            <form class="mt-6 space-y-4" @submit.prevent="submitPayment">
              <fieldset class="space-y-2">
                <legend class="text-sm text-slate-300">Selecciona un proveedor o servicio</legend>
                <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <button
                    v-for="service in services"
                    :key="service.id"
                    type="button"
                    :aria-pressed="serviceId === service.id"
                    :class="[
                      'group flex min-h-14 items-center justify-between gap-2 rounded-2xl border px-3 py-3 text-left text-sm font-medium transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300',
                      serviceId === service.id
                        ? 'border-sky-300/60 bg-gradient-to-br from-sky-400/20 to-indigo-500/15 text-white shadow-[0_0_22px_rgba(56,189,248,0.12)]'
                        : 'border-white/10 bg-slate-950/30 text-slate-300 hover:border-sky-300/30 hover:bg-white/[0.04] hover:text-white',
                    ]"
                    @click="selectService(service)"
                  >
                    <span>{{ service.name }}</span>
                    <Check v-if="serviceId === service.id" class="h-4 w-4 shrink-0 text-sky-200" />
                  </button>
                </div>
              </fieldset>

              <fieldset v-if="isMobileRecharge" class="space-y-2">
                <legend class="text-sm text-slate-300">Selecciona un plan de recarga</legend>
                <div class="grid gap-2 sm:grid-cols-2">
                  <button
                    v-for="plan in plans"
                    :key="plan.id"
                    type="button"
                    :aria-pressed="planId === plan.id"
                    :class="[
                      'flex items-center justify-between gap-3 rounded-2xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300',
                      planId === plan.id
                        ? 'border-sky-300/60 bg-gradient-to-br from-sky-400/20 to-indigo-500/15 shadow-[0_0_22px_rgba(56,189,248,0.12)]'
                        : 'border-white/10 bg-slate-950/30 hover:border-sky-300/30 hover:bg-white/[0.04]',
                    ]"
                    @click="planId = plan.id"
                  >
                    <span>
                      <span class="block font-semibold text-white">{{ plan.data }}</span>
                      <span class="mt-1 block text-xs text-slate-400">Vigencia {{ plan.validity }}</span>
                    </span>
                    <span class="shrink-0 text-right">
                      <span class="block font-semibold text-sky-200">{{ money(plan.price) }}</span>
                      <Check v-if="planId === plan.id" class="ml-auto mt-1 h-4 w-4 text-sky-200" />
                    </span>
                  </button>
                </div>
              </fieldset>

              <label class="block space-y-2">
                <span class="text-sm text-slate-300">{{ selectedService?.referenceLabel }}</span>
                <input
                  v-model.trim="reference"
                  required
                  maxlength="120"
                  :inputmode="selectedService?.referenceType === 'phone' ? 'numeric' : 'text'"
                  :autocomplete="selectedService?.referenceType === 'email' ? 'email' : 'off'"
                  :placeholder="selectedService?.referenceType === 'phone' ? 'Ej. 3001234567' : selectedService?.referenceType === 'email' ? 'nombre@correo.com' : 'Ingresa la referencia del servicio'"
                  class="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-white placeholder:text-slate-500"
                />
              </label>

              <label v-if="!isMobileRecharge" class="block space-y-2">
                <span class="text-sm text-slate-300">Monto en pesos colombianos</span>
                <div class="relative">
                  <span class="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">$</span>
                  <input v-model.number="amount" required type="number" min="1000" max="5000000" step="1" placeholder="Ej. 50000" class="w-full rounded-2xl border border-white/10 bg-slate-950/60 py-3 pl-9 pr-4 text-white placeholder:text-slate-500" />
                </div>
                <span class="block text-xs text-slate-500">Monto permitido: $1.000 a $5.000.000 COP.</span>
              </label>

              <p v-if="message" role="status" :class="['rounded-xl border p-3 text-sm', paymentSucceeded ? 'border-sky-300/15 bg-sky-400/5 text-sky-100' : 'border-rose-300/20 bg-rose-400/5 text-rose-200']">{{ message }}</p>
              <button type="submit" :disabled="isSubmitting" class="flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-sky-400 to-indigo-500 px-5 py-3 font-semibold text-slate-950 transition hover:brightness-110 disabled:cursor-wait disabled:opacity-60">
                <ArrowDownToLine class="h-4 w-4" />
                {{ isSubmitting ? 'Procesando…' : 'Confirmar pago' }}
              </button>
            </form>

          </section>

          <section class="glass-panel rounded-[30px] border p-5 sm:p-6">
            <div class="flex items-center justify-between gap-3">
              <div>
                <h2 class="text-xl font-semibold">Actividad reciente</h2>
                <p class="mt-1 text-sm text-slate-400">Tus últimos pagos y recargas.</p>
              </div>
              <ReceiptText class="h-5 w-5 text-sky-200" />
            </div>

            <div v-if="payments.length" class="mt-5 divide-y divide-white/10">
              <article v-for="payment in payments" :key="payment.id" class="flex items-center justify-between gap-3 py-4 first:pt-0 last:pb-0">
                <div class="min-w-0">
                  <p class="truncate font-medium">{{ payment.description }}</p>
                  <p class="mt-1 text-xs text-slate-400">{{ dateTime(payment.date) }}</p>
                </div>
                <p :class="['shrink-0 font-semibold', payment.status === 'Procesado' ? 'text-white' : 'text-rose-300']">−{{ money(payment.amount) }}</p>
              </article>
            </div>
            <div v-else class="mt-6 rounded-2xl border border-dashed border-white/10 p-6 text-center">
              <ReceiptText class="mx-auto h-8 w-8 text-slate-500" />
              <p class="mt-3 font-medium text-slate-300">Aún no tienes pagos</p>
              <p class="mt-1 text-sm text-slate-500">Cuando realices uno, aparecerá aquí.</p>
            </div>
          </section>
        </div>
      </main>
    </div>
  </div>
</template>
