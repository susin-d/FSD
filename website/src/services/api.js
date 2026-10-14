const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:4000/api/v1').replace(/\/$/, '')
const TOKEN_KEY = 'nearby.token'

export class ApiError extends Error {
  constructor(message, code = 'REQUEST_FAILED', status = 0) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

export function getToken() {
  return window.sessionStorage.getItem(TOKEN_KEY)
}

export function setToken(token) {
  if (token) window.sessionStorage.setItem(TOKEN_KEY, token)
  else window.sessionStorage.removeItem(TOKEN_KEY)
}

export function unwrap(response) {
  return response?.data ?? response
}

export async function apiRequest(path, options = {}) {
  const { method = 'GET', body, headers = {}, ...rest } = options
  const token = getToken()
  const requestHeaders = new Headers(headers)

  if (body !== undefined && !(body instanceof FormData)) {
    requestHeaders.set('Content-Type', 'application/json')
  }
  if (token) requestHeaders.set('Authorization', `Bearer ${token}`)

  let response
  try {
    response = await fetch(`${API_BASE}${path.startsWith('/') ? path : `/${path}`}`, {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
      ...rest,
    })
  } catch {
    throw new ApiError('Could not reach Nearby. Check that the API is running and try again.', 'NETWORK_ERROR')
  }

  let payload
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok || payload?.success === false) {
    const error = payload?.error
    throw new ApiError(error?.message || payload?.message || `Request failed (${response.status}).`, error?.code || 'REQUEST_FAILED', response.status)
  }
  return unwrap(payload)
}

export const api = {
  get: (path, options) => apiRequest(path, { ...options, method: 'GET' }),
  post: (path, body, options) => apiRequest(path, { ...options, method: 'POST', body }),
  patch: (path, body, options) => apiRequest(path, { ...options, method: 'PATCH', body }),
  put: (path, body, options) => apiRequest(path, { ...options, method: 'PUT', body }),
}

export function asList(value) {
  if (Array.isArray(value)) return value
  if (Array.isArray(value?.items)) return value.items
  if (Array.isArray(value?.results)) return value.results
  if (Array.isArray(value?.services)) return value.services
  if (Array.isArray(value?.bookings)) return value.bookings
  if (Array.isArray(value?.messages)) return value.messages
  if (Array.isArray(value?.disputes)) return value.disputes
  if (Array.isArray(value?.reviews)) return value.reviews
  if (Array.isArray(value?.slots)) return value.slots
  if (Array.isArray(value?.availability)) return value.availability
  return []
}

export function idOf(value) {
  return value?._id || value?.id || value?.serviceId || value?.bookingId || ''
}

export function formatMoney(value) {
  if (value == null || value === '') return 'Price on request'
  const amount = Number(value)
  if (!Number.isFinite(amount)) return String(value)
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: amount % 1 ? 2 : 0 }).format(amount)
}

export function errorMessage(error, fallback = 'Something went wrong. Please try again.') {
  return error instanceof Error ? error.message : fallback
}
