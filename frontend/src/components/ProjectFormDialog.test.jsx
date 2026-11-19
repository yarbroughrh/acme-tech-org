import { vi } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ProjectFormDialog from './ProjectFormDialog'
import * as projectsApi from '../api/projects'
import { ApiError } from '../api/client'
import { renderWithProviders, USERS } from '../test/renderWithProviders'

vi.mock('../api/projects', () => ({ createProject: vi.fn(), updateProject: vi.fn(), listProjects: vi.fn(), getLookups: vi.fn(), getProject: vi.fn() }))

const lookups = {
  departments: [{ id: 'd1', name: 'Digital Channels' }],
  project_managers: [{ id: 'u1', display_name: 'Jordan Lee' }],
}
const existing = {
  id: 'p1', name: 'Customer Portal Rebuild', department: { id: 'd1', name: 'Digital Channels' }, pm: { id: 'u1', display_name: 'Jordan Lee' },
  planned_start: '2026-01-05', planned_end: '2026-12-18', approved_budget: 2000000, lifecycle_status: 'ACTIVE', priority: 'HIGH',
  sponsor: null, description: null, actual_start: null, version: 4,
}

async function choose(user, label, option) {
  await user.click(screen.getByRole('combobox', { name: label }))
  await user.click(await screen.findByRole('option', { name: option }))
}

describe('ProjectFormDialog', () => {
  afterEach(() => vi.clearAllMocks())

  it('validates inline before submitting a new project', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ProjectFormDialog open mode="create" lookups={lookups} onClose={vi.fn()} onSaved={vi.fn()} />, { user: USERS.PMO })
    await user.type(screen.getByLabelText(/Project name/), 'ab')
    fireEvent.change(screen.getByLabelText(/Planned start/), { target: { value: '2026-06-01' } })
    fireEvent.change(screen.getByLabelText(/Planned end/), { target: { value: '2026-05-01' } })
    await user.type(screen.getByLabelText(/Approved budget/), '0')
    await user.click(screen.getByRole('button', { name: 'Create project' }))
    expect(screen.getByText('Name must be 3–120 characters.')).toBeInTheDocument()
    expect(screen.getByText('Choose a department.')).toBeInTheDocument()
    expect(screen.getByText('Choose a project manager.')).toBeInTheDocument()
    expect(screen.getByText('End date must be after the start date.')).toBeInTheDocument()
    expect(screen.getByText('Budget must be a number greater than 0.')).toBeInTheDocument()
    expect(projectsApi.createProject).not.toHaveBeenCalled()
  })

  it('creates a project with one idempotency key per dialog, even when retried', async () => {
    projectsApi.createProject
      .mockRejectedValueOnce(new ApiError({ status: 0, code: 'NETWORK_ERROR', message: "Can't reach the server." }))
      .mockResolvedValueOnce({ project: { id: 'new1' } })
    const onSaved = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(<ProjectFormDialog open mode="create" lookups={lookups} onClose={vi.fn()} onSaved={onSaved} />, { user: USERS.PMO })
    await user.type(screen.getByLabelText(/Project name/), 'Cloud Landing Zone')
    await choose(user, 'Department', 'Digital Channels')
    await choose(user, 'Project manager', 'Jordan Lee')
    fireEvent.change(screen.getByLabelText(/Planned start/), { target: { value: '2026-01-01' } })
    fireEvent.change(screen.getByLabelText(/Planned end/), { target: { value: '2026-12-31' } })
    await user.type(screen.getByLabelText(/Approved budget/), '500000')
    await user.click(screen.getByRole('button', { name: 'Create project' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Can't reach the server.")
    await user.click(screen.getByRole('button', { name: 'Create project' }))
    expect(onSaved).toHaveBeenCalledWith({ id: 'new1' })
    const [firstPayload, firstKey] = projectsApi.createProject.mock.calls[0]
    const [, secondKey] = projectsApi.createProject.mock.calls[1]
    expect(firstKey).toBeTruthy()
    expect(secondKey).toBe(firstKey)
    expect(firstPayload).toMatchObject({
      name: 'Cloud Landing Zone', department_id: 'd1', pm_user_id: 'u1', planned_start: '2026-01-01', planned_end: '2026-12-31',
      approved_budget: 500000, lifecycle_status: 'PROPOSED', priority: 'MEDIUM', sponsor: null,
    })
  })

  it('shows server field errors next to fields', async () => {
    projectsApi.createProject.mockRejectedValue(new ApiError({
      status: 400, code: 'VALIDATION_ERROR', message: 'Please correct the highlighted fields.',
      details: [{ field: 'name', message: 'Another project already uses this name.' }],
    }))
    const user = userEvent.setup()
    renderWithProviders(<ProjectFormDialog open mode="create" lookups={lookups} onClose={vi.fn()} onSaved={vi.fn()} />, { user: USERS.PMO })
    await user.type(screen.getByLabelText(/Project name/), 'Customer Portal Rebuild')
    await choose(user, 'Department', 'Digital Channels')
    await choose(user, 'Project manager', 'Jordan Lee')
    fireEvent.change(screen.getByLabelText(/Planned start/), { target: { value: '2026-01-01' } })
    fireEvent.change(screen.getByLabelText(/Planned end/), { target: { value: '2026-12-31' } })
    await user.type(screen.getByLabelText(/Approved budget/), '100')
    await user.click(screen.getByRole('button', { name: 'Create project' }))
    expect(await screen.findByText('Another project already uses this name.')).toBeInTheDocument()
  })

  it('locks baseline fields for a PM and sends only changes with the version', async () => {
    projectsApi.updateProject.mockResolvedValue({ project: existing })
    const user = userEvent.setup()
    renderWithProviders(<ProjectFormDialog open mode="edit" project={existing} canEditBaseline={false} lookups={lookups} onClose={vi.fn()} onSaved={vi.fn()} />, { user: USERS.PM })
    expect(screen.getByLabelText(/Planned start/)).toBeDisabled()
    expect(screen.getByLabelText(/Planned end/)).toBeDisabled()
    expect(screen.getByLabelText(/Approved budget/)).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Project manager' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getAllByText('Only the Portfolio Manager can change baselines').length).toBeGreaterThan(0)
    await user.type(screen.getByLabelText(/Sponsor/), 'CIO Office')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(projectsApi.updateProject).toHaveBeenCalledWith('p1', { sponsor: 'CIO Office', version: 4 })
  })

  it('shows who changed the project on a 409 and offers reload', async () => {
    projectsApi.updateProject.mockRejectedValue(new ApiError({
      status: 409, code: 'CONFLICT', message: 'This project was changed by someone else. Reload and try again.',
      details: [{ field: 'version', message: 'Changed by Morgan Patel at 2026-11-19T10:00:00Z.' }],
    }))
    const onClose = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(<ProjectFormDialog open mode="edit" project={existing} canEditBaseline lookups={lookups} onClose={onClose} onSaved={vi.fn()} />, { user: USERS.PMO })
    await user.type(screen.getByLabelText(/Sponsor/), 'X')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Changed by Morgan Patel')
    await user.click(within(alert).getByRole('button', { name: 'Reload' }))
    expect(onClose).toHaveBeenCalled()
  })
})
