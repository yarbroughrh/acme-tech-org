import { newIdempotencyKey, request } from './client'

const base = (projectId) => `/projects/${encodeURIComponent(projectId)}/milestones`

/** Milestones of a project with completion and late / at-risk indicators. */
export function listMilestones(projectId) {
  return request(base(projectId))
}

/** Create a milestone. */
export function createMilestone(projectId, values, idempotencyKey = newIdempotencyKey()) {
  return request(base(projectId), { method: 'POST', body: values, idempotencyKey })
}

/** Update a milestone; `values` must include `version`. */
export function updateMilestone(projectId, milestoneId, values) {
  return request(`${base(projectId)}/${encodeURIComponent(milestoneId)}`, { method: 'PUT', body: values })
}

/** Soft-delete a milestone (kept in the audit log). */
export function deleteMilestone(projectId, milestoneId) {
  return request(`${base(projectId)}/${encodeURIComponent(milestoneId)}`, { method: 'DELETE' })
}
