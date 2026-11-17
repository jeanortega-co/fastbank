import { createRouter, createWebHistory } from 'vue-router'
import LandingView from '@/views/LandingView.vue'
import LoginView from '@/views/LoginView.vue'
import RegisterView from '@/views/RegisterView.vue'
import ResetPasswordView from '@/views/ResetPasswordView.vue'
import DashboardView from '@/views/DashboardView.vue'
import AdminDashboardView from '@/views/AdminDashboardView.vue'
import TransfersView from '@/views/TransfersView.vue'
import PocketsView from '@/views/PocketsView.vue'
import CreditView from '@/views/CreditView.vue'
import InvestmentsView from '@/views/InvestmentsView.vue'
import SecurityView from '@/views/SecurityView.vue'
import SettingsView from '@/views/SettingsView.vue'
import CardRequestView from '@/views/CardRequestView.vue'
import ServicesView from '@/views/ServicesView.vue'
import HelpCenterView from '@/views/HelpCenterView.vue'
import CasinoView from '@/views/CasinoView.vue'
import { useBankStore } from '@/stores/bank'

const routes = [
  { path: '/', name: 'landing', component: LandingView },
  { path: '/login', name: 'login', component: LoginView },
  { path: '/register', name: 'register', component: RegisterView },
  { path: '/restablecer-contrasena', name: 'reset-password', component: ResetPasswordView },
  { path: '/restablecer-pin', name: 'reset-pin', component: ResetPasswordView, props: { credentialType: 'pin' } },
  {
    path: '/dashboard',
    name: 'dashboard',
    component: DashboardView,
    meta: { requiresAuth: true },
  },
  { path: '/resumen', redirect: '/dashboard' },
  { path: '/transferencias', name: 'transfers', component: TransfersView, meta: { requiresAuth: true } },
  { path: '/pagos-recargas', name: 'services', component: ServicesView, meta: { requiresAuth: true } },
  { path: '/bolsillos', name: 'pockets', component: PocketsView, meta: { requiresAuth: true } },
  { path: '/credito', name: 'credit', component: CreditView, meta: { requiresAuth: true } },
  { path: '/inversiones', name: 'investments', component: InvestmentsView, meta: { requiresAuth: true } },
  { path: '/pedir-tarjetas', name: 'card-requests', component: CardRequestView, meta: { requiresAuth: true } },
  { path: '/casino', name: 'casino', component: CasinoView, meta: { requiresAuth: true } },
  { path: '/ayuda', name: 'help-center', component: HelpCenterView, meta: { requiresAuth: true } },
  { path: '/seguridad', name: 'security', component: SecurityView, meta: { requiresAuth: true } },
  { path: '/registrar-huella', name: 'register-passkey', component: SecurityView, meta: { requiresAuth: true } },
  { path: '/ajustes', name: 'settings', component: SettingsView, meta: { requiresAuth: true } },
  {
    path: '/admin',
    name: 'admin',
    component: AdminDashboardView,
    meta: { requiresAuth: true, requiresAdmin: true },
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach((to) => {
  const store = useBankStore()
  const isLoggedIn = Boolean(store.currentUserId)
  const currentUser = store.currentUser

  if (to.meta.requiresAuth && !isLoggedIn) {
    return '/login'
  }

  if (to.meta.requiresAdmin && currentUser?.role !== 'admin') {
    return '/dashboard'
  }

  return true
})

export default router
