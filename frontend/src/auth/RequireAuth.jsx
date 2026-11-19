import PropTypes from 'prop-types'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { homeFor } from './roles'

/**
 * Route guard: requires a signed-in user, optionally with one of `roles`,
 * and sends users with a temporary password to /change-password.
 * (UI-only convenience: the backend enforces access on every request.)
 */
export default function RequireAuth({ children, roles }) {
  const { user } = useAuth()
  const location = useLocation()
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (user.must_change_password && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />
  }
  if (roles && !roles.includes(user.role)) return <Navigate to={homeFor(user.role)} replace />
  return children
}

RequireAuth.propTypes = {
  children: PropTypes.node.isRequired,
  roles: PropTypes.arrayOf(PropTypes.string),
}
