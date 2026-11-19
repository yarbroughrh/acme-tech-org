import { newIdempotencyKey, request } from './client'

const base = (projectId) => `/projects/${encodeURIComponent(projectId)}/spend`

/** Weekly spend entries and budget totals for a project. */
export function listSpend(projectId) {
  return request(base(projectId))
}

/**
 * Record weekly spend (Portfolio Manager only). Saving the same week and category again updates it.
 * @returns {Promise<{entry: object, created: boolean}>}
 */
export function saveSpend(projectId, body, idempotencyKey = newIdempotencyKey()) {
  return request(base(projectId), { method: 'POST', body, idempotencyKey })
}
