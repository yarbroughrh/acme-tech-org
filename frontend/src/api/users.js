import { newIdempotencyKey, request, toQuery } from './client'

/** List users (Admin). @param {{q?, role?, page?, page_size?}} params */
export function listUsers(params) {
  return request(`/users${toQuery(params)}`)
}

/** Create a user (Admin). @returns {Promise<{user, temporary_password}>} */
export function createUser(data) {
  return request('/users', { method: 'POST', body: data, idempotencyKey: newIdempotencyKey() })
}

/** Update a user's name, role or active flag; requires the current version. */
export function updateUser(id, data) {
  return request(`/users/${encodeURIComponent(id)}`, { method: 'PUT', body: data })
}

/** Reset a user's password. @returns {Promise<{temporary_password}>} */
export function resetPassword(id) {
  return request(`/users/${encodeURIComponent(id)}/reset-password`, { method: 'POST', body: {} })
}

/** Unlock a locked account. */
export function unlockUser(id) {
  return request(`/users/${encodeURIComponent(id)}/unlock`, { method: 'POST', body: {} })
}
