<script setup>
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft, ArrowRight, Camera, CheckCircle2, Shield } from 'lucide-vue-next'
import { useBankStore } from '@/stores/bank'

const router = useRouter()
const store = useBankStore()
const step = ref(1)
const form = reactive({
  firstName: '',
  lastName: '',
  document: '',
  phone: '',
  email: '',
  birthDate: '',
  emailCode: '',
  password: '',
  pin: '',
})
const documentImage = ref('')
const documentImageName = ref('')
const registrationToken = ref('')
const emailVerified = ref(false)
const errorMessage = ref('')
const statusMessage = ref('')
const isSendingCode = ref(false)
const isVerifyingCode = ref(false)
const isSubmitting = ref(false)
const documentTouched = ref(false)
const phoneTouched = ref(false)

const sanitizeDigits = (field, event) => {
  const value = event.target.value.replace(/\D/g, '').slice(0, 10)
  event.target.value = value
  form[field] = value
}

const validateRegistrationNumbers = () => {
  if (form.document.length < 6) {
    const missing = 6 - form.document.length
    errorMessage.value = `A la cédula le faltan ${missing} ${missing === 1 ? 'número' : 'números'}.`
    return false
  }
  if (form.document.length > 10) {
    errorMessage.value = 'La cédula no puede superar 10 números.'
    return false
  }
  if (form.phone.length < 10) {
    const missing = 10 - form.phone.length
    errorMessage.value = `Al celular le faltan ${missing} ${missing === 1 ? 'número' : 'números'}.`
    return false
  }
  if (!/^3\d{9}$/.test(form.phone)) {
    errorMessage.value = 'El celular debe tener 10 números y comenzar por 3.'
    return false
  }
  return true
}

const requestEmailCode = async () => {
  errorMessage.value = ''
  statusMessage.value = ''
  if (!validateRegistrationNumbers()) return
  isSendingCode.value = true
  try {
    const result = await store.requestRegistrationCode({
      firstName: form.firstName,
      lastName: form.lastName,
      document: form.document,
      phone: form.phone,
      email: form.email,
      birthDate: form.birthDate,
    })
    if (!result.ok) {
      errorMessage.value = result.message
      return
    }
    registrationToken.value = ''
    emailVerified.value = false
    form.emailCode = ''
    statusMessage.value = result.message
    step.value = 2
  } finally {
    isSendingCode.value = false
  }
}

const verifyEmailCode = async () => {
  errorMessage.value = ''
  statusMessage.value = ''
  if (!/^\d{5}$/.test(form.emailCode)) {
    errorMessage.value = 'El código debe tener exactamente 5 dígitos.'
    return
  }

  isVerifyingCode.value = true
  try {
    const result = await store.verifyRegistrationCode({
      email: form.email,
      code: form.emailCode,
    })
    if (!result.ok) {
      errorMessage.value = result.message
      return
    }
    registrationToken.value = result.registrationToken
    emailVerified.value = true
    statusMessage.value = result.message
  } finally {
    isVerifyingCode.value = false
  }
}

const chooseDocument = (event) => {
  errorMessage.value = ''
  documentImage.value = ''
  documentImageName.value = ''
  const file = event.target.files?.[0]
  if (!file) return
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    errorMessage.value = 'El documento debe ser una imagen JPG, PNG o WebP.'
    event.target.value = ''
    return
  }
  if (file.size > 3 * 1024 * 1024) {
    errorMessage.value = 'La imagen del documento no puede superar 3 MB.'
    event.target.value = ''
    return
  }

  const reader = new FileReader()
  reader.onload = () => {
    if (typeof reader.result !== 'string') {
      errorMessage.value = 'No se pudo leer la imagen del documento.'
      return
    }
    documentImage.value = reader.result
    documentImageName.value = file.name
  }
  reader.onerror = () => {
    errorMessage.value = 'No se pudo leer la imagen del documento.'
  }
  reader.readAsDataURL(file)
}

