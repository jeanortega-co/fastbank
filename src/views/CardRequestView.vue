<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { CreditCard, MapPin, Smartphone } from 'lucide-vue-next'
import { useBankStore } from '@/stores/bank'
import SidebarNav from '@/components/SidebarNav.vue'
import CardView from '@/components/CreditCard.vue'

const store = useBankStore()
const user = computed(() => store.currentUser)
const form = reactive({
  cardKinds: ['debit'],
  cardTypes: ['physical'],
  address: '',
  city: '',
  department: '',
  postalCode: '',
})
const requests = ref([])
const message = ref('')
const errorMessage = ref('')
const isLoading = ref(false)
const isSubmitting = ref(false)
const formatCurrency = (value) => new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
}).format(value || 0)
const existingSelections = computed(() => requests.value.filter((request) =>
  form.cardKinds.includes(request.cardKind) &&
  form.cardTypes.includes(request.cardType) &&
  request.cardStatus !== 'rejected',
))
const hasPhysicalSelection = computed(() => form.cardTypes.includes('physical'))
const creditLimit = 1500000

const loadRequests = async () => {
  isLoading.value = true
  errorMessage.value = ''
  try {
    const result = await store.fetchCardRequests()
    requests.value = result.requests
  } catch (error) {
    errorMessage.value = error.message
  } finally {
    isLoading.value = false
  }
}

const submitRequest = async () => {
  message.value = ''
  errorMessage.value = ''
  if (!form.cardKinds.length || !form.cardTypes.length) {
    errorMessage.value = 'Selecciona al menos un tipo y un formato de tarjeta.'
    return
  }
  isSubmitting.value = true
  try {
    const result = await store.requestCard(form)
    if (!result.ok) {
      errorMessage.value = result.message
      return
    }

    message.value = result.message
    await loadRequests()
  } finally {
    isSubmitting.value = false
  }
}

const cardKindLabel = (cardKind) => cardKind === 'credit' ? 'crédito' : 'débito'
const cardTypeLabel = (cardType) => cardType === 'physical' ? 'física' : 'digital'
const requestStatusLabel = (request) => {
  if (request.cardStatus === 'active') return 'Activa'
  if (request.cardStatus === 'rejected') return 'Rechazada'
  return 'En preparación'
}

onMounted(loadRequests)
</script>

