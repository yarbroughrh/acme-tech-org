import { newIdempotencyKey, request } from './client'

const base = (projectId) => `/projects/${encodeURIComponent(projectId)}/allocations`

/** Allocations on a project, with each person's total weekly load. */
export function listAllocations(projectId) {
  return request(base(projectId))
}

/**
 * Allocate a person to a project. Over 40 h/week (and over 60 h/week) is saved with warnings.
 * @returns {Promise<{allocation: object, warnings: Array<{code: string, severity: string, message: string}>}>}
 */
export function createAllocation(projectId, body, idempotencyKey = newIdempotencyKey()) {
  return request(base(projectId), { method: 'POST', body, idempotencyKey })
}

/** Change hours or dates of an allocation (send `version`). */
export function updateAllocation(projectId, allocationId, body) {
  return request(`${base(projectId)}/${encodeURIComponent(allocationId)}`, { method: 'PUT', body })
}

/** Remove (archive) an allocation. */
export function removeAllocation(projectId, allocationId) {
  return request(`${base(projectId)}/${encodeURIComponent(allocationId)}`, { method: 'DELETE' })
}
