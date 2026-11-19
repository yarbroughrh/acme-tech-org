import { vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ApprovalsList from './ApprovalsList'
import * as crApi from '../api/changeRequests'
import { ApiError } from '../api/client'
import { mockMobileViewport, renderWithProviders, USERS } from '../test/renderWithProviders'

vi.mock('../api/changeRequests', () => ({
  listChangeRequests: vi.fn(), approveChangeRequest: vi.fn(), rejectChangeRequest: vi.fn(), proposeChange: vi.fn(),
}))

const pending = (overrides = {}) => ({
  id: 'cr1',
  project: { id: 'p1', name: 'Customer Portal Rebuild' },
  entity_type: 'MILESTONE',
  entity_id: 'm1',
  entity_name: 'UAT sign-off',
  proposer: { id: 'n1', display_name: 'Sam Okafor' },
  changes: { status: 'COMPLETE', percent_complete: 100 },
  current: { status: 'IN_PROGRESS', percent_complete: 40 },
  note: 'Signed off in the steering meeting.',
  status: 'PENDING',
  reason: null,
  decided_by: null,
  decided_at: null,
  created_at: '2026-11-19T10:00:00Z',
  ...overrides,
})

const page = (items) => ({ items, page: 1, page_size: 10, total: items.length })

describe('ApprovalsList', () => {
  afterEach(() => vi.clearAllMocks())

  it('shows each request with a field | current | proposed diff', async () => {
    crApi.listChangeRequests.mockResolvedValue(page([pending()]))
    renderWithProviders(<ApprovalsList />, { user: USERS.PM })
    const table = await screen.findByRole('table', { name: 'Proposed changes' })
    expect(within(table).getByText('Status')).toBeInTheDocument()
    expect(within(table).getByText('In progress')).toBeInTheDocument()
    expect(within(table).getByText('Complete')).toBeInTheDocument()
    expect(within(table).getByText('40%')).toBeInTheDocument()
    expect(within(table).getByText('100%')).toBeInTheDocument()
    expect(screen.getByText('Milestone: UAT sign-off')).toBeInTheDocument()
    expect(screen.getByText(/proposed by Sam Okafor/)).toBeInTheDocument()
    expect(screen.getByText('“Signed off in the steering meeting.”')).toBeInTheDocument()
    expect(crApi.listChangeRequests).toHaveBeenCalledWith({ view: 'approvals', status: 'PENDING', page: 1, page_size: 10 })
  })

  it('requires a reason before rejecting', async () => {
    crApi.listChangeRequests.mockResolvedValue(page([pending()]))
    crApi.rejectChangeRequest.mockResolvedValue({ change_request: pending({ status: 'REJECTED' }) })
    const user = userEvent.setup()
    renderWithProviders(<ApprovalsList />, { user: USERS.PM })
    await user.click(await screen.findByRole('button', { name: 'Reject change to UAT sign-off' }))
    const dialog = screen.getByRole('dialog', { name: 'Reject proposal' })
    const rejectButton = within(dialog).getByRole('button', { name: 'Reject' })
    expect(rejectButton).toBeDisabled()
    const reason = within(dialog).getByLabelText(/Reason for rejecting/)
    await user.click(reason)
    await user.tab()
    expect(within(dialog).getByText('A reason is required to reject.')).toBeInTheDocument()
    await user.type(reason, '   ')
    expect(rejectButton).toBeDisabled()
    expect(crApi.rejectChangeRequest).not.toHaveBeenCalled()
    await user.type(reason, 'UAT is not signed off yet')
    await user.click(rejectButton)
    expect(crApi.rejectChangeRequest).toHaveBeenCalledWith('cr1', 'UAT is not signed off yet')
    expect(await screen.findByText('Proposal rejected. The analyst can see your reason.')).toBeInTheDocument()
  })

  it('approves, confirms and refreshes the list', async () => {
    crApi.listChangeRequests.mockResolvedValueOnce(page([pending()])).mockResolvedValueOnce(page([]))
    crApi.approveChangeRequest.mockResolvedValue({ change_request: pending({ status: 'APPROVED' }) })
    const user = userEvent.setup()
    renderWithProviders(<ApprovalsList />, { user: USERS.PM })
    await user.click(await screen.findByRole('button', { name: 'Approve change to UAT sign-off' }))
    expect(crApi.approveChangeRequest).toHaveBeenCalledWith('cr1')
    expect(await screen.findByText('Approved and applied')).toBeInTheDocument()
    expect(await screen.findByText("No approvals waiting — you're all caught up")).toBeInTheDocument()
  })

  it('shows the server message when the record changed since the proposal (409)', async () => {
    crApi.listChangeRequests.mockResolvedValue(page([pending()]))
    crApi.approveChangeRequest.mockRejectedValue(new ApiError({
      status: 409, code: 'CONFLICT', message: 'The milestone changed after this proposal was made. Ask the analyst to propose again.',
    }))
    const user = userEvent.setup()
    renderWithProviders(<ApprovalsList />, { user: USERS.PM })
    await user.click(await screen.findByRole('button', { name: 'Approve change to UAT sign-off' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The milestone changed after this proposal was made.')
    await waitFor(() => expect(crApi.listChangeRequests).toHaveBeenCalledTimes(2))
  })

  it('works on mobile: cards with full-width Approve / Reject buttons', async () => {
    const restore = mockMobileViewport()
    try {
      crApi.listChangeRequests.mockResolvedValue(page([pending(), pending({ id: 'cr2', entity_type: 'TASK', entity_name: 'Build reports', changes: { status: 'DONE' }, current: { status: 'IN_PROGRESS' } })]))
      crApi.approveChangeRequest.mockResolvedValue({})
      crApi.rejectChangeRequest.mockResolvedValue({})
      const user = userEvent.setup()
      renderWithProviders(<ApprovalsList />, { user: USERS.PM })
      const cards = await screen.findAllByTestId('approval-item')
      expect(cards).toHaveLength(2)
      expect(screen.queryByRole('table')).not.toBeInTheDocument() // compact diff, not a table
      expect(within(cards[1]).getByText('Done')).toBeInTheDocument()
      const approve = within(cards[0]).getByRole('button', { name: 'Approve change to UAT sign-off' })
      expect(approve.className).toMatch(/fullWidth/)
      await user.click(approve)
      expect(crApi.approveChangeRequest).toHaveBeenCalledWith('cr1')
      await user.click(within(cards[1]).getByRole('button', { name: 'Reject change to Build reports' }))
      const dialog = screen.getByRole('dialog', { name: 'Reject proposal' })
      await user.type(within(dialog).getByLabelText(/Reason/), 'Not done yet')
      await user.click(within(dialog).getByRole('button', { name: 'Reject' }))
      expect(crApi.rejectChangeRequest).toHaveBeenCalledWith('cr2', 'Not done yet')
    } finally {
      restore()
    }
  })

  it('shows loading errors with retry, and an empty state', async () => {
    crApi.listChangeRequests
      .mockRejectedValueOnce(new ApiError({ status: 0, code: 'NETWORK_ERROR', message: "Can't reach the server." }))
      .mockResolvedValueOnce(page([]))
    const user = userEvent.setup()
    renderWithProviders(<ApprovalsList />, { user: USERS.PM })
    expect(await screen.findByText("Can't reach the server.")).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText("No approvals waiting — you're all caught up")).toBeInTheDocument()
  })
})
