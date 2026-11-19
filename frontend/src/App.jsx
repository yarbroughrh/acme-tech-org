import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { CssBaseline, ThemeProvider } from '@mui/material'
import theme from './theme'
import { AuthProvider, useAuth } from './auth/AuthContext'
import RequireAuth from './auth/RequireAuth'
import { homeFor } from './auth/roles'
import AppShell from './components/AppShell'
import { NotifyProvider } from './components/NotifyProvider'
import LoginPage from './pages/LoginPage'
import ChangePasswordPage from './pages/ChangePasswordPage'
import PortfolioPage from './pages/PortfolioPage'
import ProjectDetailPage from './pages/ProjectDetailPage'
import UsersPage from './pages/UsersPage'
import MyTasksPage from './pages/MyTasksPage'
import NotFoundPage from './pages/NotFoundPage'

/** Send the user to their role's home page. */
function HomeRedirect() {
  const { user } = useAuth()
  return <Navigate to={user ? homeFor(user.role) : '/login'} replace />
}

/** Wrap a page in the guard and the application frame. */
function shell(page, roles) {
  return <RequireAuth roles={roles}><AppShell>{page}</AppShell></RequireAuth>
}

/**
 * Application routes. HashRouter keeps deep links working behind CloudFront + S3
 * (S3 with OAC returns 403 for unknown keys; see docs/DECISIONS.md ADR-009).
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/change-password" element={<RequireAuth><ChangePasswordPage /></RequireAuth>} />
      <Route path="/" element={<RequireAuth><HomeRedirect /></RequireAuth>} />
      <Route path="/portfolio" element={shell(<PortfolioPage />, ['ADMIN', 'PMO', 'PM', 'EXEC'])} />
      <Route path="/portfolio/:id" element={shell(<ProjectDetailPage />, ['ADMIN', 'PMO', 'PM', 'EXEC'])} />
      <Route path="/users" element={shell(<UsersPage />, ['ADMIN'])} />
      <Route path="/my-tasks" element={shell(<MyTasksPage />, ['MEMBER'])} />
      <Route path="*" element={shell(<NotFoundPage />)} />
    </Routes>
  )
}

/** Root component: theme, notifications, auth and routing. */
export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <NotifyProvider>
        <AuthProvider>
          <HashRouter>
            <AppRoutes />
          </HashRouter>
        </AuthProvider>
      </NotifyProvider>
    </ThemeProvider>
  )
}
