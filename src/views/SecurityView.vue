<script setup>
import { computed, onMounted, ref } from 'vue'
import { Fingerprint, ShieldCheck } from 'lucide-vue-next'
import { browserSupportsWebAuthn, startRegistration } from '@simplewebauthn/browser'
import { useBankStore } from '@/stores/bank'
import { useRoute } from 'vue-router'
import SidebarNav from '@/components/SidebarNav.vue'
const store = useBankStore()
const route = useRoute()
const user = computed(() => store.currentUser)
const settings = [{ key: 'secureMode', label: 'Confirmación para operaciones sensibles' }]
const twoFactorSecret = ref('')
const twoFactorCode = ref('')
const auditLogs = ref([])
const message = ref('')
const passkeyCount = ref(0)
const passkeyBusy = ref(false)
const passkeyMessage = ref('')

const auditActionLabels = {
	'auth.login': 'Inicio de sesión',
	'auth.registered': 'Cuenta creada',
	'auth.password_reset_requested': 'Solicitud para cambiar contraseña',
	'auth.password_reset_completed': 'Contraseña actualizada',
	'auth.password_reset_issued': 'Código de recuperación enviado',
	'auth.pin_reset_requested': 'Solicitud para cambiar PIN',
	'auth.pin_reset_completed': 'PIN actualizado',
	'auth.2fa.setup_started': 'Configuración de verificación en dos pasos iniciada',
	'auth.2fa.enabled': 'Verificación en dos pasos activada',
	'auth.passkey.registered': 'Método de acceso del dispositivo registrado',
	'auth.passkey.login': 'Inicio de sesión con método del dispositivo',
	'banking.investment.opened': 'Inversión iniciada',
	'banking.investment.withdrawn': 'Inversión retirada',
	'profile.updated': 'Datos del perfil actualizados',
	'banking.transaction.processed': 'Movimiento realizado',
	'banking.transaction.rejected': 'Movimiento no completado',
	'banking.transaction.reversed': 'Movimiento revertido',
	'transaction.created': 'Movimiento registrado',
	'banking.card.requested': 'Solicitud de tarjeta creada',
	'banking.pocket.created': 'Bolsillo de ahorro creado',
	'banking.pocket.lock_changed': 'Estado del bolsillo actualizado',
	'banking.loan.issued': 'Crédito desembolsado',
	'banking.loan.payment': 'Pago de crédito realizado',
	'banking.card.updated': 'Configuración de tarjeta actualizada',
}

const auditActionLabel = (action) => auditActionLabels[action] || 'Actividad de la cuenta'

const auditActionDescription = (log) => {
	if (log.action === 'auth.login') return 'Se inició sesión correctamente en tu cuenta.'
	if (log.action === 'auth.passkey.login') return 'Se inició sesión usando un método verificado por tu dispositivo.'
	if (log.action === 'auth.passkey.registered') return 'Se agregó un método seguro de acceso a tu cuenta.'
	if (log.action === 'banking.transaction.processed' || log.action === 'transaction.created') return 'Se registró un movimiento en tu cuenta.'
	if (log.action === 'banking.investment.opened') return `Se invirtieron ${money(log.metadata.amount)} en ${log.metadata.symbol} a ${log.metadata.termDays} días.`
	if (log.action === 'banking.investment.withdrawn') return `Se retiró la inversión en ${log.metadata.symbol}. Monto abonado: ${money(log.metadata.payout)}.`
	if (log.action === 'banking.card.requested') return `Se solicitó una tarjeta de ${log.metadata.cardKind === 'credit' ? 'crédito' : 'débito'} ${log.metadata.cardType === 'physical' ? 'física' : 'digital'}.`
	if (log.action === 'auth.2fa.setup_started') return 'Se comenzó a configurar una capa adicional de protección.'
	return ''
}

const money = (value) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value || 0)

const auditLocation = (ipAddress) => {
	if (!ipAddress || ipAddress === 'No disponible') return 'Ubicación de conexión no disponible'
	if (['::1', '127.0.0.1', '::ffff:127.0.0.1'].includes(ipAddress)) return 'Este dispositivo (conexión local)'
	return `Conexión desde ${ipAddress}`
}

const updateSetting = async (key, value) => {
	store.updateSecurity(key, value)
}

