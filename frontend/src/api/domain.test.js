import { vi } from 'vitest'
import * as client from './client'
import { changePassword, login, me } from './auth'
import { createUser, listUsers, resetPassword, unlockUser, updateUser } from './users'
import { getLookups, getProject, listProjects } from './projects'

describe('domain API modules', () => {
  let fetchMock
  beforeEach(() => {
    fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ token: 't', expires_at: '2099-01-01T00:00:00Z', user: { id: 'u' } }), { status: 200 })))
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => { vi.unstubAllGlobals(); client.clearSession() })

  const call = (i = 0) => ({ url: fetchMock.mock.calls[i][0], init: fetchMock.mock.calls[i][1] })

  it('login stores the session and does not send a token', async () => {
    await login('a@b.co', 'pw')
    expect(call().url).toMatch(/\/api\/auth\/login$/)
    expect(call().init.headers.Authorization).toBeUndefined()
    expect(JSON.parse(call().init.body)).toEqual({ email: 'a@b.co', password: 'pw' })
    expect(client.getSession().token).toBe('t')
  })

  it('changePassword sends snake_case fields and stores the new session', async () => {
    await changePassword('old', 'new')
    expect(JSON.parse(call().init.body)).toEqual({ current_password: 'old', new_password: 'new' })
    expect(client.getSession().token).toBe('t')
  })

  it('builds the right paths and methods', async () => {
    await me()
    await listUsers({ q: 'a', page: 2 })
    await createUser({ email: 'x@y.z' })
    await updateUser('id/1', { version: 1 })
    await resetPassword('u1')
    await unlockUser('u1')
    await listProjects({ sort: '-name' })
    await getProject('p1')
    await getLookups()
    const seen = fetchMock.mock.calls.map(([url, init]) => `${init.method} ${url.replace(/^.*\/api/, '')}`)
    expect(seen).toEqual([
      'GET /auth/me',
      'GET /users?q=a&page=2',
      'POST /users',
      'PUT /users/id%2F1',
      'POST /users/u1/reset-password',
      'POST /users/u1/unlock',
      'GET /projects?sort=-name',
      'GET /projects/p1',
      'GET /projects/lookups',
    ])
    expect(fetchMock.mock.calls[2][1].headers['Idempotency-Key']).toBeTruthy()
  })
})
