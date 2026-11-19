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
  MEMBER: { id: 't1', email: 'member@acme.example', display_name: 'Tess Member', role: 'MEMBER', must_change_password: false },
  EXEC: { id: 'e1', email: 'exec@acme.example', display_name: 'Eli Exec', role: 'EXEC', must_change_password: false },
}
