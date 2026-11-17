import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { useBankStore } from './stores/bank'
import './style.css'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(router)

const bankStore = useBankStore()
document.documentElement.classList.add('dark')
document.body.classList.add('dark')

bankStore.$subscribe(
  () => {
    bankStore.persist()
  },
  { detached: true, deep: true },
)

app.mount('#app')
