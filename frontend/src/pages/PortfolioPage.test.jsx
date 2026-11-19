import { vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import PortfolioPage from './PortfolioPage'
import * as projectsApi from '../api/projects'
import { ApiError, setSession } from '../api/client'
import { AuthProvider } from '../auth/AuthContext'
import { NotifyProvider } from '../components/NotifyProvider'

vi.mock('../api/projects', () => ({ listProjects: vi.fn(), getLookups: vi.fn(), getProject: vi.fn(), createProject: vi.fn() }))

const project = (overrides = {}) => ({
  id: 'p1',
  name: 'Payments Gateway Upgrade',
  department: { id: 'd1', name: 'Digital Channels' },
  pm: { id: 'u1', display_name: 'Pat Manager' },
  planned_start: '2026-01-01',
  planned_end: '2026-12-31',
  approved_budget: 1250000,
  lifecycle_status: 'ACTIVE',
  priority: 'HIGH',
  health_overall: 'AMBER',
  health_reasons: ['Milestones: 1 milestone is late.'],
  flags: [],
  version: 1,
  ...overrides,
})

const lastRequest = () => projectsApi.listProjects.mock.calls.at(-1)[0]

function renderPage(path = '/portfolio', role = 'EXEC') {
  setSession({ token: 't', expires_at: new Date(Date.now() + 1800000).toISOString(), user: { id: 'u', role, display_name: 'U', must_change_password: false } })
  return render(
    <NotifyProvider>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <PortfolioPage />
        </MemoryRouter>
      </AuthProvider>
    </NotifyProvider>,
  )
}

describe('PortfolioPage', () => {
  beforeEach(() => {
    projectsApi.getLookups.mockResolvedValue({
      departments: [{ id: 'd1', name: 'Digital Channels' }, { id: 'd2', name: 'Cyber Security' }],
      project_managers: [{ id: 'u1', display_name: 'Pat Manager' }],
    })
  })
  afterEach(() => vi.clearAllMocks())

  it('renders projects returned by the API', async () => {
    projectsApi.listProjects.mockResolvedValue({ items: [project()], page: 1, page_size: 20, total: 1 })
    renderPage()
    expect(await screen.findByRole('link', { name: 'Payments Gateway Upgrade' })).toBeInTheDocument()
    const table = screen.getByRole('table', { name: 'Projects' })
    expect(within(table).getByText('Pat Manager')).toBeInTheDocument()
    expect(within(table).getByText('$1,250,000')).toBeInTheDocument()
    expect(within(table).getByText('Amber')).toBeInTheDocument()
    expect(screen.getByText('1 project')).toBeInTheDocument()
    expect(lastRequest()).toMatchObject({ page: 1, page_size: 20, sort: 'name' })
  })

  it('sends the search text as the q parameter (debounced)', async () => {
    projectsApi.listProjects.mockResolvedValue({ items: [project()], page: 1, page_size: 20, total: 1 })
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('link', { name: 'Payments Gateway Upgrade' })
    await user.type(screen.getByLabelText('Search projects or PMs'), 'pay')
    await waitFor(() => expect(lastRequest()).toMatchObject({ q: 'pay', page: 1 }))
  })

  it('resets to page 1 when a filter changes', async () => {
    projectsApi.listProjects.mockResolvedValue({ items: [project()], page: 3, page_size: 20, total: 60 })
    const user = userEvent.setup()
    renderPage('/portfolio?page=3')
    await screen.findByRole('link', { name: 'Payments Gateway Upgrade' })
    expect(lastRequest()).toMatchObject({ page: 3 })
    await user.click(screen.getByRole('combobox', { name: 'Department' }))
    await user.click(await screen.findByRole('option', { name: 'Cyber Security' }))
    await waitFor(() => expect(lastRequest()).toMatchObject({ department_id: 'd2', page: 1 }))
  })

  it('applies filters from the URL (dashboard deep links)', async () => {
    projectsApi.listProjects.mockResolvedValue({ items: [project()], page: 1, page_size: 20, total: 1 })
    renderPage('/portfolio?health=RED&lifecycle_status=ACTIVE')
    await screen.findByRole('link', { name: 'Payments Gateway Upgrade' })
    expect(lastRequest()).toMatchObject({ health: 'RED', lifecycle_status: 'ACTIVE' })
  })

  it('shows an empty state when nothing matches', async () => {
    projectsApi.listProjects.mockResolvedValue({ items: [], page: 1, page_size: 20, total: 0 })
    renderPage()
    expect(await screen.findByText('No projects match')).toBeInTheDocument()
  })

  it('shows an error with a working retry', async () => {
    projectsApi.listProjects
      .mockRejectedValueOnce(new ApiError({ status: 0, code: 'NETWORK_ERROR', message: "Can't reach the server." }))
      .mockResolvedValueOnce({ items: [project()], page: 1, page_size: 20, total: 1 })
    const user = userEvent.setup()
    renderPage()
    expect(await screen.findByText("Can't reach the server.")).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('link', { name: 'Payments Gateway Upgrade' })).toBeInTheDocument()
  })
})
