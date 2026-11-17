<script setup>
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft, Eye, EyeOff, Fingerprint, LockKeyhole, ShieldCheck } from 'lucide-vue-next'
import {
  browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill,
  startAuthentication,
  WebAuthnAbortService,
} from '@simplewebauthn/browser'
import { useBankStore } from '@/stores/bank'

const router = useRouter()
const store = useBankStore()
const logoSrc = `${import.meta.env.BASE_URL}fastbank-logo.png`
const form = reactive({ identifier: '', password: '', pin: '', code: '' })
const isPasswordVisible = ref(false)
const errorMessage = ref('')
const requiresTwoFactor = ref(false)
const isSubmitting = ref(false)
const isPasskeyBusy = ref(false)
const canUsePasskeys = ref(false)
let pageActive = true
let conditionalPasskeyActive = false

const openSession = async (result) => {
  await router.push(result.user.role === 'admin' ? '/admin' : '/dashboard')
}

const submit = async () => {
  if (isSubmitting.value) return
  WebAuthnAbortService.cancelCeremony()
  errorMessage.value = ''
  isSubmitting.value = true
  try {
    const result = await store.login({
      identifier: form.identifier.trim(),
      password: form.password,
      pin: form.pin,
      code: form.code.trim(),
    })

    if (!result.ok) {
      requiresTwoFactor.value = Boolean(result.requiresTwoFactor)
      errorMessage.value = result.message || 'No se pudo iniciar sesión. Revisa tus datos e inténtalo de nuevo.'
      return
    }

    await openSession(result)
  } catch {
    errorMessage.value = 'Ocurrió un error al iniciar sesión. Inténtalo de nuevo.'
  } finally {
    isSubmitting.value = false
  }
}

const signInWithPasskey = async ({ conditional = false } = {}) => {
  if (conditional) {
    if (conditionalPasskeyActive || isPasskeyBusy.value || isSubmitting.value) return
    conditionalPasskeyActive = true
  } else {
    if (isPasskeyBusy.value || isSubmitting.value) return
    WebAuthnAbortService.cancelCeremony()
    isPasskeyBusy.value = true
    errorMessage.value = ''
  }

  try {
    const { challengeId, options } = await store.getPasskeyAuthenticationOptions()
    const response = await startAuthentication({ optionsJSON: options, useBrowserAutofill: conditional })
    if (!pageActive) return
    const result = await store.loginWithPasskey({ challengeId, response })
    await openSession(result)
  } catch (error) {
    if (!conditional && pageActive && error?.name !== 'AbortError') {
      errorMessage.value = error.message || 'No se pudo iniciar sesión con la passkey.'
    }
  } finally {
    if (conditional) conditionalPasskeyActive = false
    else isPasskeyBusy.value = false
  }
}

onMounted(async () => {
  if (!window.isSecureContext) return
  try {
    canUsePasskeys.value = await browserSupportsWebAuthn()
    if (canUsePasskeys.value && await browserSupportsWebAuthnAutofill()) {
      void signInWithPasskey({ conditional: true })
    }
  } catch {
    canUsePasskeys.value = false
  }
})

onBeforeUnmount(() => {
  pageActive = false
  WebAuthnAbortService.cancelCeremony()
})
</script>

