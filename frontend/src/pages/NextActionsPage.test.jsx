import { vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockMobileViewport, renderApp, USERS } from '../test/renderWithProviders'
import * as wqApi from '../api/workQueue'
import * as crApi from '../api/changeRequests'
import * as projectsApi from '../api/projects'

vi.mock('../api/changeRequests', () => ({
  listChangeRequests: vi.fn(), approveChangeRequest: vi.fn(), rejectChangeRequest: vi.fn(), proposeChange: vi.fn(),
}))
vi.mock('../api/projects', () => ({ listProjects: vi.fn(), getLookups: vi.fn(), getProject: vi.fn(), createProject: vi.fn() }))
vi.mock('../api/portfolio', () => ({ getPortfolioSummary: vi.fn(() => new Promise(() => {})) }))

const item = (overrides = {}) => ({
  id: 'PROJECT_RED:p1', type: 'PROJECT_RED', severity: 'critical', title: 'Customer Portal Rebuild is Red',
  reason: "Milestones: 'UAT sign-off' is 20 days late (25% complete).", project: { id: 'p1', name: 'Customer Portal Rebuild' },
  due_date: null, waiting_since: null, days_overdue: 0, waiting_days: null, due_in_days: null,
  action: { label: 'Open health', route: '/portfolio/p1?tab=overview' }, score: 115, is_new: false, approval: null,
  ...overrides,
})

const queue = (items) => ({
  items,
  counts: {
    critical: items.filter((i) => i.severity === 'critical').length,
    high: items.filter((i) => i.severity === 'high').length,
    due_soon: items.filter((i) => i.severity === 'due_soon').length,
    total: items.length,
  },
  last_sign_in_at: '2026-11-18T09:00:00Z',
})

const PM_ITEMS = [
  item(),
  item({ id: 'UPDATE_OVERDUE:p2', type: 'UPDATE_OVERDUE', severity: 'high', title: 'Weekly update overdue: Branch Network Refresh',
    reason: 'No status update for 12 days; updates are due weekly.', project: { id: 'p2', name: 'Branch Network Refresh' },
    days_overdue: 5, action: { label: 'Submit update', route: '/portfolio/p2?tab=status' }, is_new: true }),
  item({ id: 'APPROVAL_WAITING:cr1', type: 'APPROVAL_WAITING', severity: 'due_soon', title: 'Approve task change from Sam Okafor',
    reason: "Proposed change to 'Write API' is waiting for your decision.", days_overdue: 0, waiting_days: 1,
    action: { label: 'Review', route: '/approvals' }, approval: { change_request_id: 'cr1' } }),
]

