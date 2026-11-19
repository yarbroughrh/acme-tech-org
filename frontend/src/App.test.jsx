import { vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { renderApp, USERS } from './test/renderWithProviders'
import * as projectsApi from './api/projects'
import * as usersApi from './api/users'
import * as changeRequestsApi from './api/changeRequests'
import { getSession } from './api/client'

vi.mock('./api/projects', () => ({ listProjects: vi.fn(), getLookups: vi.fn(), getProject: vi.fn(), createProject: vi.fn() }))
vi.mock('./api/changeRequests', () => ({ listChangeRequests: vi.fn(), approveChangeRequest: vi.fn(), rejectChangeRequest: vi.fn(), proposeChange: vi.fn() }))
vi.mock('./api/users', () => ({ listUsers: vi.fn(), createUser: vi.fn(), updateUser: vi.fn(), resetPassword: vi.fn(), unlockUser: vi.fn() }))

describe('routing and role guards', () => {
  beforeEach(() => {
    projectsApi.listProjects.mockResolvedValue({ items: [], page: 1, page_size: 20, total: 0 })
    projectsApi.getLookups.mockResolvedValue({ departments: [], project_managers: [] })
    usersApi.listUsers.mockResolvedValue({ items: [], page: 1, page_size: 20, total: 0 })
    changeRequestsApi.listChangeRequests.mockResolvedValue({ items: [], page: 1, page_size: 20, total: 0 })
  })
  afterEach(() => vi.clearAllMocks())

  it('sends signed-out visitors to sign-in', () => {
    renderApp('/portfolio')
    expect(screen.getByRole('heading', { name: 'Beacon' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
  })

  it.each([
    ['ADMIN', 'Users'],
    ['EXEC', 'Portfolio'],
    ['PMO', 'Portfolio'],
    ['PM', 'My work'],
    ['ANALYST', 'My proposals'],
  ])('lands %s on their home page', async (role, heading) => {
    renderApp('/', USERS[role])
    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument()
  })

  it('shows only the navigation a role may use', async () => {
    const user = userEvent.setup()
    renderApp('/portfolio', USERS.EXEC)
    await user.click(await screen.findByRole('button', { name: 'Open navigation' }))
    const nav = await screen.findAllByRole('navigation', { name: 'Main navigation' })
    const links = within(nav[0]).getAllByRole('link').map((a) => a.textContent)
    expect(links).toEqual(['Portfolio'])
  })

  it('redirects a role away from pages it may not use', async () => {
    renderApp('/users', USERS.PM)
    expect(await screen.findByRole('heading', { level: 1, name: 'My work' })).toBeInTheDocument()
    expect(usersApi.listUsers).not.toHaveBeenCalled()
  })

  it('forces a password change for temporary passwords', () => {
    renderApp('/portfolio', { ...USERS.PM, must_change_password: true })
    expect(screen.getByRole('heading', { name: 'Change your password' })).toBeInTheDocument()
  })

  it('shows a not-found page for unknown routes', async () => {
    renderApp('/nope', USERS.PMO)
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
  })

  it('signs out from the app bar', async () => {
    const user = userEvent.setup()
    renderApp('/portfolio', USERS.PMO)
    expect(screen.getByText('Paula PMO')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    expect(getSession()).toBeNull()
  })

  it('renders the full App (HashRouter) at the sign-in page', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
  })
})
