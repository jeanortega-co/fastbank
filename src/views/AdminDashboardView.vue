<script setup>
import { computed, onMounted, ref } from 'vue'
import { ArrowUpRight, BadgeCheck, BriefcaseBusiness, CreditCard, DollarSign, LifeBuoy, ShieldCheck, Users } from 'lucide-vue-next'
import { useBankStore } from '@/stores/bank'

const store = useBankStore()
const adminUsers = ref([])
const resetMessages = ref({})
const resetErrors = ref({})
const resetLoading = ref({})
const supportRequests = ref([])
const supportDrafts = ref({})
const supportErrors = ref({})
const supportMessages = ref({})
const supportLoading = ref({})
const supportLoadError = ref('')
const users = computed(() => (adminUsers.value.length ? adminUsers.value : store.users).filter((user) => user.role === 'user'))
const loans = computed(() => store.loans)

onMounted(async () => {
  try {
    adminUsers.value = await store.fetchAdminUsers()
  } catch {
    adminUsers.value = []
  }
  try {
    supportRequests.value = await store.fetchAdminSupportRequests()
    supportDrafts.value = Object.fromEntries(supportRequests.value.map((request) => [
      request.id,
      { status: request.status, response: request.response || '' },
    ]))
  } catch (error) {
    supportLoadError.value = error.message || 'No se pudieron cargar las solicitudes de soporte.'
  }
})

const formatCurrency = (value) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value)

const userSummaries = computed(() =>
  users.value.map((user) => {
    const userLoans = (user.loans || loans.value.filter((loan) => loan.userId === user.id)).filter((loan) => loan.status === 'active')
    const debt = userLoans.reduce((sum, loan) => sum + Number(loan.amount || 0), 0)
    const totalBalance =
      Number(user.balance || 0) +
      Number(user.savings || 0) +
      Number(user.investments || 0) +
      (user.pockets || []).reduce((sum, pocket) => sum + Number(pocket.amount || 0), 0)

    return {
      ...user,
      totalBalance,
      debt,
      userLoans,
      transactions: user.transactions || store.transactions.filter((tx) => tx.userId === user.id).slice(0, 4),
    }
  })
)

const totalDebt = computed(() =>
  userSummaries.value.reduce((sum, user) => sum + user.debt, 0)
)

const totalAvailable = computed(() =>
  userSummaries.value.reduce((sum, user) => sum + user.totalBalance, 0)
)

const issuePasswordReset = async (userId) => {
  resetErrors.value[userId] = ''
  resetMessages.value[userId] = ''
  resetLoading.value[userId] = true
  try {
    const result = await store.createPasswordReset(userId)
    if (!result.ok) {
      resetErrors.value[userId] = result.error
      return
    }
    resetMessages.value[userId] = result.message
  } catch (error) {
    resetErrors.value[userId] = error.message
  } finally {
    resetLoading.value[userId] = false
  }
}

const updateSupportRequest = async (request) => {
  const draft = supportDrafts.value[request.id]
  supportErrors.value[request.id] = ''
  supportMessages.value[request.id] = ''
  supportLoading.value[request.id] = true
  const result = await store.updateSupportRequest({ id: request.id, ...draft })
  supportLoading.value[request.id] = false
  if (!result.ok) {
    supportErrors.value[request.id] = result.message
    return
  }
  supportRequests.value = supportRequests.value.map((item) => item.id === request.id ? result.request : item)
  supportMessages.value[request.id] = 'Caso actualizado; el usuario verá la respuesta en su Centro de Ayuda.'
}
</script>

