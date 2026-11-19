import { newIdempotencyKey, request, toQuery } from './client'

/**
 * Propose a change to a milestone or task (PM Analyst). Nothing changes until the project's PM approves.
 * @param {string} projectId
 * @param {{entity_type: 'MILESTONE'|'TASK', entity_id: string, changes: object, note?: string}} proposal
 */
export function proposeChange(projectId, proposal, idempotencyKey = newIdempotencyKey()) {
  return request(`/projects/${encodeURIComponent(projectId)}/change-requests`, { method: 'POST', body: proposal, idempotencyKey })
}

/**
 * List change requests.
 * @param {{view: 'approvals'|'mine', status?: string, page?: number, page_size?: number}} params
 */
export function listChangeRequests(params) {
  return request(`/change-requests${toQuery(params)}`)
}

/** Approve and apply a change request (the project's PM only). */
export function approveChangeRequest(id) {
  return request(`/change-requests/${encodeURIComponent(id)}/approve`, { method: 'POST', body: {} })
}

/** Reject a change request; a reason is required. */
export function rejectChangeRequest(id, reason) {
  return request(`/change-requests/${encodeURIComponent(id)}/reject`, { method: 'POST', body: { reason } })
}
