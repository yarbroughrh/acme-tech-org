import { vi } from 'vitest'
import {
  ApiError, NETWORK_ERROR_MESSAGE, SERVER_ERROR_MESSAGE, clearSession, getSession, onSessionExpired, request, setSession, toQuery,
} from './client'

const jsonResponse = (status, body) => new Response(body === undefined ? '' : JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
})

const farFuture = () => new Date(Date.now() + 30 * 60 * 1000).toISOString()

describe('api client', () => {
  let fetchMock

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    clearSession()
  })

  it('attaches the bearer token and idempotency key', async () => {
    setSession({ token: 'tok123', expires_at: farFuture(), user: { id: 'u1' } })
    fetchMock.mockResolvedValue(jsonResponse(201, { ok: true }))
    const data = await request('/users', { method: 'POST', body: { a: 1 }, idempotencyKey: 'k-1' })
    expect(data).toEqual({ ok: true })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toMatch(/\/api\/users$/)
    expect(init.headers.Authorization).toBe('Bearer tok123')
    expect(init.headers['Idempotency-Key']).toBe('k-1')
    expect(init.body).toBe('{"a":1}')
  })

  it('maps the error shape to an ApiError', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, {
      error: { code: 'VALIDATION_ERROR', message: 'Name is required.', details: [{ field: 'name', message: 'Required' }] },
    }))
    const err = await request('/projects', { auth: false }).catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(400)
    expect(err.code).toBe('VALIDATION_ERROR')
    expect(err.message).toBe('Name is required.')
    expect(err.details).toEqual([{ field: 'name', message: 'Required' }])
  })

  it('hides server error details behind a friendly message', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { error: { code: 'INTERNAL', message: 'psycopg exploded' } }))
    const err = await request('/x', { method: 'POST', auth: false }).catch((e) => e)
    expect(err.message).toBe(SERVER_ERROR_MESSAGE)
  })

  it('reports network failures in plain language', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const err = await request('/x', { auth: false }).catch((e) => e)
    expect(err.status).toBe(0)
    expect(err.message).toBe(NETWORK_ERROR_MESSAGE)
  })

  it('clears the session and notifies listeners on 401', async () => {
    setSession({ token: 'tok', expires_at: farFuture(), user: { id: 'u1' } })
    const listener = vi.fn()
    const unsubscribe = onSessionExpired(listener)
    fetchMock.mockResolvedValue(jsonResponse(401, { error: { code: 'UNAUTHENTICATED', message: 'Sign in again.' } }))
    await expect(request('/projects')).rejects.toMatchObject({ status: 401 })
    expect(getSession()).toBeNull()
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('retries a GET once after a 503 (database resuming)', async () => {
    vi.useFakeTimers()
    fetchMock
      .mockResolvedValueOnce(jsonResponse(503, { error: { code: 'UNAVAILABLE', message: 'x' } }))
      .mockResolvedValueOnce(jsonResponse(200, { items: [] }))
    const promise = request('/projects', { auth: false })
    await vi.advanceTimersByTimeAsync(2000)
    await expect(promise).resolves.toEqual({ items: [] })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry non-GET requests', async () => {
    fetchMock.mockResolvedValue(jsonResponse(504, null))
    await expect(request('/projects', { method: 'POST', auth: false })).rejects.toMatchObject({ status: 504 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('renews a session that is about to expire before the request', async () => {
    setSession({ token: 'old', expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(), user: { id: 'u1' } })
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { token: 'new', expires_at: farFuture(), user: { id: 'u1' } }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }))
    await request('/projects')
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/auth\/refresh$/)
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer new')
    expect(getSession().token).toBe('new')
  })

  it('builds query strings without empty values', () => {
    expect(toQuery({ q: 'pay', page: 1, role: '', x: null })).toBe('?q=pay&page=1')
    expect(toQuery({})).toBe('')
  })
})
