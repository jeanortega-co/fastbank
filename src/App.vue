<script setup>
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useBankStore } from '@/stores/bank'

const route = useRoute()
const store = useBankStore()
let revealObserver
let mutationObserver
document.documentElement.classList.add('dark')
document.body.classList.add('dark')

const pageShellClass = computed(() => ({
  'pt-0': route.path === '/' || route.path === '/login' || route.path === '/register',
  'pt-6': route.path.startsWith('/dashboard') || route.path.startsWith('/admin'),
}))

watch(() => store.currentUserId, (userId) => {
  if (userId) void store.refreshBankingData().catch(() => {})
}, { immediate: true })

const revealElements = (root = document) => {
  const elements = root.querySelectorAll('.glass-panel, main > header, main > section, main > article')
  elements.forEach((element, index) => {
    if (element.classList.contains('reveal-on-scroll')) return
    element.classList.add('reveal-on-scroll')
    element.style.setProperty('--reveal-delay', `${Math.min(index * 70, 420)}ms`)
    revealObserver?.observe(element)
  })
}

onMounted(() => {
  void store.refreshProfile()
  revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return
      entry.target.classList.add('is-visible')
      revealObserver.unobserve(entry.target)
    })
  }, { threshold: 0.08, rootMargin: '0px 0px -7% 0px' })

  revealElements()
  mutationObserver = new MutationObserver(() => revealElements())
  mutationObserver.observe(document.body, { childList: true, subtree: true })
})

onBeforeUnmount(() => {
  revealObserver?.disconnect()
  mutationObserver?.disconnect()
})
</script>

<template>
  <div class="min-h-screen app-shell">
    <main :class="['mx-auto w-full', pageShellClass]">
      <Transition name="page" mode="out-in">
        <div :key="route.fullPath" class="route-page">
          <router-view />
        </div>
      </Transition>
    </main>
  </div>
</template>
