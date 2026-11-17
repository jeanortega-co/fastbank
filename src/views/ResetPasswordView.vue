<script setup>
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft, KeyRound } from 'lucide-vue-next'
import { useBankStore } from '@/stores/bank'

const props = defineProps({
  credentialType: {
    type: String,
    default: 'password',
  },
})

const router = useRouter()
const store = useBankStore()
const form = reactive({ email: '', token: '', password: '', confirmPassword: '' })
const step = ref(1)
const errorMessage = ref('')
const successMessage = ref('')
const isSubmitting = ref(false)
const isPinReset = computed(() => props.credentialType === 'pin')
const credentialLabel = computed(() => isPinReset.value ? 'PIN' : 'contraseña')

const requestCode = async () => {
  errorMessage.value = ''
  isSubmitting.value = true
  try {
    const requestReset = isPinReset.value ? store.requestPinReset : store.requestPasswordReset
    const result = await requestReset(form.email.trim())
    if (!result.ok) {
      errorMessage.value = result.message
      return
    }
    step.value = 2
  } finally {
    isSubmitting.value = false
  }
}

const submit = async () => {
  errorMessage.value = ''
  successMessage.value = ''
  if (isPinReset.value && !/^\d{4}$/.test(form.password)) {
    errorMessage.value = 'El PIN debe tener exactamente 4 dígitos.'
    return
  }
  if (!/^\d{5}$/.test(form.token)) {
    errorMessage.value = 'El código debe tener exactamente 5 dígitos.'
    return
  }
  if (form.password !== form.confirmPassword) {
    errorMessage.value = `Los valores de ${credentialLabel.value} no coinciden.`
    return
  }

  isSubmitting.value = true
  try {
    const result = isPinReset.value
      ? await store.resetPin({ email: form.email.trim(), token: form.token.trim(), pin: form.password })
      : await store.resetPassword({ email: form.email.trim(), token: form.token.trim(), password: form.password })
    if (!result.ok) {
      errorMessage.value = result.message
      return
    }
    successMessage.value = result.message
    window.setTimeout(() => router.push('/login'), 1500)
  } finally {
    isSubmitting.value = false
  }
}

const changeEmail = () => {
  errorMessage.value = ''
  form.token = ''
  step.value = 1
}
</script>

<template>
  <main class="auth-page flex min-h-screen items-center justify-center bg-slate-950 px-4 py-10 text-white">
    <section class="glass-panel w-full max-w-lg rounded-[30px] border p-6">
      <div class="mb-6 flex items-center gap-3">
        <div class="rounded-2xl bg-sky-500/10 p-3 text-sky-300"><KeyRound class="h-5 w-5" /></div>
        <div>
          <p class="text-xs uppercase tracking-[0.28em] text-sky-200/70">Fastbank</p>
          <h1 class="mt-1 text-2xl font-semibold">Restablecer {{ credentialLabel }}</h1>
        </div>
      </div>

      <div class="mb-5 flex gap-3 text-xs">
        <span :class="step === 1 ? 'text-sky-200' : 'text-slate-500'">1. Confirma tu correo</span>
        <span :class="step === 2 ? 'text-sky-200' : 'text-slate-500'">2. Código y {{ credentialLabel }}</span>
      </div>

      <form v-if="step === 1" class="space-y-4" @submit.prevent="requestCode">
        <p class="text-sm text-slate-300">
          Escribe el correo asociado a tu cuenta. Enviaremos allí un código temporal para verificarlo.
        </p>
        <label class="block">
          <span class="mb-2 block text-sm text-slate-300">Correo de la cuenta</span>
          <input v-model="form.email" required type="email" autocomplete="email" class="w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-white outline-none focus:border-sky-400" />
        </label>

        <p v-if="errorMessage" role="alert" class="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{{ errorMessage }}</p>

        <button type="submit" :disabled="isSubmitting" class="w-full rounded-2xl bg-gradient-to-r from-sky-400 to-indigo-500 px-4 py-3 font-medium text-slate-950 disabled:opacity-60">
          {{ isSubmitting ? 'Enviando código…' : 'Confirmar correo y enviar código' }}
        </button>
      </form>

      <form v-else class="space-y-4" @submit.prevent="submit">
        <div class="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm text-emerald-100">
          Si <strong>{{ form.email }}</strong> pertenece a una cuenta activa, enviamos un código de verificación. Revisa tu bandeja de entrada y la carpeta de spam. El código vence en 15 minutos.
        </div>
        <button type="button" class="text-sm text-sky-300 hover:text-sky-200" @click="changeEmail">Usar otro correo</button>

        <label class="block">
          <span class="mb-2 block text-sm text-slate-300">Código recibido por correo</span>
          <input v-model="form.token" required type="text" inputmode="numeric" pattern="[0-9]{5}" maxlength="5" autocomplete="one-time-code" class="w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-white outline-none focus:border-sky-400" />
          <span class="mt-1 block text-xs text-slate-400">Ingresa los 5 dígitos recibidos.</span>
        </label>
        <label class="block">
          <span class="mb-2 block text-sm text-slate-300">Nuevo {{ credentialLabel }}</span>
          <input v-model="form.password" required type="password" minlength="4" :maxlength="isPinReset ? 4 : undefined" :inputmode="isPinReset ? 'numeric' : undefined" :autocomplete="isPinReset ? 'off' : 'new-password'" class="w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-white outline-none focus:border-sky-400" />
          <span class="mt-1 block text-xs text-slate-400">{{ isPinReset ? 'Debe contener exactamente 4 dígitos.' : 'Mínimo 4 caracteres.' }}</span>
        </label>
        <label class="block">
          <span class="mb-2 block text-sm text-slate-300">Confirmar {{ credentialLabel }}</span>
          <input v-model="form.confirmPassword" required type="password" minlength="4" :maxlength="isPinReset ? 4 : undefined" :inputmode="isPinReset ? 'numeric' : undefined" :autocomplete="isPinReset ? 'off' : 'new-password'" class="w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-white outline-none focus:border-sky-400" />
        </label>

        <p v-if="errorMessage" role="alert" class="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{{ errorMessage }}</p>
        <p v-if="successMessage" role="status" class="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{{ successMessage }}</p>

        <button type="submit" :disabled="isSubmitting" class="w-full rounded-2xl bg-gradient-to-r from-sky-400 to-indigo-500 px-4 py-3 font-medium text-slate-950 disabled:opacity-60">
          {{ isSubmitting ? 'Restableciendo…' : `Guardar nuevo ${credentialLabel}` }}
        </button>
      </form>

      <button type="button" class="mt-5 inline-flex items-center gap-2 text-sm text-sky-300" @click="router.push('/login')">
        <ArrowLeft class="h-4 w-4" /> Volver al inicio de sesión
      </button>
    </section>
  </main>
</template>
