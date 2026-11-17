<script setup>
import { onMounted, ref } from 'vue'
import { ArrowUpRight, CircleHelp, LifeBuoy, MessageSquareText, Send } from 'lucide-vue-next'
import { useBankStore } from '@/stores/bank'
import SidebarNav from '@/components/SidebarNav.vue'

const store = useBankStore()
const requests = ref([])
const loadingRequests = ref(true)
const submitting = ref(false)
const errorMessage = ref('')
const successMessage = ref('')
const form = ref({ category: 'cuenta', subject: '', message: '' })

const faqs = [
  {
    question: '¿Qué hago si no puedo ingresar a mi cuenta?',
    answer: 'En la pantalla de inicio de sesión usa “¿Olvidaste tu contraseña?” o “¿Olvidaste tu PIN?”. Recibirás un código de recuperación en el correo registrado.',
  },
  {
    question: '¿Cómo reporto una transferencia que no reconozco?',
    answer: 'Envía una solicitud desde este centro de ayuda, selecciona “Transferencias” e incluye la fecha, el valor y cualquier dato útil. Nunca incluyas tu contraseña, PIN ni códigos de verificación.',
  },
  {
    question: '¿Por qué no se procesó un pago o una recarga?',
    answer: 'Verifica el saldo disponible y que el número o referencia esté bien escrito. Si el movimiento aparece como rechazado o tienes dudas, repórtalo en el formulario de soporte.',
  },
  {
    question: '¿Cómo solicito o consulto el estado de mi tarjeta?',
    answer: 'Entra en “Pedir tarjetas” para solicitar una tarjeta. Las tarjetas virtuales se muestran al activarse y las físicas indican su estado de preparación.',
  },
  {
    question: '¿Cuánto tardan en responder una solicitud?',
    answer: 'La solicitud queda registrada para seguimiento por el equipo de administración. El estado y cualquier respuesta aparecerán en “Mis solicitudes” dentro de esta página.',
  },
]

const statusLabel = (status) => ({
  open: 'Recibida',
  in_progress: 'En revisión',
  resolved: 'Respondida',
}[status] || 'Recibida')

const loadRequests = async () => {
  loadingRequests.value = true
  errorMessage.value = ''
  try {
    requests.value = await store.fetchSupportRequests()
  } catch (error) {
    errorMessage.value = error.message || 'No se pudieron cargar tus solicitudes.'
  } finally {
    loadingRequests.value = false
  }
}

const submitRequest = async () => {
  errorMessage.value = ''
  successMessage.value = ''
  submitting.value = true
  const result = await store.createSupportRequest(form.value)
  submitting.value = false
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  requests.value.unshift(result.request)
  successMessage.value = `Solicitud registrada. Tu número de caso es ${result.request.id.slice(0, 8).toUpperCase()}.`
  form.value = { category: 'cuenta', subject: '', message: '' }
}

onMounted(loadRequests)
</script>

