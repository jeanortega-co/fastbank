<script setup>
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { ImagePlus, ScanLine, Search, Send, X } from 'lucide-vue-next'
import { Html5Qrcode } from 'html5-qrcode'
import { useBankStore } from '@/stores/bank'
import { parseBankQr } from '@/utils/qr'
import SidebarNav from '@/components/SidebarNav.vue'

const store = useBankStore()
const form = ref({ recipient: '', account: '', recipientId: '', amount: '', type: 'third' })
const message = ref('')
const search = ref('')
const scannerOpen = ref(false)
const scannerMessage = ref('')
const submitting = ref(false)
const imageInput = ref(null)
let scanner

const userTransfers = computed(() => store.transactions
  .filter((tx) => tx.userId === store.currentUser?.id && (tx.type === 'transfer' || tx.category === 'Transferencias'))
  .filter((tx) => tx.description.toLowerCase().includes(search.value.toLowerCase())))
const money = (value) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value)

const fillFromQr = (value) => {
  try {
    const data = parseBankQr(value)
    form.value.recipient = data.recipient
    form.value.account = data.account
    form.value.recipientId = data.recipientId
    scannerMessage.value = `Cuenta leída: ${form.value.recipient || form.value.account}`
    return true
  } catch {
    scannerMessage.value = 'Este QR no pertenece a una cuenta Fastbank válida.'
    return false
  }
}

const stopScanner = async () => {
  if (!scanner) {
    scannerOpen.value = false
    return
  }
  try {
    if (scanner.isScanning) await scanner.stop()
    await scanner.clear()
  } catch {
    // La cámara puede haber sido cerrada por el navegador.
  }
  scanner = null
  scannerOpen.value = false
}

const startScanner = async () => {
  scannerMessage.value = ''
  scannerOpen.value = true
  await nextTick()
  if (!window.isSecureContext) {
    scannerMessage.value = 'La cámara requiere una conexión segura (HTTPS) o acceder desde localhost. También puedes cargar una imagen del QR.'
    scannerOpen.value = false
    return
  }

  try {
    scanner = new Html5Qrcode('transfer-qr-reader')
    const cameras = await Html5Qrcode.getCameras()
    if (!cameras.length) {
      scannerMessage.value = 'No se encontró una cámara disponible. Puedes cargar una imagen del QR.'
      await stopScanner()
      return
    }
    const preferredCamera = cameras.find((camera) => /back|rear|environment|trasera/i.test(camera.label)) || cameras.at(-1)
    await scanner.start(
      preferredCamera.id,
      { fps: 10, qrbox: { width: 220, height: 220 } },
      async (decodedText) => {
        const valid = fillFromQr(decodedText)
        await stopScanner()
        if (valid) message.value = 'Datos del destinatario cargados desde el QR.'
      },
      () => {},
    )
  } catch (error) {
    if (error?.name === 'NotAllowedError' || /permission|notallowed/i.test(String(error))) {
      scannerMessage.value = 'No se concedió permiso para usar la cámara. Autorízalo en el navegador o carga una imagen del QR.'
    } else if (error?.name === 'NotFoundError' || /notfound|no camera|devicesnotfound/i.test(String(error))) {
      scannerMessage.value = 'No se encontró una cámara disponible. Puedes cargar una imagen del QR.'
    } else if (error?.name === 'NotReadableError' || /notreadable|trackstart/i.test(String(error))) {
      scannerMessage.value = 'La cámara está siendo usada por otra aplicación. Ciérrala o carga una imagen del QR.'
    } else {
      scannerMessage.value = 'No se pudo abrir la cámara. Revisa sus permisos y que ninguna otra aplicación la esté usando.'
    }
    await stopScanner()
  }
}

const selectQrImage = () => imageInput.value?.click()

const scanQrImage = async (event) => {
  const file = event.target.files?.[0]
  if (!file) return
  if (!file.type.startsWith('image/')) {
    scannerMessage.value = 'Selecciona un archivo de imagen para leer el código QR.'
    event.target.value = ''
    return
  }
  scannerMessage.value = ''
  scannerOpen.value = true
  await nextTick()
  try {
    scanner = new Html5Qrcode('transfer-qr-reader')
    const decodedText = await scanner.scanFile(file, false)
    const valid = fillFromQr(decodedText)
    await stopScanner()
    if (valid) message.value = 'Datos del destinatario cargados desde la imagen.'
  } catch {
    scannerMessage.value = 'No se pudo leer un código QR en esa imagen. Prueba con una foto más nítida y completa.'
    await stopScanner()
  } finally {
    event.target.value = ''
  }
}

