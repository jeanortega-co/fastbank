<script setup>
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  CreditCard,
  LockKeyhole,
  Play,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Zap,
} from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import promotionalCardImage from '../../publicidad/imagen tarjeta fastbank.jpg'
import promotionalVideo from '../../publicidad/fastbank tarjetas.mp4'
import cardInHandImage from '../../publicidad/fastbank-tarjeta-en-mano.png'
import cardAtAtmImage from '../../publicidad/fastbank-tarjeta-en-cajero.png'
import insertCardImage from '../../publicidad/fastbank-inserta-tarjeta-cajero.png'
import cashWithdrawalImage from '../../publicidad/fastbank-retiro-cajero.png'
import groceryPurchaseImage from '../../publicidad/fastbank-compra-cotidiana.png'

const router = useRouter()
const logoSrc = `${import.meta.env.BASE_URL}fastbank-logo.png`

const cardMoments = [
  {
    number: '01',
    title: 'Tu tarjeta te acompaña',
    description: 'Llévala contigo para tus planes y actividades de todos los días.',
    image: cardInHandImage,
    alt: 'Una persona sostiene su tarjeta Fastbank mientras camina por la ciudad',
  },
  {
    number: '02',
    title: 'Úsala en un cajero habilitado',
    description: 'Al llegar al cajero, consulta las instrucciones en pantalla antes de iniciar.',
    image: cardAtAtmImage,
    alt: 'Una persona se prepara para usar su tarjeta Fastbank en un cajero automático',
  },
  {
    number: '03',
    title: 'Sigue cada paso en pantalla',
    description: 'Inserta tu tarjeta y confirma los datos de la operación antes de continuar.',
    image: insertCardImage,
    alt: 'Una persona inserta su tarjeta Fastbank en un cajero automático',
  },
  {
    number: '04',
    title: 'Retira efectivo',
    description: 'Cuando termines, recuerda retirar el efectivo y recuperar tu tarjeta.',
    image: cashWithdrawalImage,
    alt: 'Una persona recoge efectivo del cajero junto a su tarjeta Fastbank',
  },
  {
    number: '05',
    title: 'Paga tus compras cotidianas',
    description: 'Compra en comercios que acepten tu tarjeta y revisa después tus movimientos.',
    image: groceryPurchaseImage,
    alt: 'Una persona lleva su tarjeta Fastbank mientras hace compras en una tienda',
  },
]
</script>