const setupTwoFactor = async () => {
	message.value = ''
	try {
		const result = await store.setupTwoFactor()
		twoFactorSecret.value = result.secret
		message.value = 'Escanea el enlace en Google Authenticator o Authy y confirma con un código.'
	} catch (error) {
		message.value = error.message
	}
}

const verifyTwoFactor = async () => {
	try {
		await store.verifyTwoFactor(twoFactorCode.value)
		twoFactorSecret.value = ''
		twoFactorCode.value = ''
		message.value = 'Autenticación de dos factores activada.'
		auditLogs.value = await store.fetchAuditLog()
	} catch (error) {
		message.value = error.message
	}
}

const refreshPasskeys = async () => {
	const result = await store.getPasskeyStatus()
	passkeyCount.value = result.count
}

const registerPasskey = async () => {
	passkeyMessage.value = ''
	if (!window.isSecureContext) {
		passkeyMessage.value = 'Las passkeys requieren HTTPS. En desarrollo, usa localhost; la IP local por HTTP no permite biometría.'
		return
	}

	passkeyBusy.value = true
	try {
		if (!await browserSupportsWebAuthn()) throw new Error('Este navegador no admite passkeys.')
		const { challengeId, options } = await store.getPasskeyRegistrationOptions()
		const response = await startRegistration({ optionsJSON: options })
		await store.verifyPasskeyRegistration({ challengeId, response })
		passkeyMessage.value = 'Registro completado. Ya puedes iniciar sesión con el método de verificación de este dispositivo.'
		try {
			await refreshPasskeys()
		} catch (error) {
			passkeyMessage.value += ` No se pudo actualizar el contador: ${error.message}`
		}
	} catch (error) {
		passkeyMessage.value = error.message || 'No se pudo registrar la passkey.'
	} finally {
		passkeyBusy.value = false
	}
}

onMounted(async () => {
	if (route.path === '/registrar-huella') {
		document.getElementById('register-passkey')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
	}
	try {
		auditLogs.value = await store.fetchAuditLog()
	} catch {
		auditLogs.value = []
	}
	try {
		await refreshPasskeys()
	} catch (error) {
		passkeyMessage.value = error.message || 'No se pudo consultar el estado de las passkeys.'
	}
})
</script>

