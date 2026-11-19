import { vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp, USERS } from '../test/renderWithProviders'
import * as usersApi from '../api/users'
import { ApiError } from '../api/client'

vi.mock('../api/users', () => ({ listUsers: vi.fn(), createUser: vi.fn(), updateUser: vi.fn(), resetPassword: vi.fn(), unlockUser: vi.fn() }))

const row = (o = {}) => ({
  id: 'u2', email: 'pat@acme.example', display_name: 'Pat Manager', role: 'PM', is_active: true,
  must_change_password: false, is_locked: false, locked_until: null, last_login_at: null, version: 3, created_at: '2026-11-19T09:00:00Z', ...o,
})

describe('UsersPage', () => {
  beforeEach(() => {
    usersApi.listUsers.mockResolvedValue({ items: [row(), row({ id: 'u3', display_name: 'Lou Locked', email: 'lou@acme.example', is_locked: true, must_change_password: true })], page: 1, page_size: 20, total: 2 })
  })
  afterEach(() => vi.clearAllMocks())

  it('lists users with text status labels', async () => {
    renderApp('/users', USERS.ADMIN)
    const table = await screen.findByRole('table', { name: 'Users' })
    expect(within(table).getByText('Pat Manager')).toBeInTheDocument()
    expect(within(table).getByText('Locked')).toBeInTheDocument()
    expect(within(table).getByText('Must change password')).toBeInTheDocument()
    expect(within(table).getAllByText('Project Manager').length).toBeGreaterThan(0)
  })

  it('searches and filters on the server', async () => {
    const user = userEvent.setup()
    renderApp('/users', USERS.ADMIN)
    await screen.findByRole('table', { name: 'Users' })
    await user.type(screen.getByLabelText('Search name or email'), 'lou')
    await waitFor(() => expect(usersApi.listUsers).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'lou', page: 1 })))
    await user.click(screen.getByRole('combobox', { name: 'Role' }))
    await user.click(await screen.findByRole('option', { name: 'Executive' }))
    await waitFor(() => expect(usersApi.listUsers).toHaveBeenLastCalledWith(expect.objectContaining({ role: 'EXEC' })))
  })

  it('validates the create form, then shows the temporary password once', async () => {
    usersApi.createUser.mockResolvedValue({ user: row({ id: 'u9', display_name: 'New Person' }), temporary_password: 'Tmp-Pass-1234!' })
    const user = userEvent.setup()
    renderApp('/users', USERS.ADMIN)
    await screen.findByRole('table', { name: 'Users' })
    await user.click(screen.getByRole('button', { name: 'Create user' }))
    const dialog = screen.getByRole('dialog', { name: 'Create user' })
    await user.click(within(dialog).getByRole('button', { name: 'Create user' }))
    expect(within(dialog).getByText('Enter a name.')).toBeInTheDocument()
    expect(within(dialog).getByText('Enter an email address.')).toBeInTheDocument()
    expect(usersApi.createUser).not.toHaveBeenCalled()
    await user.type(within(dialog).getByLabelText(/Full name/), 'New Person')
    await user.type(within(dialog).getByLabelText(/Email/), 'new@acme.example')
    await user.click(within(dialog).getByRole('button', { name: 'Create user' }))
    expect(usersApi.createUser).toHaveBeenCalledWith({ display_name: 'New Person', email: 'new@acme.example', role: 'ANALYST' })
    expect(await screen.findByDisplayValue('Tmp-Pass-1234!')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Done' }))
  })

  it('shows server validation errors in the create dialog', async () => {
    usersApi.createUser.mockRejectedValue(new ApiError({ status: 409, code: 'CONFLICT', message: 'A user with this email already exists.', details: [] }))
    const user = userEvent.setup()
    renderApp('/users', USERS.ADMIN)
    await screen.findByRole('table', { name: 'Users' })
    await user.click(screen.getByRole('button', { name: 'Create user' }))
    const dialog = screen.getByRole('dialog', { name: 'Create user' })
    await user.type(within(dialog).getByLabelText(/Full name/), 'Dup')
    await user.type(within(dialog).getByLabelText(/Email/), 'pat@acme.example')
    await user.click(within(dialog).getByRole('button', { name: 'Create user' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('A user with this email already exists.')
  })

  it('sends the version when editing and explains a 409 conflict', async () => {
    usersApi.updateUser.mockRejectedValue(new ApiError({ status: 409, code: 'CONFLICT', message: 'Changed' }))
    const user = userEvent.setup()
    renderApp('/users', USERS.ADMIN)
    await screen.findByRole('table', { name: 'Users' })
    await user.click(screen.getByRole('button', { name: 'Edit Pat Manager' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('switch', { name: 'Account active' }))
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(usersApi.updateUser).toHaveBeenCalledWith('u2', { role: 'PM', is_active: false, version: 3 })
    expect(await screen.findByText('This user was changed by someone else. Reload and try again.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Reload' }))
    await waitFor(() => expect(screen.queryByText(/changed by someone else/)).not.toBeInTheDocument())
  })

  it('saves an edit and confirms', async () => {
    usersApi.updateUser.mockResolvedValue({ user: row({ role: 'PMO' }) })
    const user = userEvent.setup()
    renderApp('/users', USERS.ADMIN)
    await screen.findByRole('table', { name: 'Users' })
    await user.click(screen.getByRole('button', { name: 'Edit Pat Manager' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Pat Manager updated.')).toBeInTheDocument()
  })

  it('confirms before resetting a password', async () => {
    usersApi.resetPassword.mockResolvedValue({ temporary_password: 'Reset-Pass-99!' })
    const user = userEvent.setup()
    renderApp('/users', USERS.ADMIN)
    await screen.findByRole('table', { name: 'Users' })
    await user.click(screen.getByRole('button', { name: 'Reset password for Pat Manager' }))
    expect(screen.getByRole('dialog', { name: 'Reset password?' })).toBeInTheDocument()
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reset password' }))
    expect(usersApi.resetPassword).toHaveBeenCalledWith('u2')
    expect(await screen.findByDisplayValue('Reset-Pass-99!')).toBeInTheDocument()
  })

  it('unlocks a locked account and reports failures', async () => {
    usersApi.unlockUser.mockResolvedValueOnce({ user: row() }).mockRejectedValueOnce(new ApiError({ status: 403, code: 'FORBIDDEN', message: 'Not allowed.' }))
    const user = userEvent.setup()
    renderApp('/users', USERS.ADMIN)
    await screen.findByRole('table', { name: 'Users' })
    expect(screen.queryByRole('button', { name: 'Unlock Pat Manager' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Unlock Lou Locked' }))
    expect(await screen.findByText('Lou Locked unlocked.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Unlock Lou Locked' }))
    expect(await screen.findByText('Not allowed.')).toBeInTheDocument()
  })

  it('shows empty and error states', async () => {
    usersApi.listUsers.mockReset()
    usersApi.listUsers
      .mockRejectedValueOnce(new ApiError({ status: 500, code: 'INTERNAL', message: 'Something went wrong on our side. Please try again.' }))
      .mockResolvedValueOnce({ items: [], page: 1, page_size: 20, total: 0 })
    const user = userEvent.setup()
    renderApp('/users', USERS.ADMIN)
    expect(await screen.findByText(/Something went wrong/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('No users match')).toBeInTheDocument()
  })
})
