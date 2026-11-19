import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ThemeProvider } from '@mui/material'
import theme from '../theme'
import { AuthProvider } from '../auth/AuthContext'
import { NotifyProvider } from '../components/NotifyProvider'
import { AppRoutes } from '../App'
import { setSession } from '../api/client'

/**
 * Render the real route table at `path`, optionally signed in as `user`.
 * @param {string} path
 * @param {object} [user]
 */
export function renderApp(path, user) {
  if (user) setSession({ token: 'test-token', expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(), user })
  return render(
    <ThemeProvider theme={theme}>
      <NotifyProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={[path]}>
            <AppRoutes />
          </MemoryRouter>
        </AuthProvider>
      </NotifyProvider>
    </ThemeProvider>,
  )
}

export const USERS = {
  ADMIN: { id: 'a1', email: 'admin@acme.example', display_name: 'Ada Admin', role: 'ADMIN', must_change_password: false },
  PMO: { id: 'p1', email: 'pmo@acme.example', display_name: 'Paula PMO', role: 'PMO', must_change_password: false },
  PM: { id: 'm1', email: 'pm@acme.example', display_name: 'Pat Manager', role: 'PM', must_change_password: false },
  ANALYST: { id: 'n1', email: 'analyst1@acme.example', display_name: 'Sam Okafor', role: 'ANALYST', must_change_password: false },
  EXEC: { id: 'e1', email: 'exec@acme.example', display_name: 'Eli Exec', role: 'EXEC', must_change_password: false },
}

/**
 * Render a single component with theme, notifications, auth and a router.
 * @param {import('react').ReactNode} ui
 * @param {{path?: string, user?: object}} [options]
 */
export function renderWithProviders(ui, { path = '/', user } = {}) {
  if (user) setSession({ token: 'test-token', expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(), user })
  return render(
    <ThemeProvider theme={theme}>
      <NotifyProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
        </AuthProvider>
      </NotifyProvider>
    </ThemeProvider>,
  )
}

/**
 * Make every CSS media query match (MUI `useMediaQuery(... down('sm'))` returns true), i.e. a phone.
 * Returns a restore function.
 */
export function mockMobileViewport() {
  const original = window.matchMedia
  window.matchMedia = (query) => ({
    matches: !/min-width/.test(query) || /min-width:\s*0/.test(query),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })
  return () => { window.matchMedia = original }
}
