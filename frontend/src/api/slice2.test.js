import { vi } from 'vitest'
import * as client from './client'
import { archiveProject, cancelProject, createProject, getTeam, updateProject } from './projects'
import { createMilestone, deleteMilestone, listMilestones, updateMilestone } from './milestones'
import { createTask, deleteTask, listTasks, updateTask } from './tasks'
import { listStatusUpdates, submitStatusUpdate } from './statusUpdates'
import { assignAnalyst, listAnalysts, removeAnalyst } from './analysts'
import { listProjectAudit } from './audit'
import { approveChangeRequest, listChangeRequests, proposeChange, rejectChangeRequest } from './changeRequests'

describe('slice 2 API modules match the backend contract', () => {
  let fetchMock
  beforeEach(() => {
    client.setSession({ token: 'tok', expires_at: new Date(Date.now() + 1800000).toISOString(), user: { id: 'u' } })
    fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })))
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => { vi.unstubAllGlobals(); client.clearSession() })

  const calls = () => fetchMock.mock.calls.map(([url, init]) => ({
    line: `${init.method} ${url.replace(/^.*\/api/, '')}`,
    body: init.body ? JSON.parse(init.body) : undefined,
    key: init.headers['Idempotency-Key'],
  }))

  it('builds paths, methods and bodies', async () => {
    await createProject({ name: 'X' }, 'key-1')
    await updateProject('p1', { name: 'Y', version: 2 })
    await archiveProject('p1', 3)
    await cancelProject('p1', 4, 'Funding withdrawn')
    await cancelProject('p1', 5)
    await getTeam('p1')
    await listMilestones('p1')
    await createMilestone('p1', { name: 'M' })
    await updateMilestone('p1', 'm1', { version: 1 })
    await deleteMilestone('p1', 'm1')
    await listTasks('p1', 'm1')
    await createTask('p1', { title: 'T' })
    await updateTask('p1', 't1', { version: 1 })
    await deleteTask('p1', 't1')
    await listStatusUpdates('p1')
    await submitStatusUpdate('p1', { reported_status: 'GREEN', summary: 'ok' })
    await listAnalysts('p1')
    await assignAnalyst('p1', 'n1')
    await removeAnalyst('p1', 'n1')
    await listProjectAudit('p1', { page: 2, page_size: 20 })
    await proposeChange('p1', { entity_type: 'TASK', entity_id: 't1', changes: { status: 'DONE' } })
    await listChangeRequests({ view: 'approvals', status: 'PENDING', page: 1, page_size: 10 })
    await approveChangeRequest('cr1')
    await rejectChangeRequest('cr1', 'Not yet')
    const seen = calls()
    expect(seen.map((c) => c.line)).toEqual([
      'POST /projects',
      'PUT /projects/p1',
      'POST /projects/p1/archive',
      'POST /projects/p1/cancel',
      'POST /projects/p1/cancel',
      'GET /projects/p1/team',
      'GET /projects/p1/milestones',
      'POST /projects/p1/milestones',
      'PUT /projects/p1/milestones/m1',
      'DELETE /projects/p1/milestones/m1',
      'GET /projects/p1/tasks?milestone_id=m1',
      'POST /projects/p1/tasks',
      'PUT /projects/p1/tasks/t1',
      'DELETE /projects/p1/tasks/t1',
      'GET /projects/p1/status-updates',
      'POST /projects/p1/status-updates',
      'GET /projects/p1/analysts',
      'POST /projects/p1/analysts',
      'DELETE /projects/p1/analysts/n1',
      'GET /projects/p1/audit?page=2&page_size=20',
      'POST /projects/p1/change-requests',
      'GET /change-requests?view=approvals&status=PENDING&page=1&page_size=10',
      'POST /change-requests/cr1/approve',
      'POST /change-requests/cr1/reject',
    ])
    expect(seen[0].key).toBe('key-1')
    expect(seen[2].body).toEqual({ version: 3 })
    expect(seen[3].body).toEqual({ version: 4, reason: 'Funding withdrawn' })
    expect(seen[4].body).toEqual({ version: 5 })
    expect(seen[17].body).toEqual({ user_id: 'n1' })
    expect(seen[23].body).toEqual({ reason: 'Not yet' })
    // every create sends an Idempotency-Key
    ;[7, 11, 15, 17, 20].forEach((i) => expect(seen[i].key).toBeTruthy())
    expect(seen[1].key).toBeUndefined()
  })
})
