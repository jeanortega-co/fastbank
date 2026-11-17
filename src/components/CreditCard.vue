<script setup>
import { computed, ref } from 'vue'
import { CreditCard as CreditCardIcon, ShieldCheck, Sparkles, Lock, Unlock, Eye, EyeOff } from 'lucide-vue-next'
import { useBankStore } from '@/stores/bank'

const props = defineProps({
  card: { type: Object, required: true },
  secureMode: { type: Boolean, default: false },
})

const store = useBankStore()
const showCvv = ref(false)
const cvv = ref('')
const cvvLoading = ref(false)
const cvvError = ref('')
const showNumber = ref(false)
const cardLocked = computed(() => props.card.cardLocked)

const toggleCvv = async () => {
  cvvError.value = ''
  if (showCvv.value) {
    showCvv.value = false
    return
  }
  if (!cvv.value) {
    cvvLoading.value = true
    try {
      const result = await store.getCardCvv(props.card.id)
      cvv.value = result.cvv
    } catch (error) {
      cvvError.value = error.message
      return
    } finally {
      cvvLoading.value = false
    }
  }
  showCvv.value = true
}
</script>

<template>
  <div class="relative min-h-[270px] overflow-hidden rounded-[28px] border border-white/15 bg-gradient-to-br from-slate-900 via-sky-950 to-indigo-900 p-5 text-white shadow-2xl sm:min-h-[292px] sm:p-6">
    <div class="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-sky-400/30 blur-2xl" />
    <div class="absolute -left-12 bottom-0 h-28 w-28 rounded-full bg-indigo-400/25 blur-2xl" />

    <div class="relative z-10 flex min-h-[230px] flex-col justify-between sm:min-h-[244px]">
      <div class="flex items-center justify-between">
          <div class="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.22em] text-sky-100/80">
          <Sparkles class="h-4 w-4" /> Fastbank
        </div>
        <div class="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-sky-100/70">
          {{ cardLocked ? 'Bloqueada' : 'Activa' }}
        </div>
      </div>

      <div class="mt-8 space-y-5 sm:mt-10">
        <div class="flex items-center justify-between text-[11px] font-medium uppercase tracking-[0.22em] text-slate-200/80">
          <span>{{ props.card.cardKind === 'credit' ? 'Crédito' : 'Débito' }} · {{ props.card.cardType === 'physical' ? 'Física' : 'Digital' }}</span>
          <ShieldCheck class="h-4 w-4 shrink-0 text-emerald-300" />
        </div>

        <div class="relative flex min-h-14 items-center rounded-xl border border-white/10 bg-black/10 px-3 py-2 pr-12 text-[15px] font-semibold tracking-[0.08em] text-sky-50 sm:text-2xl sm:tracking-[0.2em]">
          <span class="whitespace-nowrap">{{ showNumber ? (card.cardNumber || 'No asignada') : '•••• •••• •••• ••••' }}</span>
          <button type="button" title="Mostrar u ocultar número" class="absolute right-2 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 text-sky-100 transition hover:bg-white/10" :aria-label="showNumber ? 'Ocultar número' : 'Mostrar número'" @click="showNumber = !showNumber">
            <EyeOff v-if="showNumber" class="h-4 w-4" />
            <Eye v-else class="h-4 w-4" />
          </button>
        </div>

        <div class="flex items-end justify-between">
          <div>
            <p class="text-[10px] uppercase tracking-[0.3em] text-slate-300/80">Titular</p>
            <p class="mt-2 text-sm font-medium text-slate-100">{{ card.firstName }} {{ card.lastName }}</p>
            <p class="mt-1 text-[10px] uppercase tracking-[0.16em] text-sky-200/60">Para usar en Fastbank</p>
          </div>
          <div class="text-right">
            <p class="text-[10px] uppercase tracking-[0.3em] text-slate-300/80">CVV</p>
            <p class="mt-2 text-sm font-medium text-slate-100">{{ showCvv ? cvv : '•••' }}</p>
          </div>
        </div>
      </div>

      <div class="mt-8 flex items-center justify-between">
        <div class="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-sky-100/80">
          <CreditCardIcon class="h-4 w-4" /> {{ props.secureMode ? 'Pantalla segura' : 'Ninguna alerta' }}
        </div>
        <button
          type="button"
          class="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white transition hover:bg-white/10"
          :aria-label="showCvv ? 'Ocultar CVV' : 'Mostrar CVV'"
          :disabled="cvvLoading"
          @click="toggleCvv"
        >
          <Lock v-if="!showCvv" class="h-4 w-4" />
          <Unlock v-else class="h-4 w-4" />
          {{ cvvLoading ? 'Cargando…' : showCvv ? 'Ocultar CVV' : 'Ver CVV' }}
        </button>
      </div>
      <p v-if="cvvError" role="alert" class="mt-2 text-right text-xs text-rose-200">{{ cvvError }}</p>
    </div>
  </div>
</template>
