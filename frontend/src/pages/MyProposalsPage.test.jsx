import { vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp, USERS } from '../test/renderWithProviders'
import * as crApi from '../api/changeRequests'

vi.mock('../api/changeRequests', () => ({
  listChangeRequests: vi.fn(), approveChangeRequest: vi.fn(), rejectChangeRequest: vi.fn(), proposeChange: vi.fn(),
}))

const proposal = (overrides = {}) => ({
  id: 'cr1', project: { id: 'p1', name: 'Customer Portal Rebuild' }, entity_type: 'TASK', entity_id: 't1',
  entity_name: 'Build reports', proposer: USERS.ANALYST, changes: { status: 'DONE' }, current: { status: 'TODO' },
  note: null, status: 'PENDING', reason: null, decided_by: null, decided_at: null, created_at: '2026-11-19T10:00:00Z',
  ...overrides,
})

describe('MyProposalsPage (PM Analyst home)', () => {
  afterEach(() => vi.clearAllMocks())

  it('is the PM Analyst home and lists pending proposals first', async () => {
    crApi.listChangeRequests.mockResolvedValue({ items: [proposal()], page: 1, page_size: 20, total: 1 })
    renderApp('/', USERS.ANALYST)
    expect(await screen.findByRole('heading', { level: 1, name: 'My proposals' })).toBeInTheDocument()
    expect(await screen.findByText('Task: Build reports')).toBeInTheDocument()
    expect(crApi.listChangeRequests).toHaveBeenCalledWith({ view: 'mine', status: 'PENDING', page: 1, page_size: 20 })
  })

  it('filters by status and shows the reason for a rejection', async () => {
    crApi.listChangeRequests.mockImplementation(({ status }) => Promise.resolve(
      status === 'REJECTED'
        ? { items: [proposal({ id: 'cr9', status: 'REJECTED', reason: 'Dates conflict with the release freeze.', decided_by: { id: 'm1', display_name: 'Jordan Lee' }, decided_at: '2026-11-19T12:00:00Z' })], page: 1, page_size: 20, total: 1 }
        : { items: [], page: 1, page_size: 20, total: 0 },
    ))
    const user = userEvent.setup()
    renderApp('/my-proposals', USERS.ANALYST)
    expect(await screen.findByText('No pending proposals')).toBeInTheDocument()
    expect(screen.getByText('Open one of your projects and choose Propose change on a milestone or task.')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Rejected' }))
    expect(crApi.listChangeRequests).toHaveBeenLastCalledWith({ view: 'mine', status: 'REJECTED', page: 1, page_size: 20 })
    expect(await screen.findByText('Dates conflict with the release freeze.')).toBeInTheDocument()
    expect(screen.getByText(/Rejected by Jordan Lee/)).toBeInTheDocument()
  })

  it('is not available to other roles', async () => {
    crApi.listChangeRequests.mockResolvedValue({ items: [], page: 1, page_size: 20, total: 0 })
    renderApp('/my-proposals', USERS.PM)
    expect(await screen.findByRole('heading', { level: 1, name: 'My work' })).toBeInTheDocument()
  })
})