const nextStep = async () => {
  errorMessage.value = ''
  statusMessage.value = ''
  if (step.value === 1) {
    await requestEmailCode()
    return
  }
  if (step.value === 2) {
    if (!emailVerified.value || !registrationToken.value) {
      errorMessage.value = 'Verifica el correo antes de continuar.'
      return
    }
    if (!documentImage.value) {
      errorMessage.value = 'Carga o toma una foto del documento para continuar.'
      return
    }
    step.value = 3
  }
}

const previousStep = () => {
  if (step.value === 2) {
    registrationToken.value = ''
    emailVerified.value = false
    form.emailCode = ''
  }
  step.value -= 1
  errorMessage.value = ''
  statusMessage.value = ''
}

const submit = async () => {
  errorMessage.value = ''
  if (!emailVerified.value || !registrationToken.value) {
    errorMessage.value = 'Verifica el correo antes de crear la cuenta.'
    step.value = 2
    return
  }
  isSubmitting.value = true
  try {
    const result = await store.register({
      firstName: form.firstName,
      lastName: form.lastName,
      document: form.document,
      phone: form.phone,
      email: form.email,
      birthDate: form.birthDate,
      password: form.password,
      pin: form.pin,
      registrationToken: registrationToken.value,
      documentImage: documentImage.value,
    })
    if (!result.ok) {
      errorMessage.value = result.message
      return
    }
    router.push('/dashboard')
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <div class="auth-page min-h-screen bg-slate-950 px-4 py-10 text-white">
    <div class="auth-card mx-auto max-w-5xl rounded-[32px] border border-white/10 bg-slate-900/80 p-6 shadow-2xl">
      <div class="mb-8 flex items-center justify-between gap-4">
        <div>
          <p class="text-xs uppercase tracking-[0.28em] text-sky-200/70">Fastbank</p>
          <h2 class="mt-2 text-3xl font-semibold text-white">Registro de cuenta</h2>
        </div>
        <div class="flex items-center gap-3">
          <button type="button" class="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200 transition hover:bg-white/10" @click="router.push('/')">
            <ArrowLeft class="h-4 w-4" /> Volver al inicio
          </button>
          <div class="flex items-center gap-2 rounded-full border border-sky-400/20 bg-sky-500/10 px-3 py-1.5 text-xs uppercase tracking-[0.25em] text-sky-200">
            <Shield class="h-4 w-4" /> Paso {{ step }} / 3
          </div>
        </div>
      </div>

      <div class="mb-8 grid gap-3 md:grid-cols-3">
        <div :class="['rounded-2xl border px-4 py-3 text-sm', step >= 1 ? 'border-sky-400/30 bg-sky-500/10 text-sky-100' : 'border-white/10 bg-slate-950/50 text-slate-400']">1. Datos</div>
        <div :class="['rounded-2xl border px-4 py-3 text-sm', step >= 2 ? 'border-sky-400/30 bg-sky-500/10 text-sky-100' : 'border-white/10 bg-slate-950/50 text-slate-400']">2. Validación</div>
        <div :class="['rounded-2xl border px-4 py-3 text-sm', step >= 3 ? 'border-sky-400/30 bg-sky-500/10 text-sky-100' : 'border-white/10 bg-slate-950/50 text-slate-400']">3. Seguridad</div>
      </div>

      <form class="space-y-6" @submit.prevent="step === 3 ? submit() : nextStep()">
        <div v-if="step === 1" class="grid gap-5 md:grid-cols-2">
          <label class="block">
            <span class="mb-2 block text-sm text-slate-300">Nombres</span>
            <input v-model.trim="form.firstName" required type="text" placeholder="Escribe tus nombres" autocomplete="given-name" class="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-white outline-none transition-all duration-200 ease-out focus:border-sky-400 focus:shadow-[0_0_0_3px_rgba(56,189,248,0.08)] hover:border-sky-400/35" />
          </label>
          <label class="block">
            <span class="mb-2 block text-sm text-slate-300">Apellidos</span>
            <input v-model.trim="form.lastName" required type="text" placeholder="Escribe tus apellidos" autocomplete="family-name" class="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-white outline-none transition-all duration-200 ease-out focus:border-sky-400 focus:shadow-[0_0_0_3px_rgba(56,189,248,0.08)] hover:border-sky-400/35" />
          </label>
          <label class="block">
            <span class="mb-2 block text-sm text-slate-300">Cédula</span>
            <input v-model="form.document" type="text" inputmode="numeric" maxlength="10" placeholder="Ej. 1002345678" autocomplete="off" :aria-invalid="documentTouched && form.document.length < 6" @input="sanitizeDigits('document', $event)" @blur="documentTouched = true" class="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-white outline-none transition-all duration-200 ease-out focus:border-sky-400 focus:shadow-[0_0_0_3px_rgba(56,189,248,0.08)] hover:border-sky-400/35" />
            <span v-if="documentTouched && form.document.length < 6" class="mt-1 block text-xs text-rose-300">Faltan {{ 6 - form.document.length }} {{ 6 - form.document.length === 1 ? 'número' : 'números' }}.</span>
          </label>
          <label class="block">
            <span class="mb-2 block text-sm text-slate-300">Celular</span>
            <input v-model="form.phone" type="tel" inputmode="numeric" maxlength="10" placeholder="Ej. 3001234567" autocomplete="tel" :aria-invalid="phoneTouched && (form.phone.length < 10 || !form.phone.startsWith('3'))" @input="sanitizeDigits('phone', $event)" @blur="phoneTouched = true" class="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-white outline-none transition-all duration-200 ease-out focus:border-sky-400 focus:shadow-[0_0_0_3px_rgba(56,189,248,0.08)] hover:border-sky-400/35" />
            <span v-if="phoneTouched && form.phone.length < 10" class="mt-1 block text-xs text-rose-300">Faltan {{ 10 - form.phone.length }} {{ 10 - form.phone.length === 1 ? 'número' : 'números' }}.</span>
            <span v-else-if="phoneTouched && !form.phone.startsWith('3')" class="mt-1 block text-xs text-rose-300">El celular debe comenzar por 3.</span>
          </label>
          <label class="block">
            <span class="mb-2 block text-sm text-slate-300">Fecha de nacimiento según tu documento</span>
            <input v-model="form.birthDate" required type="date" autocomplete="bday" class="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-white outline-none transition-all duration-200 ease-out focus:border-sky-400 focus:shadow-[0_0_0_3px_rgba(56,189,248,0.08)] hover:border-sky-400/35" />
            <span class="mt-1 block text-xs text-slate-400">Debes tener 18 años o más.</span>
          </label>
          <label class="block">
            <span class="mb-2 block text-sm text-slate-300">Correo electrónico</span>
            <input v-model.trim="form.email" required type="email" placeholder="nombre@correo.com" autocomplete="email" class="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-white outline-none transition-all duration-200 ease-out focus:border-sky-400 focus:shadow-[0_0_0_3px_rgba(56,189,248,0.08)] hover:border-sky-400/35" />
          </label>
        </div>

        <div v-else-if="step === 2" class="grid gap-5 md:grid-cols-2">
          <section class="rounded-[28px] border border-white/10 bg-slate-950/60 p-5">
            <div class="mb-4 flex items-center gap-3 text-sky-200">
              <Camera class="h-5 w-5" /> Documento oficial
            </div>
            <label class="flex min-h-52 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-2xl border border-dashed border-sky-500/30 bg-sky-500/5 p-4 text-center text-sm text-slate-300 transition hover:bg-sky-500/10">
              <img v-if="documentImage" :src="documentImage" alt="Vista previa del documento" class="mb-3 max-h-36 rounded-lg object-contain" />
              <Camera v-else class="mb-3 h-8 w-8 text-sky-300" />
              <span>{{ documentImageName || 'Cargar o tomar foto del documento' }}</span>
              <span class="mt-2 text-xs text-slate-400">JPG, PNG o WebP · máximo 3 MB</span>
              <input class="sr-only" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" @change="chooseDocument" />
            </label>
          </section>

          <section class="rounded-[28px] border border-white/10 bg-slate-950/60 p-5">
            <div class="mb-4 flex items-center gap-3 text-sky-200">
              <CheckCircle2 class="h-5 w-5" /> Verificación de correo
            </div>
            <p class="mb-4 text-sm text-slate-300">
              Código de 5 dígitos enviado a <strong class="text-white">{{ form.email }}</strong>. Revisa también Spam, Promociones y correo no deseado.
            </p>
            <label class="block">
              <span class="mb-2 block text-sm text-slate-300">Código de verificación</span>
              <input v-model="form.emailCode" required type="text" inputmode="numeric" pattern="[0-9]{5}" maxlength="5" autocomplete="one-time-code" :disabled="emailVerified" placeholder="00000" class="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-white outline-none focus:border-sky-400 disabled:opacity-60" />
            </label>
            <button v-if="!emailVerified" type="button" :disabled="isVerifyingCode" class="mt-4 rounded-full border border-sky-400/30 bg-sky-500/10 px-4 py-2 text-sm text-sky-100 disabled:opacity-60" @click="verifyEmailCode">
              {{ isVerifyingCode ? 'Verificando…' : 'Verificar correo' }}
            </button>
            <button v-if="!emailVerified" type="button" :disabled="isSendingCode" class="ml-3 mt-4 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200 disabled:opacity-60" @click="requestEmailCode">
              {{ isSendingCode ? 'Enviando…' : 'Reenviar código' }}
            </button>
            <p v-else role="status" class="mt-4 flex items-center gap-2 text-sm text-emerald-300">
              <CheckCircle2 class="h-4 w-4" /> Correo verificado
            </p>
          </section>
        </div>

        <div v-else class="grid gap-5 md:grid-cols-2">
          <label class="block">
            <span class="mb-2 block text-sm text-slate-300">PIN de seguridad (4 dígitos)</span>
            <input v-model="form.pin" required type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" placeholder="Ej. 1234" autocomplete="off" class="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-white outline-none transition-all duration-200 ease-out focus:border-sky-400 focus:shadow-[0_0_0_3px_rgba(56,189,248,0.08)] hover:border-sky-400/35" />
          </label>
          <label class="block">
            <span class="mb-2 block text-sm text-slate-300">Contraseña transaccional</span>
            <input v-model="form.password" required type="password" minlength="4" placeholder="Mínimo 4 caracteres" autocomplete="new-password" class="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-white outline-none transition-all duration-200 ease-out focus:border-sky-400 focus:shadow-[0_0_0_3px_rgba(56,189,248,0.08)] hover:border-sky-400/35" />
          </label>
          <div class="md:col-span-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm text-emerald-200">
            <div class="flex items-center gap-2 font-medium"><CheckCircle2 class="h-4 w-4" /> Recomendaciones</div>
            <ul class="mt-3 list-inside list-disc space-y-1 text-emerald-100/80">
              <li>Usa un PIN fácil de recordar, pero distinto para cada canal.</li>
              <li>Tu contraseña transaccional debe ser única y robusta.</li>
              <li>Fastbank protege cada movimiento con validación crediticia y seguridad avanzada.</li>
            </ul>
          </div>
        </div>

        <div v-if="errorMessage" role="alert" class="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {{ errorMessage }}
        </div>
        <div v-if="statusMessage" role="status" class="rounded-2xl border border-sky-400/20 bg-sky-500/5 px-4 py-3 text-sm text-sky-100">
          {{ statusMessage }}
        </div>

        <div class="flex justify-between pt-3">
          <button v-if="step > 1" type="button" class="rounded-full border border-white/10 bg-white/5 px-5 py-2.5 text-sm text-white" @click="previousStep">Anterior</button>
          <div v-else></div>
          <button type="submit" :disabled="isSendingCode || isSubmitting" class="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-sky-400 to-indigo-500 px-5 py-2.5 font-medium text-slate-950 shadow-lg shadow-sky-500/20 disabled:cursor-wait disabled:opacity-60">
            {{ isSendingCode ? 'Enviando código…' : isSubmitting ? 'Creando cuenta…' : step === 3 ? 'Crear cuenta' : 'Siguiente' }}
            <ArrowRight v-if="step !== 3 && !isSendingCode" class="h-4 w-4" />
          </button>
        </div>
      </form>
    </div>
  </div>
</template>