<template>
	<div class="min-h-screen px-4 pb-10 pt-5 text-white lg:px-6">
		<div class="mx-auto max-w-7xl lg:flex lg:gap-8">
			<SidebarNav />
			<main class="flex-1 space-y-6">
				<header class="glass-panel rounded-[28px] border p-6">
					<p class="text-xs uppercase tracking-[0.25em] text-sky-200/70">Protección de cuenta</p>
					<h1 class="mt-2 text-3xl font-semibold">Seguridad</h1>
					<div class="mt-4 inline-flex items-center gap-2 rounded-full bg-emerald-500/15 px-3 py-2 text-emerald-300">
						<ShieldCheck class="h-4 w-4" /> Nivel alto · Puntaje {{ user?.trustScore }}
					</div>
				</header>

				<section class="glass-panel rounded-[30px] border p-5">
					<h2 class="text-xl font-semibold">Medidas activas</h2>
					<div class="mt-4 space-y-3">
						<label v-for="item in settings" :key="item.key" class="flex items-center justify-between rounded-2xl border border-white/10 p-4">
							<span>{{ item.label }}</span>
							<input type="checkbox" :checked="user?.[item.key]" @change="updateSetting(item.key, $event.target.checked)" class="h-5 w-5 accent-sky-400" />
						</label>
					</div>
				</section>

				<section id="register-passkey" class="glass-panel scroll-mt-6 rounded-[30px] border p-5">
					<div class="flex flex-wrap items-center justify-between gap-3">
						<div>
							<h2 class="flex items-center gap-2 text-xl font-semibold"><Fingerprint class="h-5 w-5 text-sky-300" /> Registrar huella o passkey</h2>
							<p class="mt-1 text-sm text-slate-400">El dispositivo verifica tu huella, rostro o PIN, según lo que admita. FastBank solo guarda una clave pública, nunca tus datos biométricos.</p>
						</div>
						<span class="text-sm text-slate-300">{{ passkeyCount }} registrada(s)</span>
					</div>
					<button type="button" :disabled="passkeyBusy" class="mt-4 rounded-full bg-gradient-to-r from-sky-400 to-indigo-500 px-5 py-3 font-medium text-slate-950 disabled:cursor-wait disabled:opacity-60" @click="registerPasskey">
						{{ passkeyBusy ? 'Esperando al dispositivo…' : 'Registrar en este dispositivo' }}
					</button>
					<p v-if="passkeyMessage" role="status" class="mt-3 text-sm text-sky-200">{{ passkeyMessage }}</p>
				</section>

				<section class="glass-panel rounded-[30px] border p-5">
					<div class="flex flex-wrap items-center justify-between gap-3">
						<div>
							<h2 class="text-xl font-semibold">Verificación en dos pasos</h2>
							<p class="mt-1 max-w-2xl text-sm text-slate-400">Añade una comprobación extra al iniciar sesión. Si la activas, necesitarás un código temporal de una aplicación como Google Authenticator o Authy, además de tu método habitual. Es opcional.</p>
						</div>
						<span :class="user?.twoFactorEnabled ? 'text-emerald-300' : 'text-slate-300'">{{ user?.twoFactorEnabled ? 'Activada' : 'Opcional · Desactivada' }}</span>
					</div>
					<button v-if="!user?.twoFactorEnabled && !twoFactorSecret" type="button" class="mt-4 rounded-full bg-gradient-to-r from-sky-400 to-indigo-500 px-5 py-3 font-medium text-slate-950" @click="setupTwoFactor">Configurar verificación en dos pasos</button>
					<div v-if="twoFactorSecret" class="mt-4 space-y-3 rounded-2xl border border-sky-400/20 bg-sky-500/5 p-4">
						<p class="text-sm text-slate-300">Añade FastBank a tu aplicación de autenticación con esta clave y escribe el código temporal para confirmar. Mantén esta clave privada: <strong class="break-all text-sky-200">{{ twoFactorSecret }}</strong></p>
						<div class="flex gap-3">
							<input v-model="twoFactorCode" inputmode="numeric" maxlength="6" placeholder="Código temporal de 6 dígitos" aria-label="Código temporal de 6 dígitos" class="min-w-0 flex-1 rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-white" />
							<button type="button" class="rounded-xl bg-emerald-400 px-4 py-2 font-medium text-slate-950" @click="verifyTwoFactor">Verificar</button>
						</div>
					</div>
					<p v-if="message" class="mt-3 text-sm text-sky-200">{{ message }}</p>
				</section>

				<section class="glass-panel rounded-[30px] border p-5">
					<h2 class="text-xl font-semibold">Historial de seguridad</h2>
					<p class="mt-1 text-sm text-slate-400">Aquí puedes revisar acciones recientes de tu cuenta, como los accesos y cambios de seguridad. Los accesos desde este mismo equipo se indican como conexión local.</p>
					<div v-if="auditLogs.length" class="mt-4 space-y-3">
						<article v-for="log in auditLogs" :key="log.id" class="rounded-2xl border border-white/10 bg-white/5 p-4">
							<div class="flex flex-wrap items-center justify-between gap-2">
								<strong>{{ auditActionLabel(log.action) }}</strong>
								<time class="text-xs text-slate-400">{{ new Date(log.createdAt).toLocaleString('es-CO') }}</time>
							</div>
							<p v-if="auditActionDescription(log)" class="mt-1 text-sm text-slate-300">{{ auditActionDescription(log) }}</p>
							<p class="mt-1 text-xs text-slate-400">{{ auditLocation(log.ipAddress) }}</p>
						</article>
					</div>
					<p v-else class="mt-3 text-sm text-slate-400">Aún no hay eventos registrados.</p>
				</section>

				<section class="glass-panel rounded-[30px] border p-5">
					<p class="text-slate-400">Último acceso: {{ user?.lastLogin ? new Date(user.lastLogin).toLocaleString('es-CO') : 'Sin registro' }}</p>
					<button type="button" class="mt-5 rounded-full border border-rose-400/30 px-4 py-2 text-rose-200" @click="store.logout">Cerrar sesión actual</button>
				</section>
			</main>
		</div>
	</div>
</template>
