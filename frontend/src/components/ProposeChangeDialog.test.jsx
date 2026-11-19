import { vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ProposeChangeDialog from './ProposeChangeDialog'
import * as crApi from '../api/changeRequests'
import { renderWithProviders, USERS } from '../test/renderWithProviders'

vi.mock('../api/changeRequests', () => ({ proposeChange: vi.fn(), listChangeRequests: vi.fn(), approveChangeRequest: vi.fn(), rejectChangeRequest: vi.fn() }))

const milestone = { id: 'm1', name: 'UAT sign-off', status: 'IN_PROGRESS', percent_complete: 40, due_date: '2026-12-01', notes: null, version: 3 }

function open(props = {}) {
  const onProposed = vi.fn()
  const onClose = vi.fn()
  renderWithProviders(
    <ProposeChangeDialog open projectId="p1" pmName="Jordan Lee" entityType="MILESTONE" entity={milestone} onClose={onClose} onProposed={onProposed} {...props} />,
    { user: USERS.ANALYST },
  )
  return { onProposed, onClose }
}

describe('ProposeChangeDialog', () => {
  afterEach(() => vi.clearAllMocks())

  it('explains that nothing changes until the PM approves', () => {
    open()
    expect(screen.getByText(/goes to Jordan Lee for approval/)).toBeInTheDocument()
    expect(screen.getByText(/Nothing changes on the milestone until it is approved/)).toBeInTheDocument()
  })

  it('blocks submitting when nothing changed', async () => {
    const user = userEvent.setup()
    open()
    await user.click(screen.getByRole('button', { name: 'Send for approval' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Change at least one field before sending a proposal.')
    expect(crApi.proposeChange).not.toHaveBeenCalled()
  })

  it('sends only the changed fields, with the optional note', async () => {
    crApi.proposeChange.mockResolvedValue({ change_request: { id: 'cr1' } })
    const user = userEvent.setup()
    const { onProposed } = open()
    const pct = screen.getByLabelText(/Percent complete/)
    await user.clear(pct)
    await user.type(pct, '80')
    await user.type(screen.getByLabelText(/Message to the project manager/), 'Testing finished')
    await user.click(screen.getByRole('button', { name: 'Send for approval' }))
    expect(crApi.proposeChange).toHaveBeenCalledWith(
      'p1',
      { entity_type: 'MILESTONE', entity_id: 'm1', changes: { percent_complete: 80 }, note: 'Testing finished' },
      expect.any(String),
    )
    expect(onProposed).toHaveBeenCalledWith({ id: 'cr1' })
  })

  it('validates percent complete and offers only task fields for tasks', async () => {
    const user = userEvent.setup()
    open()
    const pct = screen.getByLabelText(/Percent complete/)
    await user.clear(pct)
    await user.type(pct, '140')
    await user.click(screen.getByRole('button', { name: 'Send for approval' }))
    expect(screen.getByText('Enter a whole number from 0 to 100.')).toBeInTheDocument()
    expect(crApi.proposeChange).not.toHaveBeenCalled()
  })

  it('tasks have no percent complete field and send a date change', async () => {
    crApi.proposeChange.mockResolvedValue({ change_request: { id: 'cr2' } })
    open({ entityType: 'TASK', entity: { id: 't1', title: 'Build reports', status: 'TODO', due_date: null, notes: '' } })
    expect(screen.queryByLabelText(/Percent complete/)).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/Due date/), { target: { value: '2026-12-10' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send for approval' }))
    await screen.findByRole('dialog')
    expect(crApi.proposeChange).toHaveBeenCalledWith('p1', { entity_type: 'TASK', entity_id: 't1', changes: { due_date: '2026-12-10' } }, expect.any(String))
  })
})
