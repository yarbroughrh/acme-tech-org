import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import PropTypes from 'prop-types'
import { clearSession, getSession, onSessionExpired, setSession } from '../api/client'
import * as authApi from '../api/auth'

const AuthContext = createContext(null)

/**
 * Provides the signed-in user and sign-in/sign-out actions.
 * Listens for expired sessions reported by the API client.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => getSession()?.user || null)
  const [expired, setExpired] = useState(false)

  useEffect(() => onSessionExpired(() => {
    setUser(null)
    setExpired(true)
  }), [])

  const login = useCallback(async (email, password) => {
    const session = await authApi.login(email, password)
    setExpired(false)
    setUser(session.user)
    return session.user
  }, [])

  const changePassword = useCallback(async (currentPassword, newPassword) => {
    const session = await authApi.changePassword(currentPassword, newPassword)
    setUser(session.user)
    return session.user
  }, [])

  const logout = useCallback(() => {
    clearSession()
    setExpired(false)
    setUser(null)
  }, [])

  /** Keep the stored session's user in sync (e.g. after a profile change). */
  const updateUser = useCallback((nextUser) => {
    const session = getSession()
    if (session) setSession({ ...session, user: nextUser })
    setUser(nextUser)
  }, [])

  const value = useMemo(() => ({
    user,
    expired,
    login,
    logout,
    changePassword,
    updateUser,
    hasRole: (...roles) => Boolean(user && roles.includes(user.role)),
  }), [user, expired, login, logout, changePassword, updateUser])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

AuthProvider.propTypes = { children: PropTypes.node.isRequired }

/** @returns {object} the auth context value */
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
