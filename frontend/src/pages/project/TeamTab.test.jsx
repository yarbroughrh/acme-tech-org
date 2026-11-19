import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, USERS } from '../../test/renderWithProviders'
import TeamTab from './TeamTab'
import * as allocationsApi from '../../api/allocations'
import * as peopleApi from '../../api/people'

vi.mock('../../api/allocations', () => ({ listAllocations: vi.fn(), createAllocation: vi.fn(), updateAllocation: vi.fn(), removeAllocation: vi.fn() }))
vi.mock('../../api/people', () => ({ listPeople: vi.fn() }))

const project = (perm = true) => ({
  id: 'p1', planned_start: '2026-01-01', planned_end: '2026-12-31',
  permissions: { can_edit_allocations: perm },
})

const allocations = [
  { id: 'a1', person: { id: 'x1', full_name: 'Priya Raman' }, hours_per_week: 24, start_date: '2026-01-01', end_date: '2026-12-31', person_total_hours: 58, load_status: 'OVER', version: 1 },
  { id: 'a2', person: { id: 'x2', full_name: 'Marcus Webb' }, hours_per_week: 20, start_date: '2026-01-01', end_date: '2026-12-31', person_total_hours: 64, load_status: 'SEVERE', version: 1 },
  { id: 'a3', person: { id: 'x3', full_name: 'Ana Lopez' }, hours_per_week: 16, start_date: '2026-01-01', end_date: '2026-12-31', person_total_hours: 16, load_status: 'UNDER', version: 1 },
]

describe('TeamTab', () => {
  beforeEach(() => {
    allocationsApi.listAllocations.mockResolvedValue({ items: allocations })
    peopleApi.listPeople.mockResolvedValue({ items: [{ id: 'x9', full_name: 'Grace Kim', total_hours: 52 }] })
  })
  afterEach(() => vi.clearAllMocks())

  it('shows load chips as text, not colour alone', async () => {
    renderWithProviders(<TeamTab project={project()} />, { user: USERS.PM })
    const table = await screen.findByRole('table', { name: 'Team allocations' })
    expect(within(table).getByText('Over-allocated +18h')).toBeInTheDocument()
    expect(within(table).getByText('Severely over-allocated +24h')).toBeInTheDocument()
    expect(within(table).getByText('Available 24h')).toBeInTheDocument()
  })

  it('hides editing without permission', async () => {
    renderWithProviders(<TeamTab project={project(false)} />, { user: USERS.EXEC })
    await screen.findByRole('table', { name: 'Team allocations' })
    expect(screen.queryByRole('button', { name: 'Allocate person' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Edit allocation/ })).not.toBeInTheDocument()
  })

  it('validates hours and dates inline before saving', async () => {
    const user = userEvent.setup()
    renderWithProviders(<TeamTab project={project()} />, { user: USERS.PM })
    await user.click(await screen.findByRole('button', { name: 'Allocate person' }))
    await user.type(screen.getByLabelText(/Hours per week/), '200')
    await user.clear(screen.getByLabelText(/End date/))
    await user.type(screen.getByLabelText(/End date/), '2027-02-01')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Hours per week must be between 0.5 and 168.')).toBeInTheDocument()
    expect(screen.getByText(/Must be within the project dates/)).toBeInTheDocument()
    expect(screen.getByText('Choose a person.')).toBeInTheDocument()
    expect(allocationsApi.createAllocation).not.toHaveBeenCalled()
  })

  it('saves a 61 h total with a Severely over-allocated warning', async () => {
    allocationsApi.createAllocation.mockResolvedValue({
      allocation: { id: 'a9' },
      warnings: [{ code: 'SEVERELY_OVER_ALLOCATED', severity: 'RED', message: 'Grace Kim would be allocated 61 h/week across projects.' }],
    })
    const user = userEvent.setup()
    renderWithProviders(<TeamTab project={project()} />, { user: USERS.PM })
    await user.click(await screen.findByRole('button', { name: 'Allocate person' }))
    await user.type(screen.getByLabelText(/Person/), 'Gra')
    await user.click(await screen.findByRole('option', { name: /Grace Kim/ }))
    await user.type(screen.getByLabelText(/Hours per week/), '9')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(allocationsApi.createAllocation).toHaveBeenCalledWith('p1', {
      person_id: 'x9', hours_per_week: 9, start_date: '2026-01-01', end_date: '2026-12-31',
    }))
    const alert = await screen.findByText(/Grace Kim would be allocated 61 h\/week/)
    expect(alert.closest('[role="alert"]')).toHaveTextContent('Severely over-allocated.')
    expect(alert.closest('[role="alert"]')).toHaveTextContent('The allocation was saved.')
  })

  it('shows the server message for a closed project (409)', async () => {
    const err = Object.assign(new Error('This project is Closed; people cannot be allocated to it.'), { status: 409, details: [] })
    allocationsApi.updateAllocation.mockRejectedValue(err)
    const user = userEvent.setup()
    renderWithProviders(<TeamTab project={project()} />, { user: USERS.PM })
    await user.click(await screen.findByRole('button', { name: 'Edit allocation for Priya Raman' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('This project is Closed; people cannot be allocated to it.')).toBeInTheDocument()
    expect(allocationsApi.updateAllocation).toHaveBeenCalledWith('p1', 'a1', { hours_per_week: 24, start_date: '2026-01-01', end_date: '2026-12-31', version: 1 })
  })
})