<template>
  <div class="auth-page min-h-screen bg-slate-950 px-4 py-10 text-white">
    <div class="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[1fr_1fr] lg:items-center">
      <div class="auth-hero rounded-[32px] border border-white/10 bg-gradient-to-br from-sky-500/20 via-slate-900 to-indigo-500/10 p-6 shadow-2xl">
        <div class="mb-6 inline-flex items-center gap-2 rounded-full border border-sky-400/30 bg-sky-500/10 px-3 py-1.5 text-xs uppercase tracking-[0.25em] text-sky-100/80">
          <ShieldCheck class="h-4 w-4" /> Seguridad bancaria
        </div>
        <h2 class="text-4xl font-semibold">Accede a tu ecosistema financiero.</h2>
        <p class="mt-4 max-w-md text-slate-300/80">Gestiona transferencias, ahorro, inversiones y microcréditos desde una sola experiencia segura y elegante.</p>

        <div class="mt-8 space-y-4 animate-[fadeIn_0.35s_ease-out]">
          <div class="rounded-2xl border border-white/10 bg-slate-900/40 p-4 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-sky-400/40">
            <p class="text-xs uppercase tracking-[0.28em] text-slate-400">Usuario</p>
            <p class="mt-2 text-lg font-medium text-white">Accede con tu correo o documento</p>
          </div>
          <div class="rounded-2xl border border-white/10 bg-slate-900/40 p-4 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-sky-400/40">
            <p class="text-xs uppercase tracking-[0.28em] text-slate-400">Administrador</p>
            <p class="mt-2 text-lg font-medium text-white">Ingreso protegido para gestión interna</p>
          </div>
        </div>
      </div>

      <div class="glass-panel rounded-[30px] border p-6">
        <div class="mb-8 flex items-center justify-between">
          <div>
            <img :src="logoSrc" alt="FastBank" class="brand-logo h-8 w-36 object-cover object-center" />
            <h3 class="mt-2 text-3xl font-semibold text-white">Iniciar sesión</h3>
          </div>
          <button v-if="canUsePasskeys" type="button" aria-label="Iniciar sesión con huella o passkey" title="Iniciar sesión con huella o passkey" :disabled="isPasskeyBusy" class="rounded-2xl bg-sky-500/10 p-3 text-sky-300 transition hover:bg-sky-500/20 disabled:opacity-50" @click="signInWithPasskey()">
            <Fingerprint class="h-5 w-5" />
          </button>
          <div v-else class="rounded-2xl bg-sky-500/10 p-3 text-sky-300" aria-hidden="true"><Fingerprint class="h-5 w-5" /></div>
        </div>

        <form class="space-y-5" @submit.prevent="submit">
          <label class="block animate-[fadeIn_0.25s_ease-out]">
            <span class="mb-2 block text-sm text-slate-300">Correo o documento</span>
            <input v-model="form.identifier" required type="text" autocomplete="username webauthn" spellcheck="false" class="w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-white outline-none ring-0 transition-all duration-200 ease-out focus:border-sky-400 focus:shadow-[0_0_0_3px_rgba(56,189,248,0.08)] hover:border-sky-400/35" placeholder="Ingresa tu correo o documento" />
          </label>

          <label class="block animate-[fadeIn_0.3s_ease-out]">
            <span class="mb-2 block text-sm text-slate-300">Contraseña</span>
            <div class="relative">
              <input v-model="form.password" required :type="isPasswordVisible ? 'text' : 'password'" autocomplete="current-password" spellcheck="false" class="w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 pr-11 text-white outline-none transition-all duration-200 ease-out focus:border-sky-400 focus:shadow-[0_0_0_3px_rgba(56,189,248,0.08)] hover:border-sky-400/35" placeholder="Escribe tu contraseña" />
              <button type="button" class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 transition-transform duration-200 hover:scale-110" @click="isPasswordVisible = !isPasswordVisible">
                <Eye v-if="!isPasswordVisible" class="h-5 w-5" />
                <EyeOff v-else class="h-5 w-5" />
              </button>
            </div>
          </label>

          <label class="block animate-[fadeIn_0.35s_ease-out]">
            <span class="mb-2 block text-sm text-slate-300">PIN rápido</span>
            <div class="relative">
              <input v-model="form.pin" type="password" maxlength="4" autocomplete="off" spellcheck="false" class="w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 pr-11 text-white outline-none transition-all duration-200 ease-out focus:border-sky-400 focus:shadow-[0_0_0_3px_rgba(56,189,248,0.08)] hover:border-sky-400/35" placeholder="1234" />
              <LockKeyhole class="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            </div>
          </label>

          <label v-if="requiresTwoFactor" class="block animate-[fadeIn_0.35s_ease-out]">
            <span class="mb-2 block text-sm text-slate-300">Código de autenticación</span>
            <input v-model="form.code" required inputmode="numeric" maxlength="6" autocomplete="one-time-code" class="w-full rounded-2xl border border-sky-400/30 bg-slate-950/50 px-4 py-3 text-white outline-none transition-all duration-200 ease-out focus:border-sky-400" placeholder="Código de 6 dígitos" />
          </label>

          <div v-if="errorMessage" role="alert" class="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {{ errorMessage }}
          </div>

          <button type="submit" :disabled="isSubmitting" class="w-full rounded-2xl bg-gradient-to-r from-sky-400 to-indigo-500 px-4 py-3 font-medium text-slate-950 shadow-lg shadow-sky-500/20 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-sky-500/30 active:translate-y-0 disabled:cursor-wait disabled:opacity-70">
            {{ isSubmitting ? 'Iniciando sesión…' : 'Entrar a Fastbank' }}
          </button>
        </form>

        <p class="mt-4 text-center text-sm">
          <button type="button" class="font-medium text-sky-300 hover:text-sky-200" @click="router.push('/restablecer-contrasena')">¿Olvidaste tu contraseña?</button>
        </p>
        <p class="mt-2 text-center text-sm">
          <button type="button" class="font-medium text-sky-300 hover:text-sky-200" @click="router.push('/restablecer-pin')">¿Olvidaste tu PIN?</button>
        </p>

        <p class="mt-6 text-center text-sm text-slate-300/70">
          ¿No tienes cuenta?
          <button type="button" class="ml-2 font-medium text-sky-300" @click="router.push('/register')">Regístrate</button>
        </p>
        <button type="button" class="mx-auto mt-4 inline-flex items-center gap-2 text-sm text-slate-300 transition hover:text-white" @click="router.push('/')">
          <ArrowLeft class="h-4 w-4" /> Volver al inicio
        </button>
      </div>
    </div>
  </div>
</template>
