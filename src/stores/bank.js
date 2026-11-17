import { defineStore } from 'pinia'
import personalData from '@/data/personalData.json'
import { createUuid } from '@/utils/uuid'

const STORAGE_KEY = 'fastbank-store-v1'
const API_URL = import.meta.env.VITE_API_URL || '/api'

const sessionToken = () => (typeof sessionStorage === 'undefined' ? '' : sessionStorage.getItem('fastbank-token') || '')

const apiRequest = async (path, options = {}) => {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(sessionToken() ? { Authorization: `Bearer ${sessionToken()}` } : {}),
      ...(options.headers || {}),
    },
  })
  const responseBody = await response.text()
  let data = {}
  try {
    data = responseBody ? JSON.parse(responseBody) : {}
  } catch {
    data = {}
  }
  if (!response.ok) {
    const error = new Error(data.message || `El servidor respondió con un error (${response.status}).`)
    error.status = response.status
    error.data = data
    throw error
  }
  return data
}

const createUser = (overrides = {}) => ({
  id: createUuid(),
  firstName: 'Usuario',
  lastName: 'Fastbank',
  document: '1000000000',
  phone: '3000000000',
  email: 'user@fastbank.co',
  role: 'user',
  status: 'active',
  trustScore: 66,
  darkMode: false,
  secureMode: false,
  lastLogin: new Date().toISOString(),
  cardLimit: 1800000,
  creditLimit: 100000,
  cardLocked: false,
  balance: 0,
  savings: 0,
  investments: 0,
  pockets: [],
  ...overrides,
})

const createSeedData = () => {
  const admin = createUser({
    id: 'admin-fastbank',
    firstName: 'Fastbank',
    lastName: 'Admin',
    document: '9000000000',
    phone: '3018489400',
    email: 'fastbank@gmail.com',
    role: 'admin',
    trustScore: 99,
    balance: 0,
    savings: 0,
    investments: 0,
    cardLimit: 5000000,
    creditLimit: 1500000,
    pockets: [],
  })

  const user = createUser({
    id: 'demo-user-fastbank',
    firstName: personalData.firstName,
    lastName: personalData.lastName,
    document: '1002345678',
    phone: personalData.phone,
    email: personalData.email,
    role: 'user',
    trustScore: 82,
    balance: 0,
    savings: 0,
    investments: 0,
    cardLimit: 2800000,
    creditLimit: 500000,
    pockets: [],
  })

  return {
    theme: 'dark',
    secureMode: false,
    currentUserId: null,
    authToken: sessionToken(),
    users: [admin, user],
    transactions: [],
    loans: [],
    creditAssessment: null,
    subscriptions: [
      { id: 'subs-1', name: 'Netflix', amount: 42000, active: true },
      { id: 'subs-2', name: 'Spotify', amount: 18000, active: true },
      { id: 'subs-3', name: 'Gimnasio', amount: 76000, active: false },
    ],
    contacts: [
      { id: 'contact-1', name: 'Lucía Torres', bank: 'Fastbank', type: 'own' },
      { id: 'contact-2', name: 'Javier Ruiz', bank: 'Daviplata', type: 'third' },
      { id: 'contact-3', name: 'Marta Prieto', bank: 'Bancolombia', type: 'interbank' },
    ],
    qrCode: '',
    investmentIdeas: [
      { symbol: 'AAPL', price: 214000, change: 1.8 },
      { symbol: 'NVDA', price: 187000, change: 2.9 },
      { symbol: 'BTC', price: 32600000, change: 4.6 },
    ],
    investmentInstruments: [],
    investmentPositions: [],
    history: [],
  }
}

const loadState = () => {
  if (typeof localStorage === 'undefined') {
    return createSeedData()
  }

  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return createSeedData()

  try {
    const parsed = JSON.parse(raw)
    if (!parsed || !Array.isArray(parsed.users)) return createSeedData()
    const demoUsers = createSeedData().users
    demoUsers.forEach((demoUser) => {
      if (!parsed.users.some((user) => user.id === demoUser.id)) parsed.users.push(demoUser)
    })
    parsed.history ||= []
    parsed.loans = []
    parsed.transactions = []
    parsed.history = []
    parsed.creditAssessment = null
    parsed.investmentIdeas ||= []
    parsed.investmentInstruments ||= []
    parsed.investmentPositions ||= []
    parsed.users.forEach((user) => {
      user.balance = 0
      user.savings = 0
      user.investments = 0
      user.creditLimit = 0
      user.cardLimit = 0
      user.cardLocked = false
      user.trustScore = 0
      user.pockets = []
      delete user.cvv
      delete user.password
      delete user.pin
    })
    parsed.authToken = sessionToken()
    if (!parsed.authToken) parsed.currentUserId = null
    return parsed
  } catch (error) {
    return createSeedData()
  }
}

