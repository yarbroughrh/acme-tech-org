import { newIdempotencyKey, request } from './client'

const base = (projectId) => `/projects/${encodeURIComponent(projectId)}/analysts`

/** PM Analysts assigned to a project. */
export function listAnalysts(projectId) {
  return request(base(projectId))
}

/** Assign a PM Analyst to a project. */
export function assignAnalyst(projectId, userId, idempotencyKey = newIdempotencyKey()) {
  return request(base(projectId), { method: 'POST', body: { user_id: userId }, idempotencyKey })
}

/** Remove a PM Analyst from a project. */
export function removeAnalyst(projectId, userId) {
  return request(`${base(projectId)}/${encodeURIComponent(userId)}`, { method: 'DELETE' })
}