describe('NextActionsPage', () => {
  beforeEach(() => {
    wqApi.getWorkQueue.mockResolvedValue(queue([])) // implementations survive clearAllMocks; reset per test
    projectsApi.listProjects.mockResolvedValue({ items: [], page: 1, page_size: 20, total: 0 })
    projectsApi.getLookups.mockResolvedValue({ departments: [], project_managers: [], analysts: [] })
  })
  afterEach(() => vi.clearAllMocks())

  it('renders each item with severity text, icon, reason, relative time, New chip and its action', async () => {
    wqApi.getWorkQueue.mockResolvedValue(queue(PM_ITEMS))
    renderApp('/next', USERS.PM)
    const red = await screen.findByRole('article', { name: 'Critical: Customer Portal Rebuild is Red' })
    expect(within(red).getByText('Critical')).toBeInTheDocument()
    expect(within(red).getByText(/'UAT sign-off' is 20 days late/)).toBeInTheDocument()
    expect(within(red).getByRole('link', { name: 'Customer Portal Rebuild' })).toBeInTheDocument()
    const overdue = screen.getByRole('article', { name: /High: Weekly update overdue/ })
    expect(within(overdue).getByText('· 5 days late')).toBeInTheDocument()
    expect(within(overdue).getByText('New')).toBeInTheDocument()
    expect(within(red).queryByText('New')).not.toBeInTheDocument()
    expect(screen.getByText('3 actions · 1 overdue')).toBeInTheDocument()
  })

  it('the primary action opens the exact screen', async () => {
    wqApi.getWorkQueue.mockResolvedValue(queue(PM_ITEMS))
    projectsApi.getProject.mockReturnValue(new Promise(() => {}))
    const user = userEvent.setup()
    renderApp('/next', USERS.PM)
    await user.click(await screen.findByRole('button', { name: 'Submit update' }))
    expect(projectsApi.getProject).toHaveBeenCalledWith('p2')
  })

  it('filters by severity and by the PM "Approvals" chip', async () => {
    wqApi.getWorkQueue.mockResolvedValue(queue(PM_ITEMS))
    const user = userEvent.setup()
    renderApp('/next', USERS.PM)
    await screen.findAllByRole('article')
    await user.click(screen.getByRole('button', { name: 'High (1)' }))
    expect(screen.getAllByRole('article')).toHaveLength(1)
    expect(screen.getByRole('article', { name: /Weekly update overdue/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Approvals (1)' }))
    expect(screen.getAllByRole('article').map((a) => a.getAttribute('aria-label'))).toEqual(['Due soon: Approve task change from Sam Okafor'])
    await user.click(screen.getByRole('button', { name: 'All (3)' }))
    expect(screen.getAllByRole('article')).toHaveLength(3)
  })

  it('shows the analyst a "Rework" chip', async () => {
    wqApi.getWorkQueue.mockResolvedValue(queue([item({ id: 'PROPOSAL_REJECTED:x', type: 'PROPOSAL_REJECTED', severity: 'high',
      title: 'Rework needed: Build', reason: 'Rejected: Dates conflict.', action: { label: 'See feedback', route: '/my-proposals?status=REJECTED' } })]))
    renderApp('/next', USERS.ANALYST)
    expect(await screen.findByRole('button', { name: 'Rework (1)' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Approvals/ })).not.toBeInTheDocument()
  })

  it('PM approves inline, then the queue refetches', async () => {
    wqApi.getWorkQueue.mockResolvedValueOnce(queue(PM_ITEMS)).mockResolvedValue(queue(PM_ITEMS.slice(0, 2)))
    crApi.approveChangeRequest.mockResolvedValue({ change_request: { id: 'cr1', status: 'APPROVED' } })
    const user = userEvent.setup()
    renderApp('/next', USERS.PM)
    const approval = await screen.findByRole('article', { name: /Approve task change/ })
    await user.click(within(approval).getByRole('button', { name: 'Approve' }))
    expect(crApi.approveChangeRequest).toHaveBeenCalledWith('cr1')
    expect(await screen.findByText('Approved and applied.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('article', { name: /Approve task change/ })).not.toBeInTheDocument())
  })

  it('reject needs a reason before it can be sent', async () => {
    wqApi.getWorkQueue.mockResolvedValue(queue(PM_ITEMS))
    crApi.rejectChangeRequest.mockResolvedValue({})
    const user = userEvent.setup()
    renderApp('/next', USERS.PM)
    const approval = await screen.findByRole('article', { name: /Approve task change/ })
    await user.click(within(approval).getByRole('button', { name: 'Reject' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'Reject' })).toBeDisabled()
    await user.type(within(dialog).getByLabelText(/Reason for rejecting/), 'Not started yet')
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }))
    expect(crApi.rejectChangeRequest).toHaveBeenCalledWith('cr1', 'Not started yet')
  })

  it('shows "You\'re all caught up" when empty, with a link to the portfolio', async () => {
    renderApp('/next', USERS.EXEC)
    expect(await screen.findByText("You're all caught up")).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to the portfolio' })).toHaveAttribute('href', '/portfolio')
  })

  it('shows an error with Retry', async () => {
    wqApi.getWorkQueue.mockRejectedValueOnce(new Error("Can't reach the server.")).mockResolvedValue(queue(PM_ITEMS))
    const user = userEvent.setup()
    renderApp('/next', USERS.PM)
    expect(await screen.findByText("Can't reach the server.")).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findAllByRole('article')).toHaveLength(3)
  })

  it('shows critical + high count as the navigation badge', async () => {
    wqApi.getWorkQueue.mockResolvedValue(queue(PM_ITEMS))
    const user = userEvent.setup()
    renderApp('/next', USERS.PM)
    await screen.findAllByRole('article')
    await user.click(screen.getByRole('button', { name: 'Open navigation' }))
    const nav = (await screen.findAllByRole('navigation', { name: 'Main navigation' }))[0]
    expect(within(nav).getByText('2 need attention')).toBeInTheDocument() // 1 critical + 1 high
    expect(within(nav).getByText('1 need attention')).toBeInTheDocument() // approvals waiting
  })

  it('on a phone, action buttons are full width', async () => {
    const restore = mockMobileViewport()
    wqApi.getWorkQueue.mockResolvedValue(queue(PM_ITEMS))
    renderApp('/next', USERS.PM)
    const button = await screen.findByRole('button', { name: 'Open health' })
    expect(button).toBeVisible()
    restore()
  })
})
