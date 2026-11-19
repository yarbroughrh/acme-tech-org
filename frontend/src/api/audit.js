import { request, toQuery } from './client'

/** A project's audit log, newest first, paginated server-side. */
export function listProjectAudit(projectId, params) {
  return request(`/projects/${encodeURIComponent(projectId)}/audit${toQuery(params)}`)
}
