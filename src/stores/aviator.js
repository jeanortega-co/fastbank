import { defineStore } from 'pinia'
import { useBankStore } from './bank'
import { createUuid } from '@/utils/uuid'

const API_URL = import.meta.env.VITE_API_URL || '/api'

const sessionToken = () => (typeof sessionStorage === 'undefined' ? '' : sessionStorage.getItem('fastbank-token') || '')

const apiRequest = async (path, options = {}) => {
  const response = await fetch(`${API_URL}${path}${path.includes('?') ? '&' : '?'}_=${Date.now()}`, {
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
    const message = data.message || `El servidor respondió con un error (${response.status}).`
    const error = new Error(message)
    error.status = response.status
    error.data = data
    throw error
  }

  return data
}

const calculateLocalMultiplier = (startedAt, timestamp = Date.now()) => {
  if (!startedAt) return 1
  const start = new Date(startedAt).getTime()
  if (!Number.isFinite(start)) return 1
  return Number(Math.max(1, Math.exp(Math.max(0, timestamp - start) / 10000)).toFixed(2))
}

export const useAviatorStore = defineStore('aviator', {
  state: () => ({
    round: null,
    history: { rounds: [], bets: [] },
    allBets: [],
    clockOffset: 0,
    eventSource: null,
    isLoading: false,
    isBusy: false,
    error: '',
    success: '',
  }),
  getters: {
    phase: (state) => state.round?.status || 'betting',
    localMultiplier: (state) => {
      if (!state.round?.startedAt) return 1
      const serverTime = Date.now() - state.clockOffset
      return calculateLocalMultiplier(state.round.startedAt, serverTime)
    },
    betsBySlot: (state) => (slot) => {
      const round = state.round
      if (!round || !Array.isArray(round.bets)) return null
      return round.bets.find((bet) => Number(bet.slot) === Number(slot)) || null
    },
  },
  actions: {
    applyRoundState(payload) {
      const data = payload?.round ? payload : { round: payload }
      if (!data.round) return
      this.round = data.round
      if (Number.isFinite(data.serverTime)) this.clockOffset = Date.now() - data.serverTime
      if (data.round?.status) this.error = ''
    },
    async loadState() {
      this.isLoading = true
      try {
        const data = await apiRequest('/casino/aviator/state')
        this.applyRoundState(data)
        return data
      } finally {
        this.isLoading = false
      }
    },
    async loadHistory() {
      try {
        const data = await apiRequest('/casino/aviator/history')
        this.history = data
        return data
      } catch (error) {
        this.error = error.message
        return { rounds: [], bets: [] }
      }
    },
    async connectSse() {
      if (this.eventSource || !sessionToken()) return
      try {
        const { ticket } = await apiRequest('/casino/aviator/stream-ticket', { method: 'POST' })
        const eventSource = new EventSource(`${API_URL}/casino/aviator/stream?ticket=${encodeURIComponent(ticket)}`)

        eventSource.addEventListener('open', async () => {
          this.error = ''
          await this.loadState()
        })

        eventSource.addEventListener('state', (event) => {
          try {
            const payload = JSON.parse(event.data)
            this.applyRoundState(payload)
          } catch (error) {
            console.error('No se pudo interpretar el estado del aviator.', error)
          }
        })

        eventSource.addEventListener('heartbeat', () => {
          this.error = ''
        })

        eventSource.addEventListener('error', () => {
          this.error = 'Se perdió la conexión en vivo del casino. Reintentando...'
          setTimeout(() => {
            if (this.eventSource) this.disconnectSse()
            this.connectSse().catch(() => undefined)
          }, 1500)
        })

        this.eventSource = eventSource
      } catch (error) {
        this.error = error.message
      }
    },
    disconnectSse() {
      if (this.eventSource) {
        this.eventSource.close()
        this.eventSource = null
      }
    },
    async refreshBalance() {
      const store = useBankStore()
      await store.refreshBankingData()
    },
    async placeBet({ slot, amount, autoCashout = null }) {
      if (!slot || !Number.isFinite(amount) || Number(amount) <= 0) {
        return { ok: false, message: 'Indica un monto válido para apostar.' }
      }

      const normalizeMessage = (message) => {
        const readable = String(message || 'El servidor rechazó la apuesta.')
        if (/saldo/i.test(readable) || /insuficiente/i.test(readable)) return 'Saldo insuficiente para esa apuesta.'
        if (/fase/i.test(readable)) return 'Solo puedes apostar durante la fase de apuestas.'
        if (/límite|limite/i.test(readable)) return 'Has alcanzado un límite del casino o de tu cuenta.'
        if (/autoexclusión|exclusión/i.test(readable)) return 'Tu autoexclusión está activa en este momento.'
        return readable
      }

      this.isBusy = true
      this.success = ''
      this.error = ''
      try {
        const data = await apiRequest('/casino/aviator/bet', {
          method: 'POST',
          headers: { 'Idempotency-Key': createUuid() },
          body: JSON.stringify({ slot: Number(slot), amount: Number(amount), auto_cashout: autoCashout == null ? null : Number(autoCashout) }),
        })
        this.success = 'Apuesta realizada.'
        await this.refreshBalance()
        await this.loadState()
        await this.loadHistory()
        return { ok: true, data }
      } catch (error) {
        const message = normalizeMessage(error.message)
        this.error = message
        return { ok: false, message }
      } finally {
        this.isBusy = false
      }
    },
    async cashOut({ slot }) {
      this.isBusy = true
      this.success = ''
      this.error = ''
      try {
        const data = await apiRequest('/casino/aviator/cashout', {
          method: 'POST',
          body: JSON.stringify({ slot: Number(slot) }),
        })
        this.success = 'Retiro ejecutado con éxito.'
        await this.refreshBalance()
        await this.loadState()
        await this.loadHistory()
        return { ok: true, data }
      } catch (error) {
        const message = String(error.message || 'No se pudo completar el retiro.')
        this.error = message
        return { ok: false, message }
      } finally {
        this.isBusy = false
      }
    },
  },
})