const submit = async () => {
  if (submitting.value) return
  submitting.value = true
  try {
    const result = await store.transferMoney(form.value)
    message.value = result.ok ? 'Transferencia procesada correctamente.' : result.message
    if (result.ok) form.value = { recipient: '', account: '', recipientId: '', amount: '', type: 'third' }
  } finally {
    submitting.value = false
  }
}

onBeforeUnmount(stopScanner)
</script>

<template>
  <div class="min-h-screen px-4 pb-10 pt-5 text-white lg:px-6">
    <div class="mx-auto max-w-7xl lg:flex lg:gap-8">
      <SidebarNav />
      <main class="flex-1 space-y-6">
        <header class="glass-panel rounded-[28px] border p-6">
          <p class="text-xs uppercase tracking-[0.25em] text-sky-200/70">Operaciones</p>
          <h1 class="mt-2 text-3xl font-semibold">Transferencias</h1>
          <p class="mt-2 text-slate-400">Saldo disponible: {{ money(store.currentUser?.balance || 0) }}</p>
        </header>

        <section class="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
          <form class="glass-panel rounded-[30px] border p-5" @submit.prevent="submit">
            <div class="flex items-center justify-between gap-3">
              <h2 class="text-xl font-semibold">Realizar transferencia</h2>
              <button type="button" aria-label="Escanear QR de cuenta" title="Escanear QR de cuenta" class="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-sky-400/30 bg-sky-500/10 text-sky-200 transition hover:border-sky-300 hover:bg-sky-500/20" @click="startScanner">
                <ScanLine class="h-5 w-5" />
              </button>
            </div>

            <div class="mt-4 flex flex-wrap items-center gap-3">
              <input ref="imageInput" type="file" accept="image/*" class="sr-only" aria-label="Seleccionar imagen con código QR" @change="scanQrImage" />
              <button type="button" class="inline-flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-sm text-slate-200 transition hover:bg-white/5" @click="selectQrImage">
                <ImagePlus class="h-4 w-4 text-sky-200" /> Cargar QR desde galería
              </button>
              <p v-if="scannerMessage && !scannerOpen" role="status" class="text-sm text-sky-200">{{ scannerMessage }}</p>
            </div>

            <div v-if="scannerOpen" class="mt-5 rounded-2xl border border-sky-400/25 bg-sky-500/5 p-3">
              <div class="mb-3 flex items-center justify-between gap-3">
                <p class="text-sm text-sky-100">Escanea el QR de la cuenta destino</p>
                <button type="button" aria-label="Cerrar escáner" class="rounded-lg p-1 text-slate-300 hover:bg-white/10" @click="stopScanner"><X class="h-4 w-4" /></button>
              </div>
              <div id="transfer-qr-reader" class="overflow-hidden rounded-xl bg-slate-950/60" />
              <p v-if="scannerMessage" class="mt-2 text-xs text-sky-200">{{ scannerMessage }}</p>
            </div>

            <div class="mt-5 space-y-4">
              <label class="block text-sm text-slate-300">Destinatario (opcional si el QR solo tiene cuenta)<input v-model.trim="form.recipient" class="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/40 px-3 py-3 text-white" /></label>
              <label class="block text-sm text-slate-300">Cuenta o teléfono<input v-model.trim="form.account" required class="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/40 px-3 py-3 text-white" /></label>
              <label class="block text-sm text-slate-300">Monto<input v-model.number="form.amount" required min="1" type="number" class="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/40 px-3 py-3 text-white" /></label>
              <button :disabled="submitting" class="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-sky-400 to-indigo-500 px-5 py-3 font-medium text-slate-950 disabled:cursor-wait disabled:opacity-60"><Send class="h-4 w-4" /> {{ submitting ? 'Procesando…' : 'Confirmar envío' }}</button>
              <p v-if="message" class="text-sm text-sky-200">{{ message }}</p>
            </div>
          </form>

          <section class="glass-panel rounded-[30px] border p-5">
            <div class="flex items-center justify-between"><h2 class="text-xl font-semibold">Historial</h2><label class="flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-slate-400"><Search class="h-4 w-4" /><input v-model="search" placeholder="Buscar" class="w-28 bg-transparent text-sm text-white outline-none" /></label></div>
            <div class="mt-5 space-y-3"><p v-if="!userTransfers.length" class="rounded-2xl border border-dashed border-white/10 p-8 text-center text-slate-400">Aún no tienes transferencias.</p><article v-for="tx in userTransfers" :key="tx.id" class="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-950/30 p-4"><div><p class="font-medium">{{ tx.description }}</p><p class="text-xs text-slate-400">{{ tx.date }} · {{ tx.status }}</p></div><strong class="text-rose-300">-{{ money(tx.amount) }}</strong></article></div>
          </section>
        </section>
      </main>
    </div>
  </div>
</template>