export const useBankStore = defineStore('bank', {
  state: () => loadState(),
  getters: {
    currentUser: (state) => state.users.find((user) => user.id === state.currentUserId) || null,
    availableBalance: (state) => {
      const user = state.users.find((entry) => entry.id === state.currentUserId)
      return user?.balance || 0
    },
    totalBalance: (state) => {
      const user = state.users.find((u) => u.id === state.currentUserId)
      if (!user) return 0
      return (user.balance || 0) + (user.savings || 0) + (user.investments || 0) + (user.pockets || []).reduce((sum, pocket) => sum + (pocket.amount || 0), 0)
    },
    userTransactions: (state) => {
      if (!state.currentUserId) return []
      return state.transactions.filter((tx) => tx.userId === state.currentUserId).slice(0, 8)
    },
  },
  actions: {
    persist() {
      if (typeof localStorage !== 'undefined') {
        const safeState = JSON.parse(JSON.stringify(this.$state))
        delete safeState.authToken
        delete safeState.password
        delete safeState.pin
        safeState.transactions = []
        safeState.loans = []
        safeState.history = []
        safeState.creditAssessment = null
        safeState.users = (safeState.users || []).map(({ balance, savings, investments, creditLimit, cardLimit, cardLocked, trustScore, pockets, cvv, password, pin, ...user }) => user)
        localStorage.setItem(STORAGE_KEY, JSON.stringify(safeState))
      }
    },
    getMaxLoanLimitForTrust(trustScore = 0) {
      if (trustScore >= 90) return 1500000
      if (trustScore >= 80) return 500000
      if (trustScore >= 70) return 200000
      return 100000
    },
    toggleSecureMode() {
      this.secureMode = !this.secureMode
      const current = this.currentUser
      if (current) current.secureMode = this.secureMode
      this.persist()
    },
    establishSession(data) {
      this.authToken = data.token
      sessionStorage.setItem('fastbank-token', data.token)
      this.currentUserId = data.user.id
      const existing = this.users.findIndex((user) => user.id === data.user.id)
      if (existing >= 0) {
        this.users[existing] = { ...this.users[existing], ...data.user, pockets: this.users[existing].pockets || [] }
      } else {
        this.users.push({ ...data.user, balance: 0, savings: 0, investments: 0, pockets: [] })
      }
      this.persist()
    },
    async login({ identifier, password, pin, code }) {
      try {
        const response = await fetch(`${API_URL}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier, password, pin, code }),
        })
        const data = await response.json().catch(() => ({}))
        if (response.status === 202) return { ok: false, requiresTwoFactor: true, message: data.message }
        if (!response.ok) return { ok: false, message: data.message || 'No se pudo iniciar sesión.' }

        this.establishSession(data)
        return { ok: true, user: data.user }
      } catch (error) {
        return { ok: false, message: error.message === 'Failed to fetch' ? 'La API no está activa. Ejecuta npm run dev.' : error.message }
      }
    },
    async getPasskeyStatus() {
      return apiRequest('/auth/passkeys')
    },
    async getPasskeyRegistrationOptions() {
      return apiRequest('/auth/passkeys/registration-options', { method: 'POST' })
    },
    async verifyPasskeyRegistration({ challengeId, response }) {
      return apiRequest('/auth/passkeys/registration-verify', {
        method: 'POST',
        body: JSON.stringify({ challengeId, response }),
      })
    },
    async getPasskeyAuthenticationOptions() {
      return apiRequest('/auth/passkeys/authentication-options', { method: 'POST', body: '{}' })
    },
    async loginWithPasskey({ challengeId, response }) {
      const data = await apiRequest('/auth/passkeys/authentication-verify', {
        method: 'POST',
        body: JSON.stringify({ challengeId, response }),
      })
      this.establishSession(data)
      return { ok: true, user: data.user }
    },
    logout() {
      this.currentUserId = null
      this.authToken = ''
      sessionStorage.removeItem('fastbank-token')
      this.persist()
    },
    async register(payload) {
      try {
        const data = await apiRequest('/auth/register', { method: 'POST', body: JSON.stringify(payload) })
        this.authToken = data.token
        sessionStorage.setItem('fastbank-token', data.token)
        this.users.push(data.user)
        this.currentUserId = data.user.id
        this.persist()
        return { ok: true, user: data.user }
      } catch (error) {
        return { ok: false, message: error.message }
      }
    },
    async requestRegistrationCode(payload) {
      try {
        const data = await apiRequest('/auth/register/email-code', {
          method: 'POST',
          body: JSON.stringify(payload),
        })
        return { ok: true, message: data.message }
      } catch (error) {
        return { ok: false, message: error.message }
      }
    },
    async verifyRegistrationCode({ email, code }) {
      try {
        const data = await apiRequest('/auth/register/email-code/verify', {
          method: 'POST',
          body: JSON.stringify({ email, code }),
        })
        return { ok: true, registrationToken: data.registrationToken, message: data.message }
      } catch (error) {
        return { ok: false, message: error.message }
      }
    },
    async getCardCvv(cardRequestId) {
      return apiRequest(`/cards/requests/${encodeURIComponent(cardRequestId)}/cvv`)
    },
    async resetPassword({ email, token, password }) {
      try {
        const data = await apiRequest('/auth/password-reset', {
          method: 'POST',
          body: JSON.stringify({ email, token, password }),
        })
        return { ok: true, message: data.message }
      } catch (error) {
        return { ok: false, message: error.message }
      }
    },
    async requestPasswordReset(email) {
      try {
        const data = await apiRequest('/auth/password-reset/request', {
          method: 'POST',
          body: JSON.stringify({ email }),
        })
        return { ok: true, message: data.message }
      } catch (error) {
        return { ok: false, message: error.message }
      }
    },
    async requestPinReset(email) {
      try {
        const data = await apiRequest('/auth/pin-reset/request', {
          method: 'POST',
          body: JSON.stringify({ email }),
        })
        return { ok: true, message: data.message }
      } catch (error) {
        return { ok: false, message: error.message }
      }
    },
    async resetPin({ email, token, pin }) {
      try {
        const data = await apiRequest('/auth/pin-reset', {
          method: 'POST',
          body: JSON.stringify({ email, token, pin }),
        })
        return { ok: true, message: data.message }
      } catch (error) {
        return { ok: false, message: error.message }
      }
    },
    async createPasswordReset(userId) {
      try {
        const data = await apiRequest(`/admin/users/${encodeURIComponent(userId)}/password-reset`, { method: 'POST' })
        return { ok: true, message: data.message }
      } catch (error) {
        return { ok: false, error: error.message }
      }
    },
    async transferMoney({ recipient, account, amount, type = 'third', recipientId }) {
      if (!this.currentUserId) return { ok: false, message: 'Debes iniciar sesión.' }
      try {
        const data = await apiRequest('/transfers', {
          method: 'POST',
          headers: { 'Idempotency-Key': createUuid() },
          body: JSON.stringify({ recipient, account, amount, type, recipientId }),
        })
        if (data.summary) this.applyBankingSummary(data.summary)
        else await this.refreshBankingData()
        return { ok: true, transaction: data.transaction }
      } catch (error) {
        return { ok: false, message: error.message }
      }
    },
    async payService({ serviceId, reference, amount, planId }) {
      if (!this.currentUserId) return { ok: false, message: 'Debes iniciar sesión.' }
      try {
        const data = await apiRequest('/services/payments', {
          method: 'POST',
          headers: { 'Idempotency-Key': createUuid() },
          body: JSON.stringify({ serviceId, reference, amount: Number(amount), planId }),
        })
        if (data.summary) this.applyBankingSummary(data.summary)
        else await this.refreshBankingData()
        return { ok: true, transaction: data.transaction }
      } catch (error) {
        return { ok: false, message: error.message }
      }
    },
    async fetchSupportRequests() {
      const data = await apiRequest('/support/requests')
      return data.requests
    },
    async createSupportRequest({ category, subject, message }) {
      try {
        const data = await apiRequest('/support/requests', {
          method: 'POST',
          body: JSON.stringify({ category, subject, message }),
        })
        return { ok: true, request: data.request }
      } catch (error) {
        return { ok: false, message: error.message }
      }
    },
    async fetchAdminSupportRequests() {
      const data = await apiRequest('/admin/support/requests')
      return data.requests
    },
    async updateSupportRequest({ id, status, response }) {
      try {
        const data = await apiRequest(`/admin/support/requests/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ status, response }),
        })
        return { ok: true, request: data.request }
      } catch (error) {
        return { ok: false, message: error.message }
      }
    },
    generateQrCode() {
      const user = this.currentUser
      if (!user) return ''

      const phone = encodeURIComponent(user.phone || '')
      const value = `FASTBANK://PAY?userId=${encodeURIComponent(user.id)}&name=${encodeURIComponent(`${user.firstName} ${user.lastName}`)}&phone=${phone}&cuenta=${phone}`
      this.qrCode = value
      this.persist()
      return value
    },
    async requestLoan({ amount, term }) {
      if (!this.currentUserId) return { ok: false, message: 'Debes iniciar sesión.' }
      try {
        const data = await apiRequest('/loans', {
          method: 'POST',
          headers: { 'Idempotency-Key': createUuid() },
          body: JSON.stringify({ amount, term }),
        })
        if (data.summary) this.applyBankingSummary(data.summary)
        else await this.refreshBankingData()
        return { ok: true, loan: data.loan }
      } catch (error) {
        return { ok: false, message: error.message }
      }
    },
    async fetchInvestments() {
      const data = await apiRequest('/investments')
      this.investmentInstruments = data.instruments
      this.investmentPositions = data.positions
      if (this.currentUser) this.currentUser.investments = data.portfolioValue
      this.persist()
      return data
    },
    async buyInvestment({ symbol, amount, termDays }) {
      try {
        const data = await apiRequest('/investments', {
          method: 'POST',
          headers: { 'Idempotency-Key': createUuid() },
          body: JSON.stringify({ symbol, amount: Number(amount), termDays: Number(termDays) }),
        })
        this.applyBankingSummary(data.summary)
        this.investmentInstruments = data.investments.instruments
        this.investmentPositions = data.investments.positions
        return { ok: true }
      } catch (error) {
        return { ok: false, message: error.message }
      }
    },
    async withdrawInvestment(investmentId) {
      try {
        const data = await apiRequest(`/investments/${encodeURIComponent(investmentId)}/withdraw`, {
          method: 'POST',
          headers: { 'Idempotency-Key': createUuid() },
          body: '{}',
        })
        this.applyBankingSummary(data.summary)
        this.investmentInstruments = data.investments.instruments
        this.investmentPositions = data.investments.positions
        return { ok: true }
      } catch (error) {
        return { ok: false, message: error.message }
      }
    },
    async payLoan(loanId, amount = null) {
      if (!this.currentUserId) return { ok: false, message: 'Debes iniciar sesión.' }
      try {
        const data = await apiRequest(`/loans/${encodeURIComponent(loanId)}/payments`, {
          method: 'POST',
          headers: { 'Idempotency-Key': createUuid() },
          body: JSON.stringify(amount == null ? {} : { amount }),
        })
        if (data.summary) this.applyBankingSummary(data.summary)
        else await this.refreshBankingData()
        return { ok: true, payment: data.payment }
      } catch (error) {
        return { ok: false, message: error.message }
      }
    },
    toggleSubscription(id) {
      const item = this.subscriptions.find((entry) => entry.id === id)
      if (item) {
        item.active = !item.active
      }
      this.persist()
    },
    async updateCardLimit(cardRequestId, value) {
      try {
        return {
          ok: true,
          ...await apiRequest('/cards', {
            method: 'PATCH',
            body: JSON.stringify({ cardRequestId, limit: Number(value) }),
          }),
        }
      } catch (error) {
        return { ok: false, message: error.message }
      }
    },
    async setCardLocked(cardRequestId, locked) {
      if (!this.currentUser) return { ok: false, message: 'Debes iniciar sesión.' }
      try {
        return {
          ok: true,
          ...await apiRequest('/cards', {
            method: 'PATCH',
            body: JSON.stringify({ cardRequestId, locked: Boolean(locked) }),
          }),
        }
      } catch (error) {
        return { ok: false, message: error.message }
      }
    },
    async toggleCardLock(card) {
      return this.setCardLocked(card.id, !card.cardLocked)
    },
    async createPocket({ name, goal }) {
      try {
        await apiRequest('/pockets', { method: 'POST', body: JSON.stringify({ name, goal: Number(goal) }) })
        await this.refreshBankingData()
        return { ok: true }
      } catch (error) {
        return { ok: false, message: error.message }
      }
    },
    async updatePocket({ pocketId, action, amount }) {
      try {
        const data = await apiRequest(`/pockets/${encodeURIComponent(pocketId)}`, {
          method: 'PATCH',
          headers: { 'Idempotency-Key': createUuid() },
          body: JSON.stringify({ action, amount: Number(amount) }),
        })
        if (data.summary) this.applyBankingSummary(data.summary)
        else await this.refreshBankingData()
        return { ok: true }
      } catch (error) {
        return { ok: false, message: error.message }
      }
    },
    async togglePocketLock(pocketId) {
      const pocket = this.currentUser?.pockets.find((entry) => entry.id === pocketId)
      if (!pocket) return { ok: false, message: 'Bolsillo no encontrado.' }
      try {
        await apiRequest(`/pockets/${encodeURIComponent(pocketId)}/lock`, {
          method: 'PATCH',
          body: JSON.stringify({ locked: !pocket.locked }),
        })
        await this.refreshBankingData()
        return { ok: true }
      } catch (error) {
        return { ok: false, message: error.message }
      }
    },
    invest({ symbol, amount }) {
      const user = this.currentUser
      const value = Number(amount)
      const idea = this.investmentIdeas.find((entry) => entry.symbol === symbol)
      if (!user || !idea) return { ok: false, message: 'Inversión no disponible.' }
      if (!Number.isSafeInteger(value) || value <= 0) return { ok: false, message: 'Indica un monto entero positivo.' }
      this.history.unshift({ id: createUuid(), userId: user.id, symbol, amount: value, price: idea.price, date: new Date().toISOString() })
      this.persist()
      return { ok: true }
    },
    applyBankingSummary(summary) {
      const existing = this.users.find((user) => user.id === summary.user.id)
      const user = {
        ...existing,
        ...summary.user,
        balance: summary.account.balance,
        savings: summary.account.savings,
        investments: summary.investmentValue || 0,
        creditLimit: summary.creditAssessment.limit,
        pockets: summary.pockets.map((pocket) => ({ ...pocket, amount: pocket.balance, history: [] })),
      }
      const index = this.users.findIndex((entry) => entry.id === user.id)
      if (index < 0) this.users.push(user)
      else this.users[index] = user
      this.creditAssessment = summary.creditAssessment
      this.transactions = summary.transactions.map((transaction) => ({
        ...transaction,
        userId: this.currentUserId,
        date: transaction.date?.slice(0, 10),
      }))
      this.loans = summary.loans.map((loan) => ({
        ...loan,
        userId: loan.userId || loan.user_id,
        totalPayable: loan.totalPayable ?? loan.total_payable,
        remainingBalance: loan.remainingBalance ?? loan.remaining_balance,
        monthlyPayment: loan.monthlyPayment ?? loan.monthly_payment,
        rate: loan.rate ?? Number(loan.rate_basis_points || 0) / 100,
        dueDate: loan.dueDate || loan.due_date,
      }))
      this.persist()
    },
    async refreshBankingData() {
      if (!this.currentUserId || !sessionToken()) return
      const summary = await apiRequest('/banking/summary')
      this.applyBankingSummary(summary)
      return summary
    },
    async updateProfile(payload) {
      if (!this.currentUserId || !sessionToken()) return { ok: false, message: 'Debes iniciar sesión.' }
      try {
        const data = await apiRequest('/profile', { method: 'PATCH', body: JSON.stringify(payload) })
        const index = this.users.findIndex((user) => user.id === data.user.id)
        if (index >= 0) this.users[index] = { ...this.users[index], ...data.user }
        else this.users.push(data.user)
        this.persist()
        return { ok: true, user: data.user }
      } catch (error) {
        return { ok: false, message: error.message }
      }
    },
    async fetchCardRequests() {
      return apiRequest('/cards/requests')
    },
    async requestCard(payload) {
      try {
        const result = await apiRequest('/cards/requests', {
          method: 'POST',
          body: JSON.stringify(payload),
        })
        return { ok: true, ...result }
      } catch (error) {
        return { ok: false, message: error.message }
      }
    },
    async setupTwoFactor() {
      return apiRequest('/auth/2fa/setup', { method: 'POST' })
    },
    async verifyTwoFactor(code) {
      const result = await apiRequest('/auth/2fa/verify', {
        method: 'POST',
        body: JSON.stringify({ code }),
      })
      if (this.currentUser) this.currentUser.twoFactorEnabled = true
      return result
    },
    async fetchAuditLog() {
      const result = await apiRequest('/audit')
      return result.logs
    },
    async fetchAdminUsers() {
      const result = await apiRequest('/admin/users')
      return result.users
    },
    async refreshProfile() {
      if (!this.currentUserId || !sessionToken()) return
      try {
        const data = await apiRequest('/profile')
        const index = this.users.findIndex((user) => user.id === data.user.id)
        if (index >= 0) this.users[index] = { ...this.users[index], ...data.user }
        else this.users.push(data.user)
        this.persist()
      } catch {
        // La sesión se valida al usar un endpoint protegido.
      }
    },
    updateSecurity(key, value) {
      const user = this.currentUser
      if (!user) return
      user[key] = Boolean(value)
      this.persist()
    },
  },
})
