<script setup>
import { computed } from 'vue'
import { Home, Wallet, ArrowLeftRight, ShieldCheck, Landmark, PieChart, Settings, LogOut, Fingerprint, CreditCard, ReceiptText, CircleHelp, Gamepad2 } from 'lucide-vue-next'
import { useRoute, useRouter } from 'vue-router'
import { useBankStore } from '@/stores/bank'

const router = useRouter()
const route = useRoute()
const store = useBankStore()
const logoSrc = `${import.meta.env.BASE_URL}fastbank-logo.png`
const creditLevel = computed(() => {
  const score = store.currentUser?.trustScore || 0
  if (score >= 90) return 'Premium'
  if (score >= 80) return 'Avanzado'
  if (score >= 70) return 'Escalada'
  return 'Base'
})

const items = [
  { label: 'Resumen', icon: Home, route: '/dashboard' },
  { label: 'Transferencias', icon: ArrowLeftRight, route: '/transferencias' },
  { label: 'Pagos y recargas', icon: ReceiptText, route: '/pagos-recargas' },
  { label: 'Bolsillos', icon: Wallet, route: '/bolsillos' },
  { label: 'Crédito', icon: Landmark, route: '/credito' },
  { label: 'Inversiones', icon: PieChart, route: '/inversiones' },
  { label: 'Pedir tarjetas', icon: CreditCard, route: '/pedir-tarjetas' },
  { label: 'Casino', icon: Gamepad2, route: '/casino' },
  { label: 'Ayuda y soporte', icon: CircleHelp, route: '/ayuda' },
  { label: 'Seguridad', icon: ShieldCheck, route: '/seguridad' },
  { label: 'Registrar huella', icon: Fingerprint, route: '/registrar-huella' },
  { label: 'Ajustes', icon: Settings, route: '/ajustes' },
]

const logout = () => {
  store.logout()
  router.push('/login')
}
</script>

<template>
  <aside class="glass-panel sidebar-shell mb-5 block h-auto w-full rounded-3xl border p-3 sm:p-4 lg:sticky lg:top-5 lg:mb-0 lg:flex lg:h-[calc(100vh-2.5rem)] lg:w-72 lg:flex-col">
    <div class="flex items-center gap-3 border-b border-white/10 px-1 pb-4 sm:pb-5">
      <img :src="logoSrc" alt="FastBank" class="brand-logo h-11 w-36 object-cover object-center" />
    </div>

    <nav class="sidebar-nav mt-4 flex gap-2 overflow-x-auto pb-1 sm:mt-6 lg:mt-5 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:gap-2 lg:overflow-x-hidden lg:overflow-y-auto lg:overscroll-contain lg:pb-1">
      <button
        v-for="(item, index) in items"
        :key="item.label"
        type="button"
        :style="{ '--nav-index': index }"
        :class="['flex min-w-max flex-shrink-0 items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm transition hover:bg-white/5 hover:text-white lg:w-full', route.path === item.route ? 'bg-sky-400/15 text-sky-200' : 'text-slate-200']"
        @click="router.push(item.route)"
      >
        <component :is="item.icon" class="h-4 w-4" />
        {{ item.label }}
      </button>
    </nav>

    <div class="mt-4 flex-shrink-0 rounded-2xl border border-sky-400/20 bg-sky-500/5 p-3 sm:mt-8 sm:p-4 lg:mt-4">
      <p class="text-xs uppercase tracking-[0.25em] text-sky-200/70">Puntaje</p>
      <div class="mt-3 flex items-center justify-between">
        <span class="text-2xl font-semibold text-white">{{ store.currentUser?.trustScore || 0 }}</span>
        <span class="rounded-full bg-emerald-500/15 px-2 py-1 text-xs text-emerald-300">{{ creditLevel }}</span>
      </div>
    </div>

    <button
      type="button"
      @click="logout"
      class="mt-4 flex w-full flex-shrink-0 items-center justify-center gap-2 rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-200 transition hover:bg-rose-500/20 sm:mt-6 lg:mt-3"
    >
      <LogOut class="h-4 w-4" /> Cerrar sesión
    </button>
  </aside>
</template>
