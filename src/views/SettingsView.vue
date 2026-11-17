<script setup>
import { ref } from 'vue'
import { useBankStore } from '@/stores/bank'
import SidebarNav from '@/components/SidebarNav.vue'
const store = useBankStore()
const user = store.currentUser
const form = ref({ firstName: user?.firstName || '', lastName: user?.lastName || '', phone: user?.phone || '', email: user?.email || '' })
const message = ref('')
const save = async () => {
	const result = await store.updateProfile(form.value)
	message.value = result.ok ? 'Datos actualizados y guardados.' : result.message
}
</script>
<template>
	<div class="min-h-screen px-4 pb-10 pt-5 text-white lg:px-6">
		<div class="mx-auto max-w-7xl lg:flex lg:gap-8">
			<SidebarNav />
			<main class="flex-1 space-y-6">
				<header class="glass-panel rounded-[28px] border p-6">
					<p class="text-xs uppercase tracking-[0.25em] text-sky-200/70">Cuenta</p>
					<h1 class="mt-2 text-3xl font-semibold">Ajustes</h1>
					<p class="mt-2 text-slate-400">Administra tus datos y preferencias.</p>
				</header>

				<section class="glass-panel max-w-3xl rounded-[30px] border p-5">
					<h2 class="text-xl font-semibold">Información personal</h2>
					<form class="mt-5 grid gap-4 md:grid-cols-2" @submit.prevent="save">
						<input v-model.trim="form.firstName" required placeholder="Nombre" class="rounded-2xl border border-white/10 bg-slate-950/40 px-3 py-3 text-white" />
						<input v-model.trim="form.lastName" required placeholder="Apellido" class="rounded-2xl border border-white/10 bg-slate-950/40 px-3 py-3 text-white" />
						<input v-model.trim="form.phone" required placeholder="Teléfono" class="rounded-2xl border border-white/10 bg-slate-950/40 px-3 py-3 text-white" />
						<input v-model.trim="form.email" required type="email" placeholder="Correo electrónico" class="rounded-2xl border border-white/10 bg-slate-950/40 px-3 py-3 text-white" />
						<button class="rounded-full bg-gradient-to-r from-sky-400 to-indigo-500 px-5 py-3 font-medium text-slate-950 md:col-span-2">Guardar cambios</button>
					</form>
					<p v-if="message" class="mt-3 text-sm text-sky-200">{{ message }}</p>
				</section>

				<section class="glass-panel max-w-3xl rounded-[30px] border p-5">
					<h2 class="text-xl font-semibold">Preferencias</h2>
					<label class="mt-4 flex items-center justify-between rounded-2xl border border-white/10 p-4">
						<span>Modo seguro</span>
						<input type="checkbox" :checked="store.secureMode" @change="store.toggleSecureMode" class="h-5 w-5 accent-sky-400" />
					</label>
				</section>
			</main>
		</div>
	</div>
</template>