<template>
  <div class="min-h-screen px-4 pb-10 pt-5 text-white lg:px-6">
    <div class="mx-auto max-w-7xl lg:flex lg:gap-8">
      <SidebarNav />
      <main class="flex-1 space-y-6">
        <header class="glass-panel rounded-[28px] border p-6">
          <p class="text-xs uppercase tracking-[0.25em] text-sky-200/70">Tarjetas</p>
          <h1 class="mt-2 text-3xl font-semibold">Pedir tarjetas</h1>
          <p class="mt-2 text-slate-400">Completa tu solicitud. Tus datos de cuenta ya están incluidos.</p>
        </header>

        <section class="glass-panel rounded-[30px] border p-5 sm:p-7">
          <div class="flex items-start gap-3">
            <CreditCard class="mt-1 h-5 w-5 shrink-0 text-sky-300" />
            <div>
              <h2 class="text-xl font-semibold">Solicitud de tarjeta</h2>
              <p class="mt-1 text-sm text-slate-400">Confirma tus datos personales y elige el tipo de tarjeta que necesitas.</p>
            </div>
          </div>

          <form class="mt-6 space-y-6" @submit.prevent="submitRequest">
            <fieldset class="space-y-4">
              <legend class="mb-3 text-sm font-medium text-sky-100">Datos de tu cuenta</legend>
              <div class="grid gap-4 md:grid-cols-2">
                <label class="text-sm text-slate-300">
                  Nombres
                  <input :value="user?.firstName || ''" readonly class="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-slate-300" />
                </label>
                <label class="text-sm text-slate-300">
                  Apellidos
                  <input :value="user?.lastName || ''" readonly class="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-slate-300" />
                </label>
                <label class="text-sm text-slate-300">
                  Cédula
                  <input :value="user?.document || ''" readonly class="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-slate-300" />
                </label>
                <label class="text-sm text-slate-300">
                  Celular
                  <input :value="user?.phone || ''" readonly class="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-slate-300" />
                </label>
                <label class="text-sm text-slate-300 md:col-span-2">
                  Correo electrónico
                  <input :value="user?.email || ''" readonly type="email" class="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-slate-300" />
                </label>
              </div>
              <p class="text-xs text-slate-500">Estos datos vienen de tu perfil. Para cambiarlos, ve a Ajustes.</p>
            </fieldset>

            <fieldset class="space-y-4">
              <legend class="mb-3 text-sm font-medium text-sky-100">¿Qué tarjeta necesitas?</legend>
              <div class="grid gap-3 sm:grid-cols-2">
                <label :class="['flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition', form.cardKinds.includes('debit') ? 'border-sky-400/50 bg-sky-500/10' : 'border-white/10 bg-slate-950/30']">
                  <input v-model="form.cardKinds" type="checkbox" value="debit" class="mt-1 accent-sky-400" />
                  <span><span class="font-medium">Débito</span><span class="mt-1 block text-xs text-slate-400">Para compras con el saldo disponible.</span></span>
                </label>
                <label :class="['flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition', form.cardKinds.includes('credit') ? 'border-sky-400/50 bg-sky-500/10' : 'border-white/10 bg-slate-950/30']">
                  <input v-model="form.cardKinds" type="checkbox" value="credit" class="mt-1 accent-sky-400" />
                  <span><span class="font-medium">Crédito</span><span class="mt-1 block text-xs text-slate-400">Límite disponible: {{ formatCurrency(creditLimit) }}.</span></span>
                </label>
              </div>
            </fieldset>

            <fieldset class="space-y-4">
              <legend class="mb-3 text-sm font-medium text-sky-100">Formato de tarjeta</legend>
              <div class="grid gap-3 sm:grid-cols-2">
                <label :class="['flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition', form.cardTypes.includes('physical') ? 'border-sky-400/50 bg-sky-500/10' : 'border-white/10 bg-slate-950/30']">
                  <input v-model="form.cardTypes" type="checkbox" value="physical" class="mt-1 accent-sky-400" />
                  <span>
                    <span class="flex items-center gap-2 font-medium"><MapPin class="h-4 w-4 text-sky-300" /> Física</span>
                    <span class="mt-1 block text-xs text-slate-400">Lista en aproximadamente 7 días; requiere dirección.</span>
                  </span>
                </label>
                <label :class="['flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition', form.cardTypes.includes('digital') ? 'border-sky-400/50 bg-sky-500/10' : 'border-white/10 bg-slate-950/30']">
                  <input v-model="form.cardTypes" type="checkbox" value="digital" class="mt-1 accent-sky-400" />
                  <span>
                    <span class="flex items-center gap-2 font-medium"><Smartphone class="h-4 w-4 text-sky-300" /> Digital</span>
                    <span class="mt-1 block text-xs text-slate-400">Activación inmediata para usar en Fastbank.</span>
                  </span>
                </label>
              </div>
            </fieldset>

            <fieldset v-if="hasPhysicalSelection" class="space-y-4">
              <legend class="mb-3 text-sm font-medium text-sky-100">Dirección de entrega</legend>
              <div class="grid gap-4 md:grid-cols-2">
                <label class="text-sm text-slate-300 md:col-span-2">
                  Dirección completa
                  <input v-model.trim="form.address" required maxlength="160" autocomplete="street-address" placeholder="Calle, carrera, número, apartamento o indicaciones" class="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-white outline-none focus:border-sky-400" />
                </label>
                <label class="text-sm text-slate-300">
                  Ciudad o municipio
                  <input v-model.trim="form.city" required maxlength="80" autocomplete="address-level2" placeholder="Ej. Bogotá" class="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-white outline-none focus:border-sky-400" />
                </label>
                <label class="text-sm text-slate-300">
                  Departamento
                  <input v-model.trim="form.department" required maxlength="80" autocomplete="address-level1" placeholder="Ej. Cundinamarca" class="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-white outline-none focus:border-sky-400" />
                </label>
                <label class="text-sm text-slate-300 md:col-span-2">
                  Código postal <span class="text-slate-500">(opcional)</span>
                  <input v-model.trim="form.postalCode" maxlength="12" autocomplete="postal-code" placeholder="Código postal" class="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-white outline-none focus:border-sky-400" />
                </label>
              </div>
            </fieldset>

            <div v-if="errorMessage" role="alert" class="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{{ errorMessage }}</div>
            <div v-if="message" role="status" class="rounded-2xl border border-sky-400/20 bg-sky-500/5 px-4 py-3 text-sm text-sky-100">{{ message }}</div>

            <p class="text-xs leading-5 text-slate-500">Las tarjetas y compras son simuladas para uso dentro de Fastbank. Esta aplicación no imprime ni envía una tarjeta física real.</p>
            <p v-if="existingSelections.length" class="text-sm text-amber-200">Las opciones que ya tienes solicitadas se omitirán; se crearán las demás selecciones.</p>
            <button type="submit" :disabled="isSubmitting" class="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-sky-400 to-indigo-500 px-5 py-3 font-medium text-slate-950 disabled:cursor-wait disabled:opacity-60">
              <CreditCard class="h-4 w-4" />
              {{ isSubmitting ? 'Enviando solicitud…' : 'Pedir tarjetas seleccionadas' }}
            </button>
          </form>
        </section>

        <section class="glass-panel rounded-[30px] border p-5 sm:p-7">
          <h2 class="text-xl font-semibold">Mis solicitudes</h2>
          <p v-if="isLoading" class="mt-4 text-sm text-slate-400">Cargando solicitudes…</p>
          <p v-else-if="!requests.length" class="mt-4 text-sm text-slate-400">Todavía no tienes solicitudes de tarjeta.</p>
          <div v-else class="mt-4 space-y-3">
            <article v-for="request in requests" :key="request.id" class="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-950/40 p-4">
              <div>
                <p class="font-medium">Tarjeta de {{ cardKindLabel(request.cardKind) }} {{ cardTypeLabel(request.cardType) }}</p>
                <p v-if="request.cardType === 'physical'" class="mt-1 text-xs text-slate-400">{{ request.address }}, {{ request.city }}, {{ request.department }}</p>
                <p v-if="request.cardType === 'physical' && request.cardStatus === 'pending'" class="mt-1 text-xs text-sky-200">Lista aproximadamente el {{ request.estimatedReadyAt ? new Date(request.estimatedReadyAt).toLocaleDateString('es-CO') : 'en 7 días' }}.</p>
                <p v-if="request.cardType === 'digital' && request.cardStatus === 'active'" class="mt-1 text-xs text-emerald-200">Activada inmediatamente para usar en Fastbank.</p>
                <p class="mt-1 text-xs text-slate-500">{{ new Date(request.createdAt).toLocaleDateString('es-CO') }}</p>
              </div>
              <span :class="['rounded-full px-3 py-1 text-xs', request.cardStatus === 'active' ? 'bg-emerald-400/10 text-emerald-200' : 'bg-amber-400/10 text-amber-200']">{{ requestStatusLabel(request) }}</span>
              <CardView v-if="request.cardStatus === 'active'" :card="request" :secure-mode="store.secureMode" class="w-full" />
            </article>
          </div>
        </section>
      </main>
    </div>
  </div>
</template>
