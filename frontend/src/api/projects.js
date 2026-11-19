import { newIdempotencyKey, request, toQuery } from './client'

/** List projects with server-side search, filters, sorting and pagination. */
export function listProjects(params) {
  return request(`/projects${toQuery(params)}`)
}

/** Fetch one project, including health detail and the caller's permissions. @returns {Promise<{project}>} */
export function getProject(id) {
  return request(`/projects/${encodeURIComponent(id)}`)
}

/** Departments, project managers and analysts for filters and forms. */
export function getLookups() {
  return request('/projects/lookups')
}

/**
 * Create a project (Portfolio Manager). Pass a key generated once per form so retries are safe.
 * @param {object} values
 * @param {string} [idempotencyKey]
 */
export function createProject(values, idempotencyKey = newIdempotencyKey()) {
  return request('/projects', { method: 'POST', body: values, idempotencyKey })
}

/** Update a project; `values` must include the current `version`. */
export function updateProject(id, values) {
  return request(`/projects/${encodeURIComponent(id)}`, { method: 'PUT', body: values })
}

/** Archive a project (cascades to milestones, tasks and allocations). */
export function archiveProject(id, version) {
  return request(`/projects/${encodeURIComponent(id)}/archive`, { method: 'POST', body: { version } })
}

/** Cancel a project with an optional reason. */
export function cancelProject(id, version, reason) {
  const body = { version }
  if (reason) body.reason = reason
  return request(`/projects/${encodeURIComponent(id)}/cancel`, { method: 'POST', body })
}

/** People allocated to the project (task assignees). */
export function getTeam(id) {
  return request(`/projects/${encodeURIComponent(id)}/team`)
}
