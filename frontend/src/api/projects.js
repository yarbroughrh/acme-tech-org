import { request, toQuery } from './client'

/** List projects with server-side search, filters, sorting and pagination. */
export function listProjects(params) {
  return request(`/projects${toQuery(params)}`)
}

/** Fetch one project. @returns {Promise<{project}>} */
export function getProject(id) {
  return request(`/projects/${encodeURIComponent(id)}`)
}

/** Departments and project managers for filters. */
export function getLookups() {
  return request('/projects/lookups')
}
