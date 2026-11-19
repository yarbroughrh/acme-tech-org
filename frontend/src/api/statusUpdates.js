import { newIdempotencyKey, request } from './client'

const base = (projectId) => `/projects/${encodeURIComponent(projectId)}/status-updates`

/** Weekly status update history, newest first. */
export function listStatusUpdates(projectId) {
  return request(base(projectId))
}

/** Submit the weekly status update. @returns {Promise<{status_update, project}>} */
export function submitStatusUpdate(projectId, values, idempotencyKey = newIdempotencyKey()) {
  return request(base(projectId), { method: 'POST', body: values, idempotencyKey })
}
