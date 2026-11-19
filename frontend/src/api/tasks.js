import { newIdempotencyKey, request, toQuery } from './client'

const base = (projectId) => `/projects/${encodeURIComponent(projectId)}/tasks`

/** Tasks of a project, optionally for one milestone. */
export function listTasks(projectId, milestoneId) {
  return request(`${base(projectId)}${toQuery({ milestone_id: milestoneId })}`)
}

/** Create a task. */
export function createTask(projectId, values, idempotencyKey = newIdempotencyKey()) {
  return request(base(projectId), { method: 'POST', body: values, idempotencyKey })
}

/** Update a task; `values` must include `version`. */
export function updateTask(projectId, taskId, values) {
  return request(`${base(projectId)}/${encodeURIComponent(taskId)}`, { method: 'PUT', body: values })
}

/** Soft-delete a task (kept in the audit log). */
export function deleteTask(projectId, taskId) {
  return request(`${base(projectId)}/${encodeURIComponent(taskId)}`, { method: 'DELETE' })
}