<template>
  <div class="min-h-screen px-4 py-6 text-white lg:px-6">
    <div class="mx-auto max-w-7xl space-y-6">
      <header class="glass-panel rounded-[28px] border p-5">
        <div class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p class="text-xs uppercase tracking-[0.28em] text-sky-200/70">Panel de control</p>
            <h1 class="mt-2 text-3xl font-semibold text-white">Administración Fastbank</h1>
          </div>
          <div class="inline-flex items-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-500/10 px-3 py-1.5 text-xs uppercase tracking-[0.25em] text-emerald-200">
            <BadgeCheck class="h-4 w-4" /> Operación segura
          </div>
        </div>
      </header>

      <section class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <article class="glass-panel rounded-3xl border p-5">
          <div class="flex items-center justify-between">
            <p class="text-xs uppercase tracking-[0.25em] text-slate-300/70">Clientes</p>
            <Users class="h-5 w-5 text-sky-300" />
          </div>
          <h2 class="mt-4 text-3xl font-semibold text-white">{{ users.length }}</h2>
          <p class="mt-2 text-sm text-slate-300/80">Activos en la red</p>
        </article>
        <article class="glass-panel rounded-3xl border p-5">
          <div class="flex items-center justify-between">
            <p class="text-xs uppercase tracking-[0.25em] text-slate-300/70">Saldo disponible</p>
            <DollarSign class="h-5 w-5 text-emerald-300" />
          </div>
          <h2 class="mt-4 text-3xl font-semibold text-white">{{ formatCurrency(totalAvailable) }}</h2>
          <p class="mt-2 text-sm text-slate-300/80">Dinero actual de clientes</p>
        </article>
        <article class="glass-panel rounded-3xl border p-5">
          <div class="flex items-center justify-between">
            <p class="text-xs uppercase tracking-[0.25em] text-slate-300/70">Deuda activa</p>
            <CreditCard class="h-5 w-5 text-amber-300" />
          </div>
          <h2 class="mt-4 text-3xl font-semibold text-white">{{ formatCurrency(totalDebt) }}</h2>
          <p class="mt-2 text-sm text-slate-300/80">Monto pendiente por usuarios</p>
        </article>
        <article class="glass-panel rounded-3xl border p-5">
          <div class="flex items-center justify-between">
            <p class="text-xs uppercase tracking-[0.25em] text-slate-300/70">Riesgo</p>
            <ShieldCheck class="h-5 w-5 text-rose-300" />
          </div>
          <h2 class="mt-4 text-3xl font-semibold text-white">Bajo</h2>
          <p class="mt-2 text-sm text-slate-300/80">Monitoreo continuo</p>
        </article>
      </section>

      <section class="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
        <div class="glass-panel rounded-[30px] border p-5">
          <div class="mb-5 flex items-center justify-between">
            <div>
              <p class="text-xs uppercase tracking-[0.25em] text-sky-200/70">Usuarios</p>
              <h2 class="mt-2 text-xl font-semibold text-white">Resumen financiero por cliente</h2>
            </div>
            <button class="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-sky-100">Revisión completa</button>
          </div>

          <div class="space-y-4">
            <div v-for="user in userSummaries" :key="user.id" class="rounded-2xl border border-white/10 bg-slate-950/30 p-4">
              <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p class="text-lg font-semibold text-white">{{ user.firstName }} {{ user.lastName }}</p>
                  <p class="text-sm text-slate-400">{{ user.email }} · Cédula: {{ user.document }}</p>
                  <p class="mt-1 text-xs tracking-[0.12em] text-sky-200/70">Tarjeta: {{ user.cardNumber || 'No disponible' }}</p>
                </div>
                <div class="flex items-center gap-2">
                  <span class="rounded-full bg-sky-500/10 px-2 py-1 text-xs text-sky-200">Score: {{ user.trustScore }}</span>
                  <span class="rounded-full bg-emerald-500/10 px-2 py-1 text-xs text-emerald-200">{{ user.status }}</span>
                </div>
              </div>

              <div class="mt-3">
                <button type="button" :disabled="resetLoading[user.id]" class="rounded-full border border-amber-400/20 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-200 disabled:opacity-50" @click="issuePasswordReset(user.id)">
                  {{ resetLoading[user.id] ? 'Enviando correo…' : 'Enviar código de restablecimiento por correo' }}
                </button>
                <p v-if="resetMessages[user.id]" role="status" class="mt-2 rounded-xl border border-emerald-400/20 bg-emerald-500/5 p-3 text-xs text-emerald-100">
                  {{ resetMessages[user.id] }} El código vence en 15 minutos.
                </p>
                <p v-if="resetErrors[user.id]" role="alert" class="mt-2 text-xs text-rose-300">{{ resetErrors[user.id] }}</p>
              </div>

              <div class="mt-4 grid gap-3 md:grid-cols-3">
                <div class="rounded-2xl border border-white/10 bg-slate-900/50 p-3">
                  <p class="text-xs uppercase tracking-[0.2em] text-slate-400">Dinero actual</p>
                  <p class="mt-2 text-xl font-semibold text-white">{{ formatCurrency(user.totalBalance) }}</p>
                </div>
                <div class="rounded-2xl border border-white/10 bg-slate-900/50 p-3">
                  <p class="text-xs uppercase tracking-[0.2em] text-slate-400">Debe</p>
                  <p class="mt-2 text-xl font-semibold text-amber-300">{{ formatCurrency(user.debt) }}</p>
                </div>
                <div class="rounded-2xl border border-white/10 bg-slate-900/50 p-3">
                  <p class="text-xs uppercase tracking-[0.2em] text-slate-400">Límite</p>
                  <p class="mt-2 text-xl font-semibold text-sky-300">{{ formatCurrency(user.creditLimit || 0) }}</p>
                </div>
              </div>

              <div class="mt-4 grid gap-3 lg:grid-cols-2">
                <div>
                  <p class="mb-2 text-xs uppercase tracking-[0.2em] text-slate-400">Préstamos activos</p>
                  <div v-if="user.userLoans.length" class="space-y-2">
                    <div v-for="loan in user.userLoans" :key="loan.id" class="rounded-xl border border-amber-500/20 bg-amber-500/5 p-2 text-sm text-amber-100">
                      <p>{{ formatCurrency(loan.amount) }} · {{ loan.term }} meses</p>
                    </div>
                  </div>
                  <p v-else class="text-sm text-slate-400">Sin préstamos activos.</p>
                </div>

                <div>
                  <p class="mb-2 text-xs uppercase tracking-[0.2em] text-slate-400">Últimos movimientos</p>
                  <div v-if="user.transactions.length" class="space-y-2">
                    <div v-for="tx in user.transactions" :key="tx.id" class="rounded-xl border border-white/10 bg-slate-900/40 p-2 text-sm text-slate-200">
                      <div class="flex items-center justify-between gap-3">
                        <span>{{ tx.description }}</span>
                        <span :class="tx.type === 'income' ? 'text-emerald-300' : 'text-rose-300'">{{ tx.type === 'income' ? '+' : '-' }}{{ formatCurrency(tx.amount) }}</span>
                      </div>
                    </div>
                  </div>
                  <p v-else class="text-sm text-slate-400">No hay movimientos recientes.</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="glass-panel rounded-[30px] border p-5">
          <div class="mb-5 flex items-center justify-between">
            <div>
              <p class="text-xs uppercase tracking-[0.25em] text-sky-200/70">Comportamiento</p>
              <h2 class="mt-2 text-xl font-semibold text-white">Rendimiento</h2>
            </div>
            <BriefcaseBusiness class="h-5 w-5 text-indigo-300" />
          </div>

          <div class="space-y-4">
            <div>
              <div class="mb-2 flex items-center justify-between text-sm text-slate-300"><span>Usuarios activos</span><span>89%</span></div>
              <div class="h-2.5 rounded-full bg-slate-800"><div class="h-full w-[89%] rounded-full bg-gradient-to-r from-sky-400 to-indigo-500" /></div>
            </div>
            <div>
              <div class="mb-2 flex items-center justify-between text-sm text-slate-300"><span>Pagos a tiempo</span><span>94%</span></div>
              <div class="h-2.5 rounded-full bg-slate-800"><div class="h-full w-[94%] rounded-full bg-gradient-to-r from-emerald-400 to-teal-500" /></div>
            </div>
            <div>
              <div class="mb-2 flex items-center justify-between text-sm text-slate-300"><span>Microcréditos aprobados</span><span>72%</span></div>
              <div class="h-2.5 rounded-full bg-slate-800"><div class="h-full w-[72%] rounded-full bg-gradient-to-r from-amber-400 to-orange-500" /></div>
            </div>
          </div>
        </div>
      </section>

      <section class="glass-panel rounded-[30px] border p-5 sm:p-6">
        <div class="flex items-center gap-3">
          <div class="rounded-2xl bg-sky-400/10 p-3 text-sky-200"><LifeBuoy class="h-5 w-5" /></div>
          <div>
            <p class="text-xs uppercase tracking-[0.25em] text-sky-200/70">Atención al cliente</p>
            <h2 class="mt-1 text-xl font-semibold">Solicitudes de soporte</h2>
          </div>
        </div>

        <p v-if="supportLoadError" role="alert" class="mt-4 rounded-xl border border-rose-300/20 bg-rose-400/5 p-3 text-sm text-rose-200">{{ supportLoadError }}</p>
        <p v-else-if="!supportRequests.length" class="mt-4 rounded-2xl border border-dashed border-white/10 p-6 text-center text-sm text-slate-400">No hay solicitudes de soporte registradas.</p>
        <div v-else class="mt-5 space-y-4">
          <article v-for="request in supportRequests" :key="request.id" class="rounded-2xl border border-white/10 bg-slate-950/30 p-4">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p class="text-xs uppercase tracking-wider text-sky-200/70">Caso {{ request.id.slice(0, 8).toUpperCase() }} · {{ request.category }}</p>
                <h3 class="mt-1 font-semibold">{{ request.subject }}</h3>
                <p class="mt-1 text-sm text-slate-400">{{ request.firstName }} {{ request.lastName }} · {{ request.email }}</p>
              </div>
              <span class="rounded-full bg-white/5 px-3 py-1 text-xs text-slate-300">{{ request.status === 'resolved' ? 'Respondida' : request.status === 'in_progress' ? 'En revisión' : 'Recibida' }}</span>
            </div>
            <p class="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-300">{{ request.message }}</p>

            <div class="mt-4 grid gap-3 md:grid-cols-[180px_minmax(0,1fr)]">
              <label class="space-y-2 text-sm text-slate-300">
                Estado
                <select v-model="supportDrafts[request.id].status" class="block w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-white">
                  <option value="open">Recibida</option>
                  <option value="in_progress">En revisión</option>
                  <option value="resolved">Respondida</option>
                </select>
              </label>
              <label class="space-y-2 text-sm text-slate-300">
                Respuesta para el usuario
                <textarea v-model.trim="supportDrafts[request.id].response" maxlength="2000" rows="2" placeholder="Escribe una respuesta o indica qué información se necesita." class="block w-full resize-y rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-white placeholder:text-slate-500" />
              </label>
            </div>
            <p v-if="supportMessages[request.id]" role="status" class="mt-3 text-sm text-emerald-200">{{ supportMessages[request.id] }}</p>
            <p v-if="supportErrors[request.id]" role="alert" class="mt-3 text-sm text-rose-200">{{ supportErrors[request.id] }}</p>
            <button type="button" :disabled="supportLoading[request.id]" class="mt-3 rounded-full bg-sky-400 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-sky-300 disabled:opacity-50" @click="updateSupportRequest(request)">
              {{ supportLoading[request.id] ? 'Guardando…' : 'Guardar seguimiento' }}
            </button>
          </article>
        </div>
      </section>
    </div>
  </div>
</template>