<template>
  <div class="marketing-page min-h-screen overflow-hidden bg-[#000518] text-white">
    <header class="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 lg:px-8">
      <a href="#" class="inline-flex shrink-0 items-center" aria-label="FastBank, inicio">
        <img :src="logoSrc" alt="FastBank" class="brand-logo h-9 w-36 object-cover object-center sm:h-10 sm:w-40" />
      </a>

      <nav class="hidden items-center gap-8 text-sm text-slate-300 md:flex" aria-label="Navegación principal">
        <a class="transition hover:text-white" href="#tarjeta">Tarjeta</a>
        <a class="transition hover:text-white" href="#experiencia">La experiencia</a>
        <a class="transition hover:text-white" href="#en-tu-dia-a-dia">En tu día a día</a>
        <a class="transition hover:text-white" href="#ventajas">Ventajas</a>
      </nav>

      <div class="flex items-center gap-2 sm:gap-3">
        <button type="button" class="rounded-full px-3 py-2 text-sm text-slate-200 transition hover:text-white sm:px-4" @click="router.push('/login')">
          Iniciar sesión
        </button>
        <button type="button" class="rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-100 sm:px-5" @click="router.push('/register')">
          Abrir cuenta
        </button>
      </div>
    </header>

    <main>
      <section class="relative mx-auto grid max-w-7xl gap-12 px-5 pb-20 pt-10 lg:min-h-[650px] lg:grid-cols-[1fr_0.9fr] lg:items-center lg:px-8 lg:pb-28 lg:pt-14">
        <div class="pointer-events-none absolute -left-40 top-16 h-96 w-96 rounded-full bg-cyan-500/10 blur-[100px]" />
        <div class="relative z-10">
          <div class="mb-6 inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/[0.07] px-3.5 py-2 text-xs font-medium tracking-wide text-cyan-100">
            <Sparkles class="h-4 w-4 text-cyan-300" />
            Una forma más simple de manejar tu dinero
          </div>
          <h1 class="max-w-2xl text-balance text-5xl font-semibold leading-[1.04] tracking-[-0.045em] text-white sm:text-6xl lg:text-7xl">
            Tu banco. Tu tarjeta. <span class="bg-gradient-to-r from-cyan-300 to-sky-400 bg-clip-text text-transparent">Tu ritmo.</span>
          </h1>
          <p class="mt-6 max-w-xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
            Paga con confianza y mantén el control desde un solo lugar. Fastbank hace que tu día a día financiero se sienta más claro y sencillo.
          </p>

          <div class="mt-8 flex flex-wrap items-center gap-3">
            <button type="button" class="inline-flex items-center gap-2 rounded-full bg-cyan-300 px-6 py-3.5 font-semibold text-slate-950 shadow-lg shadow-cyan-500/15 transition hover:-translate-y-0.5 hover:bg-cyan-200" @click="router.push('/register')">
              Conoce Fastbank <ArrowRight class="h-4 w-4" />
            </button>
            <a href="#experiencia" class="inline-flex items-center gap-2 rounded-full border border-white/10 px-5 py-3.5 text-sm font-medium text-white transition hover:border-white/25 hover:bg-white/5">
              <Play class="h-4 w-4 fill-current" /> Ver experiencia
            </a>
          </div>

          <div class="mt-10 flex flex-wrap gap-x-7 gap-y-3 text-sm text-slate-300">
            <span class="inline-flex items-center gap-2"><Check class="h-4 w-4 text-cyan-300" /> Control desde tu cuenta</span>
            <span class="inline-flex items-center gap-2"><Check class="h-4 w-4 text-cyan-300" /> Gestión digital sencilla</span>
          </div>
        </div>

        <div id="tarjeta" class="relative mx-auto w-full max-w-[510px] lg:ml-auto">
          <div class="absolute -inset-8 rounded-[40px] bg-gradient-to-br from-cyan-400/20 via-blue-500/10 to-violet-500/15 blur-3xl" />
          <div class="relative rounded-[32px] border border-white/10 bg-white/[0.04] p-4 shadow-2xl shadow-black/30 backdrop-blur-xl sm:p-6">
            <div class="flex items-center justify-between px-1 pb-5">
              <div>
                <p class="text-xs font-medium uppercase tracking-[0.22em] text-slate-400">Tu día, a tu manera</p>
                <p class="mt-1 text-sm text-white">Una tarjeta. Más control.</p>
              </div>
              <span class="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/15 bg-emerald-300/[0.08] px-3 py-1.5 text-xs text-emerald-200">
                <span class="h-1.5 w-1.5 rounded-full bg-emerald-300" /> Fastbank
              </span>
            </div>

            <div class="relative aspect-[4/3] overflow-hidden rounded-[25px] border border-white/15 bg-white shadow-xl">
              <img
                :src="promotionalCardImage"
                alt="Tarjetas de crédito y débito Fastbank"
                class="absolute inset-0 h-full w-full object-cover"
              />
            </div>

            <div class="mt-4 grid grid-cols-2 gap-3">
              <div class="flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-slate-950/30 p-3.5">
                <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-300/10 text-cyan-200"><CreditCard class="h-4 w-4" /></span>
                <span><span class="block text-xs font-medium text-white">Tu tarjeta</span><span class="mt-0.5 block text-[11px] text-slate-400">A tu manera</span></span>
              </div>
              <div class="flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-slate-950/30 p-3.5">
                <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-300/10 text-violet-200"><Smartphone class="h-4 w-4" /></span>
                <span><span class="block text-xs font-medium text-white">Todo en la app</span><span class="mt-0.5 block text-[11px] text-slate-400">Control fácil</span></span>
              </div>
            </div>
            <div class="mt-3 flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-900/70 p-3.5">
              <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-300/10 text-emerald-200"><ShieldCheck class="h-5 w-5" /></span>
              <span class="min-w-0">
                <span class="block text-xs font-medium text-white">Tú tienes el control</span>
                <span class="mt-1 block text-[11px] leading-4 text-slate-400">Administra tu tarjeta desde tu cuenta</span>
              </span>
            </div>
          </div>
        </div>
      </section>

      <section id="experiencia" class="mx-auto max-w-7xl scroll-mt-8 px-5 pb-20 lg:px-8 lg:pb-28">
        <div class="grid overflow-hidden rounded-[32px] border border-white/10 bg-gradient-to-br from-[#102435] to-[#0b1726] lg:grid-cols-[0.8fr_1.2fr]">
          <div class="flex flex-col justify-center p-7 sm:p-10 lg:p-14">
            <p class="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300">Así se siente Fastbank</p>
            <h2 class="mt-4 text-3xl font-semibold leading-tight tracking-tight text-white sm:text-4xl">Una experiencia pensada para seguirte el paso.</h2>
            <p class="mt-4 max-w-md leading-7 text-slate-300">Mira cómo una experiencia financiera más simple puede acompañar tus compras, tus planes y todo lo que viene.</p>
            <a href="#ventajas" class="mt-7 inline-flex w-fit items-center gap-2 text-sm font-semibold text-cyan-200 transition hover:text-white">
              Descubre lo que puedes hacer <ArrowUpRight class="h-4 w-4" />
            </a>
          </div>
          <div class="relative min-h-[260px] bg-slate-900 sm:min-h-[380px]">
            <video
              class="absolute inset-0 h-full w-full object-cover"
              autoplay
              muted
              loop
              playsinline
              preload="none"
              aria-label="Video promocional de la experiencia Fastbank"
            >
              <source :src="promotionalVideo" type="video/mp4" />
              Tu navegador no puede reproducir este video.
            </video>
            <div class="pointer-events-none absolute inset-0 bg-gradient-to-r from-slate-950/15 via-transparent to-transparent" />
          </div>
        </div>
      </section>

      <section id="en-tu-dia-a-dia" class="mx-auto max-w-7xl scroll-mt-8 px-5 pb-20 lg:px-8 lg:pb-28">
        <div class="max-w-2xl">
          <p class="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300">De camino a tus planes</p>
          <h2 class="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">Así puede acompañarte tu tarjeta Fastbank.</h2>
          <p class="mt-4 leading-7 text-slate-300">Desde salir con tu tarjeta hasta completar una compra o una operación en el cajero: conoce cada momento y sigue siempre las indicaciones del comercio o del cajero.</p>
        </div>

        <div class="mt-9 grid gap-5 sm:grid-cols-2 lg:grid-cols-6">
          <article
            v-for="(moment, index) in cardMoments"
            :key="moment.number"
            class="overflow-hidden rounded-[26px] border border-white/10 bg-white/[0.035] transition hover:-translate-y-1 hover:border-cyan-200/20 hover:bg-white/[0.055]"
            :class="index < 2 ? 'lg:col-span-3' : 'lg:col-span-2'"
          >
            <div class="aspect-[16/10] overflow-hidden bg-slate-900">
              <img
                :src="moment.image"
                :alt="moment.alt"
                class="h-full w-full object-cover transition duration-500 hover:scale-[1.03]"
                loading="lazy"
              />
            </div>
            <div class="p-5 sm:p-6">
              <p class="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">Paso {{ moment.number }}</p>
              <h3 class="mt-3 text-lg font-semibold text-white">{{ moment.title }}</h3>
              <p class="mt-2 text-sm leading-6 text-slate-300">{{ moment.description }}</p>
            </div>
          </article>
        </div>
      </section>

      <section id="ventajas" class="mx-auto max-w-7xl scroll-mt-8 px-5 pb-20 lg:px-8 lg:pb-28">
        <div class="max-w-2xl">
          <p class="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300">Lo esencial, bien hecho</p>
          <h2 class="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">Tu tarjeta te acompaña. Tú decides cómo usarla.</h2>
          <p class="mt-4 leading-7 text-slate-300">Herramientas sencillas para tener claridad y tomar decisiones con confianza.</p>
        </div>

        <div class="mt-9 grid gap-4 md:grid-cols-3">
          <article class="rounded-[26px] border border-white/10 bg-white/[0.035] p-6 transition hover:-translate-y-1 hover:border-cyan-200/20 hover:bg-white/[0.055]">
            <div class="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-300/10 text-cyan-200"><CreditCard class="h-5 w-5" /></div>
            <h3 class="mt-5 text-lg font-semibold text-white">Tu tarjeta, bajo control</h3>
            <p class="mt-2 text-sm leading-6 text-slate-300">Consulta tus movimientos, administra tu límite y bloquea o desbloquea tu tarjeta desde tu cuenta.</p>
          </article>
          <article class="rounded-[26px] border border-white/10 bg-white/[0.035] p-6 transition hover:-translate-y-1 hover:border-cyan-200/20 hover:bg-white/[0.055]">
            <div class="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-300/10 text-violet-200"><LockKeyhole class="h-5 w-5" /></div>
            <h3 class="mt-5 text-lg font-semibold text-white">Seguridad a tu alcance</h3>
            <p class="mt-2 text-sm leading-6 text-slate-300">Activa controles adicionales y revisa los datos sensibles de tu tarjeta cuando los necesites.</p>
          </article>
          <article class="rounded-[26px] border border-white/10 bg-white/[0.035] p-6 transition hover:-translate-y-1 hover:border-cyan-200/20 hover:bg-white/[0.055]">
            <div class="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-300/10 text-amber-200"><Zap class="h-5 w-5" /></div>
            <h3 class="mt-5 text-lg font-semibold text-white">Menos vueltas, más claridad</h3>
            <p class="mt-2 text-sm leading-6 text-slate-300">Encuentra en un mismo lugar tu tarjeta, tus movimientos y las herramientas para organizarte.</p>
          </article>
        </div>
      </section>

      <section class="mx-auto max-w-7xl px-5 pb-20 lg:px-8 lg:pb-28">
        <div class="relative overflow-hidden rounded-[32px] border border-cyan-200/15 bg-gradient-to-r from-cyan-400/10 via-sky-500/10 to-indigo-500/10 px-7 py-10 sm:px-12 sm:py-14">
          <div class="pointer-events-none absolute -right-12 -top-32 h-80 w-80 rounded-full bg-cyan-300/10 blur-3xl" />
          <div class="relative flex flex-col items-start justify-between gap-7 md:flex-row md:items-center">
            <div class="max-w-xl">
              <p class="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200"><Sparkles class="h-4 w-4" /> Empieza hoy</p>
              <h2 class="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">Tu próximo paso puede ser más simple.</h2>
              <p class="mt-3 text-slate-300">Conoce Fastbank y descubre una nueva forma de llevar tus finanzas.</p>
            </div>
            <button type="button" class="inline-flex shrink-0 items-center gap-2 rounded-full bg-white px-6 py-3.5 font-semibold text-slate-950 transition hover:bg-cyan-100" @click="router.push('/register')">
              Abrir cuenta <ArrowRight class="h-4 w-4" />
            </button>
          </div>
        </div>
      </section>
    </main>

    <footer class="border-t border-white/[0.07]">
      <div class="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-7 text-sm text-slate-400 sm:flex-row sm:items-center sm:justify-between lg:px-8">
        <a href="#" class="w-fit" aria-label="FastBank, inicio">
          <img :src="logoSrc" alt="FastBank" class="brand-logo h-8 w-32 object-cover object-center" />
        </a>
        <p>Una experiencia financiera más simple, a tu ritmo.</p>
        <button type="button" class="inline-flex w-fit items-center gap-1 transition hover:text-white" @click="router.push('/login')">Acceso a clientes <ArrowRight class="h-3.5 w-3.5" /></button>
      </div>
    </footer>
  </div>
</template>
