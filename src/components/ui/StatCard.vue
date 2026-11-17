<script setup>
const props = defineProps({
  title: String,
  value: [String, Number],
  subtitle: String,
  tone: { type: String, default: 'default' },
})

const toneClasses = {
  default: 'from-sky-500/20 to-indigo-500/10 text-sky-100',
  success: 'from-emerald-500/20 to-green-500/10 text-emerald-100',
  warning: 'from-amber-500/20 to-yellow-500/10 text-amber-100',
  danger: 'from-rose-500/20 to-pink-500/10 text-rose-100',
}
</script>

<template>
  <article :class="['glass-panel flex min-h-[142px] flex-col justify-between rounded-2xl border p-4 shadow-xl sm:p-5', toneClasses[props.tone] || toneClasses.default]">
    <div class="flex min-w-0 items-start justify-between gap-3">
      <div>
        <p class="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-300/80">{{ title }}</p>
        <h3 class="mt-2 truncate text-xl font-semibold leading-tight text-white sm:text-2xl">{{ value }}</h3>
      </div>
      <div class="shrink-0 rounded-xl border border-white/10 bg-white/5 p-2">
        <slot name="icon" />
      </div>
    </div>
    <p class="mt-3 text-xs text-slate-300/80">{{ subtitle }}</p>
  </article>
</template>
