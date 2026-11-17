<script setup>
import { computed, ref } from 'vue'
import { Lock, Plus } from 'lucide-vue-next'
import { useBankStore } from '@/stores/bank'
import SidebarNav from '@/components/SidebarNav.vue'

const store = useBankStore()
const form = ref({ name: '', goal: '' })
const operation = ref({})
const message = ref('')
const pockets = computed(() => store.currentUser?.pockets || [])
const availableBalance = computed(() => store.currentUser?.balance || 0)
const money = (value) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value)

const create = async () => {
  const result = await store.createPocket(form.value)
  message.value = result.ok ? 'Bolsillo creado.' : result.message
  if (result.ok) form.value = { name: '', goal: '' }
}

const move = async (pocket, action) => {
  const result = await store.updatePocket({ pocketId: pocket.id, action, amount: operation.value[pocket.id] })
  message.value = result.ok ? `${action === 'deposit' ? 'Depósito' : 'Retiro'} aplicado. Saldo disponible actualizado.` : result.message
  if (result.ok) operation.value[pocket.id] = ''
}

const toggleLock = async (pocket) => {
  const result = await store.togglePocketLock(pocket.id)
  message.value = result.ok ? `Bolsillo ${pocket.locked ? 'desbloqueado' : 'bloqueado'}.` : result.message
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
              <p class="text-xs uppercase tracking-[0.25em] text-sky-200/70">Ahorro inteligente</p>
              <h1 class="mt-2 text-3xl font-semibold">Bolsillos</h1>
              <p class="mt-2 text-slate-400">Separa dinero de tu saldo disponible y protégelo.</p>
            </div>
            <div class="rounded-2xl border border-sky-400/20 bg-sky-500/10 px-4 py-3">
              <p class="text-xs uppercase tracking-[0.16em] text-sky-200/70">Saldo disponible</p>
              <p class="mt-1 text-xl font-semibold text-white">{{ money(availableBalance) }}</p>
            </div>
          </div>
        </header>

        <section class="glass-panel rounded-[30px] border p-5">
          <h2 class="text-xl font-semibold">Crear bolsillo</h2>
          <div class="mt-4 grid gap-4 md:grid-cols-3">
            <input v-model.trim="form.name" placeholder="Nombre, por ejemplo Viaje" class="rounded-2xl border border-white/10 bg-slate-950/40 px-3 py-3 text-white" />
            <input v-model.number="form.goal" min="1" type="number" placeholder="Meta" class="rounded-2xl border border-white/10 bg-slate-950/40 px-3 py-3 text-white" />
            <button type="button" @click="create" class="inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-sky-400 to-indigo-500 px-5 py-3 font-medium text-slate-950"><Plus class="h-4 w-4" /> Crear</button>
          </div>
          <p v-if="message" class="mt-3 text-sm text-sky-200">{{ message }}</p>
        </section>

        <section class="grid gap-5 md:grid-cols-2">
          <article v-for="pocket in pockets" :key="pocket.id" class="glass-panel rounded-[30px] border p-5">
            <div class="flex items-start justify-between">
              <div>
                <h2 class="text-xl font-semibold">{{ pocket.name }}</h2>
                <p class="mt-1 text-sm text-slate-400">{{ money(pocket.amount) }} de {{ money(pocket.goal) }}</p>
              </div>
              <Lock :class="pocket.locked ? 'text-rose-300' : 'text-emerald-300'" />
            </div>
            <div class="mt-5 h-2 rounded-full bg-white/10"><div class="h-2 rounded-full bg-sky-400" :style="{ width: `${Math.min(100, pocket.amount / pocket.goal * 100)}%` }" /></div>
            <p class="mt-2 text-sm text-slate-400">{{ (pocket.amount / pocket.goal * 100).toFixed(1) }}% · {{ pocket.locked ? 'Bloqueado' : 'Disponible' }}</p>
            <div class="mt-5 flex gap-2">
              <input v-model.number="operation[pocket.id]" type="number" min="1" placeholder="Monto" class="min-w-0 flex-1 rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-white" />
              <button type="button" @click="move(pocket, 'deposit')" class="rounded-xl bg-sky-400 px-3 py-2 text-sm text-slate-950">Guardar</button>
              <button type="button" @click="move(pocket, 'withdraw')" class="rounded-xl border border-white/10 px-3 py-2 text-sm">Retirar</button>
            </div>
            <button type="button" @click="toggleLock(pocket)" class="mt-3 text-sm text-sky-200">{{ pocket.locked ? 'Desbloquear' : 'Bloquear bolsillo' }}</button>
          </article>
          <p v-if="!pockets.length" class="text-slate-400">Crea tu primer bolsillo.</p>
        </section>
      </main>
    </div>
  </div>
</template>
