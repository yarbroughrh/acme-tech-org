import { request, setSession } from './client'

/** Sign in and store the session. @returns {Promise<{token, expires_at, user}>} */
export async function login(email, password) {
  const session = await request('/auth/login', { method: 'POST', body: { email, password }, auth: false })
  setSession(session)
  return session
}

/** Fetch the signed-in user. */
export function me() {
  return request('/auth/me')
}

/** Change the password and store the new session. */
export async function changePassword(currentPassword, newPassword) {
  const session = await request('/auth/change-password', {
    method: 'POST',
    body: { current_password: currentPassword, new_password: newPassword },
  })
  setSession(session)
  return session
}
