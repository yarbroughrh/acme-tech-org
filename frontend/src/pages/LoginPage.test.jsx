import { vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import LoginPage from './LoginPage'
import { AuthProvider } from '../auth/AuthContext'
import * as authApi from '../api/auth'
import { ApiError } from '../api/client'

vi.mock('../api/auth', () => ({ login: vi.fn(), changePassword: vi.fn(), me: vi.fn() }))

function renderLogin() {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/portfolio" element={<p>Portfolio home</p>} />
          <Route path="/change-password" element={<p>Change password screen</p>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  )
}

describe('LoginPage', () => {
  afterEach(() => vi.clearAllMocks())

  it('validates required fields and email format inline without calling the API', async () => {
    const user = userEvent.setup()
    renderLogin()
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(screen.getByText('Enter your email address.')).toBeInTheDocument()
    expect(screen.getByText('Enter your password.')).toBeInTheDocument()
    await user.type(screen.getByLabelText(/Email/), 'not-an-email')
    expect(screen.getByText(/Enter a valid email address/)).toBeInTheDocument()
    expect(authApi.login).not.toHaveBeenCalled()
  })

  it('disables the form while submitting, then goes to the role home', async () => {
    let resolveLogin
    authApi.login.mockImplementation(() => new Promise((resolve) => { resolveLogin = resolve }))
    const user = userEvent.setup()
    renderLogin()
    await user.type(screen.getByLabelText(/Email/), 'pm@acme.example')
    await user.type(screen.getByLabelText(/^Password/), 'Secret-password-1')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(screen.getByRole('button', { name: /Signing in/ })).toBeDisabled()
    expect(screen.getByLabelText(/Email/)).toBeDisabled()
    resolveLogin({ token: 't', expires_at: '2099-01-01T00:00:00Z', user: { id: '1', role: 'PM', display_name: 'P', must_change_password: false } })
    expect(await screen.findByText('Portfolio home')).toBeInTheDocument()
    expect(authApi.login).toHaveBeenCalledWith('pm@acme.example', 'Secret-password-1')
  })

  it('sends users with a temporary password to change it', async () => {
    authApi.login.mockResolvedValue({ token: 't', expires_at: '2099-01-01T00:00:00Z', user: { id: '1', role: 'PM', must_change_password: true } })
    const user = userEvent.setup()
    renderLogin()
    await user.type(screen.getByLabelText(/Email/), 'pm@acme.example')
    await user.type(screen.getByLabelText(/^Password/), 'Temp-password-1')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Change password screen')).toBeInTheDocument()
  })

  it('shows the generic server error and re-enables the form', async () => {
    authApi.login.mockRejectedValue(new ApiError({ status: 401, code: 'UNAUTHENTICATED', message: 'Sign-in failed. Check your email and password.' }))
    const user = userEvent.setup()
    renderLogin()
    await user.type(screen.getByLabelText(/Email/), 'nobody@acme.example')
    await user.type(screen.getByLabelText(/^Password/), 'Wrong-password-1')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign-in failed. Check your email and password.')
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled()
  })

  it('toggles password visibility', async () => {
    const user = userEvent.setup()
    renderLogin()
    const field = screen.getByLabelText(/^Password/)
    expect(field).toHaveAttribute('type', 'password')
    await user.click(screen.getByRole('button', { name: 'Show password' }))
    expect(field).toHaveAttribute('type', 'text')
  })
})