<template>
  <div class="min-h-screen px-4 pb-10 pt-5 text-white lg:px-6">
    <div class="mx-auto max-w-7xl lg:flex lg:gap-8">
      <SidebarNav />
      <main class="flex-1 space-y-6">
        <header class="glass-panel rounded-[28px] border p-6">
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p class="text-xs uppercase tracking-[0.25em] text-sky-200/70">Estamos para ayudarte</p>
              <h1 class="mt-2 text-3xl font-semibold">Centro de ayuda</h1>
              <p class="mt-2 max-w-2xl text-slate-400">Encuentra respuestas rápidas o envía una solicitud para que el equipo pueda darle seguimiento.</p>
            </div>
            <div class="rounded-2xl border border-sky-400/20 bg-sky-500/10 p-4 text-sky-200">
              <LifeBuoy class="h-7 w-7" />
            </div>
          </div>
        </header>

        <div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.85fr)]">
          <section class="glass-panel rounded-[30px] border p-5 sm:p-6">
            <div class="flex items-center gap-3">
              <div class="rounded-2xl bg-sky-400/10 p-3 text-sky-200"><CircleHelp class="h-5 w-5" /></div>
              <div>
                <h2 class="text-xl font-semibold">Preguntas frecuentes</h2>
                <p class="mt-1 text-sm text-slate-400">Respuestas a temas comunes de tu cuenta.</p>
              </div>
            </div>

            <div class="mt-5 space-y-3">
              <details v-for="faq in faqs" :key="faq.question" class="group rounded-2xl border border-white/10 bg-slate-950/30 p-4 open:border-sky-300/30 open:bg-sky-400/[0.04]">
                <summary class="flex cursor-pointer list-none items-center justify-between gap-3 font-medium text-slate-100 [&::-webkit-details-marker]:hidden">
                  {{ faq.question }}
                  <ArrowUpRight class="h-4 w-4 shrink-0 text-sky-200 transition group-open:rotate-45" />
                </summary>
                <p class="mt-3 pr-6 text-sm leading-relaxed text-slate-400">{{ faq.answer }}</p>
              </details>
            </div>
          </section>

          <section class="glass-panel rounded-[30px] border p-5 sm:p-6">
            <div class="flex items-center gap-3">
              <div class="rounded-2xl bg-indigo-400/10 p-3 text-indigo-200"><MessageSquareText class="h-5 w-5" /></div>
              <div>
                <h2 class="text-xl font-semibold">Reportar un inconveniente</h2>
                <p class="mt-1 text-sm text-slate-400">Cuéntanos qué ocurrió y revisa aquí la respuesta.</p>
              </div>
            </div>

            <form class="mt-5 space-y-4" @submit.prevent="submitRequest">
              <label class="block space-y-2">
                <span class="text-sm text-slate-300">Tema</span>
                <select v-model="form.category" required class="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-white">
                  <option value="cuenta">Cuenta y acceso</option>
                  <option value="tarjetas">Tarjetas</option>
                  <option value="pagos">Pagos y recargas</option>
                  <option value="transferencias">Transferencias</option>
                  <option value="credito">Crédito</option>
                  <option value="seguridad">Seguridad</option>
                  <option value="otro">Otro</option>
                </select>
              </label>

              <label class="block space-y-2">
                <span class="text-sm text-slate-300">Asunto</span>
                <input v-model.trim="form.subject" required minlength="4" maxlength="120" placeholder="Resume el motivo de contacto" class="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-white placeholder:text-slate-500" />
              </label>

              <label class="block space-y-2">
                <span class="text-sm text-slate-300">¿Qué sucedió?</span>
                <textarea v-model.trim="form.message" required minlength="10" maxlength="2000" rows="5" placeholder="Describe el inconveniente. No compartas tu contraseña, PIN ni códigos de seguridad." class="w-full resize-y rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-white placeholder:text-slate-500" />
                <span class="block text-xs text-slate-500">De 10 a 2.000 caracteres. Nunca incluyas claves ni códigos.</span>
              </label>

              <p v-if="successMessage" role="status" class="rounded-xl border border-emerald-300/20 bg-emerald-400/5 p-3 text-sm text-emerald-200">{{ successMessage }}</p>
              <p v-if="errorMessage" role="alert" class="rounded-xl border border-rose-300/20 bg-rose-400/5 p-3 text-sm text-rose-200">{{ errorMessage }}</p>
              <button type="submit" :disabled="submitting" class="flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-sky-400 to-indigo-500 px-5 py-3 font-semibold text-slate-950 transition hover:brightness-110 disabled:cursor-wait disabled:opacity-60">
                <Send class="h-4 w-4" />
                {{ submitting ? 'Enviando solicitud…' : 'Enviar a soporte' }}
              </button>
            </form>
          </section>
        </div>

        <section class="glass-panel rounded-[30px] border p-5 sm:p-6">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 class="text-xl font-semibold">Mis solicitudes</h2>
              <p class="mt-1 text-sm text-slate-400">Consulta el estado y las respuestas del equipo.</p>
            </div>
            <span class="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">{{ requests.length }} casos</span>
          </div>

          <p v-if="errorMessage && !requests.length" role="alert" class="mt-4 text-sm text-rose-200">{{ errorMessage }}</p>
          <p v-else-if="loadingRequests" class="mt-5 text-sm text-slate-400">Cargando solicitudes…</p>
          <p v-else-if="!requests.length" class="mt-5 rounded-2xl border border-dashed border-white/10 p-6 text-center text-sm text-slate-400">Todavía no has enviado solicitudes de soporte.</p>
          <div v-else class="mt-5 grid gap-3 lg:grid-cols-2">
            <article v-for="request in requests" :key="request.id" class="rounded-2xl border border-white/10 bg-slate-950/30 p-4">
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p class="text-xs uppercase tracking-wider text-sky-200/70">Caso {{ request.id.slice(0, 8).toUpperCase() }} · {{ request.category }}</p>
                  <h3 class="mt-1 font-semibold">{{ request.subject }}</h3>
                </div>
                <span :class="['rounded-full px-3 py-1 text-xs', request.status === 'resolved' ? 'bg-emerald-400/10 text-emerald-200' : request.status === 'in_progress' ? 'bg-amber-400/10 text-amber-200' : 'bg-sky-400/10 text-sky-200']">{{ statusLabel(request.status) }}</span>
              </div>
              <p class="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-400">{{ request.message }}</p>
              <div v-if="request.response" class="mt-3 rounded-xl border border-emerald-300/15 bg-emerald-400/5 p-3">
                <p class="text-xs font-semibold uppercase tracking-wider text-emerald-200">Respuesta de soporte</p>
                <p class="mt-2 whitespace-pre-wrap text-sm text-slate-200">{{ request.response }}</p>
              </div>
            </article>
          </div>
        </section>
      </main>
    </div>
  </div>
</template>
