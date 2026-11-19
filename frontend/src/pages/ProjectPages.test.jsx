import { vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp, USERS } from '../test/renderWithProviders'
import * as projectsApi from '../api/projects'
import * as authApi from '../api/auth'
import * as analystsApi from '../api/analysts'
import * as changeRequestsApi from '../api/changeRequests'
import { ApiError } from '../api/client'

vi.mock('../api/projects', () => ({ listProjects: vi.fn(), getLookups: vi.fn(), getProject: vi.fn(), createProject: vi.fn() }))
vi.mock('../api/analysts', () => ({ listAnalysts: vi.fn(), assignAnalyst: vi.fn(), removeAnalyst: vi.fn() }))
vi.mock('../api/changeRequests', () => ({ listChangeRequests: vi.fn(), approveChangeRequest: vi.fn(), rejectChangeRequest: vi.fn(), proposeChange: vi.fn() }))
vi.mock('../api/auth', () => ({ login: vi.fn(), changePassword: vi.fn(), me: vi.fn() }))

describe('ProjectDetailPage', () => {
  beforeEach(() => {
    projectsApi.getLookups.mockResolvedValue({ departments: [], project_managers: [], analysts: [] })
    analystsApi.listAnalysts.mockResolvedValue({ items: [] })
  })
  afterEach(() => vi.clearAllMocks())

  it('shows project details and the reasons for its health', async () => {
    projectsApi.getProject.mockResolvedValue({
      project: {
        id: 'p1', name: 'Customer Portal Rebuild', department: { id: 'd', name: 'Digital Channels' }, pm: { id: 'u', display_name: 'Pat Manager' },
        sponsor: 'Sam Sponsor', planned_start: '2026-01-05', planned_end: '2026-12-18', actual_start: null, approved_budget: 2000000,
        lifecycle_status: 'ACTIVE', priority: 'HIGH', health_overall: 'RED', health_reasons: ['Milestones: 2 milestones are late.'],
        health: { overall: 'RED', reasons: ['Milestones: 2 milestones are late.'], flags: [], dimensions: { milestones: { status: 'RED', summary: '2 late' } }, metrics: {} },
        permissions: {},
        description: 'Rebuild the portal.', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-11-18T10:00:00Z', version: 2,
      },
    })
    renderApp('/portfolio/p1', USERS.EXEC)
    expect(await screen.findByRole('heading', { level: 1, name: 'Customer Portal Rebuild' })).toBeInTheDocument()
    expect(screen.getByText('Why this status')).toBeInTheDocument()
    expect(screen.getAllByText('Milestones: 2 milestones are late.').length).toBeGreaterThan(0)
    expect(screen.getByText('$2,000,000')).toBeInTheDocument()
    expect(screen.getByText('Sam Sponsor')).toBeInTheDocument()
    expect(screen.getByText('Rebuild the portal.')).toBeInTheDocument()
    expect(projectsApi.getProject).toHaveBeenCalledWith('p1')
  })

  it('shows a not-found state for unknown projects', async () => {
    projectsApi.getProject.mockRejectedValue(new ApiError({ status: 404, code: 'NOT_FOUND', message: 'Project not found.' }))
    renderApp('/portfolio/missing', USERS.PMO)
    expect(await screen.findByText('Project not found')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to portfolio' })).toBeInTheDocument()
  })

  it('shows an error state with retry', async () => {
    projectsApi.getProject
      .mockRejectedValueOnce(new ApiError({ status: 0, code: 'NETWORK_ERROR', message: "Can't reach the server." }))
      .mockResolvedValueOnce({ project: { id: 'p1', name: 'Recovered', lifecycle_status: 'CLOSED', priority: 'LOW' } })
    const user = userEvent.setup()
    renderApp('/portfolio/p1', USERS.PM)
    expect(await screen.findByText("Can't reach the server.")).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Recovered' })).toBeInTheDocument()
  })
})

describe('ChangePasswordPage', () => {
  afterEach(() => vi.clearAllMocks())

  it('checks the policy inline and only submits a valid, confirmed password', async () => {
    authApi.changePassword.mockResolvedValue({ token: 't2', expires_at: '2099-01-01T00:00:00Z', user: { ...USERS.PM, must_change_password: false } })
    changeRequestsApi.listChangeRequests.mockResolvedValue({ items: [], page: 1, page_size: 20, total: 0 })
    projectsApi.listProjects.mockResolvedValue({ items: [], page: 1, page_size: 20, total: 0 })
    projectsApi.getLookups.mockResolvedValue({ departments: [], project_managers: [] })
    const user = userEvent.setup()
    renderApp('/change-password', { ...USERS.PM, must_change_password: true })
    expect(screen.getByText(/temporary password/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Change password' }))
    expect(screen.getByText('Enter your current password.')).toBeInTheDocument()
    expect(authApi.changePassword).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText(/Current password/), 'Temp-Pass-123!')
    await user.type(screen.getByLabelText(/^New password/), 'short')
    expect(screen.getByText('At least 12 characters')).toBeInTheDocument()
    await user.type(screen.getByLabelText(/Confirm new password/), 'different')
    expect(screen.getByText('Passwords do not match.')).toBeInTheDocument()

    await user.clear(screen.getByLabelText(/^New password/))
    await user.type(screen.getByLabelText(/^New password/), 'Brand-New-Pass-2026')
    expect(screen.getByText('At least 12 characters (met)')).toBeInTheDocument()
    await user.clear(screen.getByLabelText(/Confirm new password/))
    await user.type(screen.getByLabelText(/Confirm new password/), 'Brand-New-Pass-2026')
    await user.click(screen.getByRole('button', { name: 'Change password' }))
    expect(authApi.changePassword).toHaveBeenCalledWith('Temp-Pass-123!', 'Brand-New-Pass-2026')
    expect(await screen.findByRole('heading', { level: 1, name: 'My work' })).toBeInTheDocument()
  })

  it('shows server policy errors', async () => {
    authApi.changePassword.mockRejectedValue(new ApiError({
      status: 400, code: 'VALIDATION_ERROR', message: 'Password does not meet the policy.',
      details: [{ field: 'new_password', message: 'Must differ from the current password.' }],
    }))
    const user = userEvent.setup()
    renderApp('/change-password', { ...USERS.PM, must_change_password: true })
    await user.type(screen.getByLabelText(/Current password/), 'Same-Pass-2026!')
    await user.type(screen.getByLabelText(/^New password/), 'Same-Pass-2026!')
    await user.type(screen.getByLabelText(/Confirm new password/), 'Same-Pass-2026!')
    await user.click(screen.getByRole('button', { name: 'Change password' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Must differ from the current password.')
  })
})
