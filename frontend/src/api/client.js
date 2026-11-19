/**
 * Beacon API client: the ONE place that talks HTTP.
 * Attaches the bearer token, renews the session while the user is active,
 * reports expired sessions and turns failures into friendly ApiErrors.
 */

const SESSION_KEY = 'beacon.session'
const RENEW_WINDOW_MS = 10 * 60 * 1000
const RETRY_DELAY_MS = 2000
const RETRYABLE_STATUSES = new Set([503, 504])

export const NETWORK_ERROR_MESSAGE = "Can't reach the server. Check your connection and try again."
export const SERVER_ERROR_MESSAGE = 'Something went wrong on our side. Please try again.'

/** Base URL of the API, e.g. "http://localhost:3001/api" locally or "/api" behind CloudFront. */
export function apiBase() {
  return `${import.meta.env.VITE_API_URL ?? ''}/api`
}

/** Error thrown for every failed request. */
export class ApiError extends Error {
  /**
   * @param {object} init
   * @param {number} init.status HTTP status (0 for network failures)
   * @param {string} init.code machine-readable code, e.g. VALIDATION_ERROR
   * @param {string} init.message user-friendly message
   * @param {Array<{field: string, message: string}>} [init.details]
   */
  constructor({ status, code, message, details = [] }) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

/** @returns {{token: string, expires_at: string, user: object} | null} the stored session */
export function getSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

/** Persist a session returned by login/refresh/change-password. */
export function setSession(session) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

/** Remove the stored session. */
export function clearSession() {
  sessionStorage.removeItem(SESSION_KEY)
}

const expiredListeners = new Set()

/**
 * Subscribe to "session expired" events (a 401 on an authenticated request).
 * @param {() => void} listener
 * @returns {() => void} unsubscribe
 */
export function onSessionExpired(listener) {
  expiredListeners.add(listener)
  return () => expiredListeners.delete(listener)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function parseBody(response) {
  if (response.status === 204) return null
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function toApiError(status, body) {
  const err = body && body.error
  if (status >= 500) {
    return new ApiError({ status, code: err?.code || 'INTERNAL', message: SERVER_ERROR_MESSAGE, details: [] })
  }
  return new ApiError({
    status,
    code: err?.code || 'ERROR',
    message: err?.message || 'The request could not be completed.',
    details: Array.isArray(err?.details) ? err.details : [],
  })
}

async function rawFetch(path, { method = 'GET', body, idempotencyKey, token } = {}) {
  const headers = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey
  let response
  try {
    response = await fetch(`${apiBase()}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError({ status: 0, code: 'NETWORK_ERROR', message: NETWORK_ERROR_MESSAGE })
  }
  return response
}

let refreshInFlight = null

/** Renew the token if it expires within the renewal window (single-flight). */
async function renewIfNeeded() {
  const session = getSession()
  if (!session?.token || !session.expires_at) return
  const remaining = new Date(session.expires_at).getTime() - Date.now()
  if (remaining > RENEW_WINDOW_MS || remaining <= 0) return
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const response = await rawFetch('/auth/refresh', { method: 'POST', token: session.token })
        if (response.ok) {
          const data = await parseBody(response)
          if (data?.token) setSession(data)
        }
      } catch {
        // Renewal is best effort; the real request will report any problem.
      } finally {
        refreshInFlight = null
      }
    })()
  }
  await refreshInFlight
}

/**
 * Perform an API request.
 * @param {string} path path below /api, e.g. "/projects?page=1"
 * @param {object} [options]
 * @param {string} [options.method]
 * @param {object} [options.body] JSON body
 * @param {string} [options.idempotencyKey] sent as the Idempotency-Key header
 * @param {boolean} [options.auth=true] attach the session token
 * @returns {Promise<any>} parsed JSON body (null for 204)
 * @throws {ApiError}
 */
export async function request(path, { method = 'GET', body, idempotencyKey, auth = true } = {}) {
  if (auth) await renewIfNeeded()
  const token = auth ? getSession()?.token : undefined
  let response = await rawFetch(path, { method, body, idempotencyKey, token })
  if (method === 'GET' && RETRYABLE_STATUSES.has(response.status)) {
    await sleep(RETRY_DELAY_MS)
    response = await rawFetch(path, { method, body, idempotencyKey, token })
  }
  const data = await parseBody(response)
  if (response.ok) return data
  if (response.status === 401 && token) {
    clearSession()
    expiredListeners.forEach((listener) => listener())
  }
  throw toApiError(response.status, data)
}

/**
 * Build a query string from an object, skipping empty values.
 * @param {Record<string, any>} params
 * @returns {string} "?a=1&b=2" or ""
 */
export function toQuery(params = {}) {
  const search = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value))
  })
  const qs = search.toString()
  return qs ? `?${qs}` : ''
}

/** @returns {string} a random idempotency key for create requests */
export function newIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}
