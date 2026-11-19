import { request, toQuery } from './client'

/**
 * People with their current weekly load across projects.
 * @param {{q?: string, department_id?: string, load?: string, page?: number, page_size?: number, sort?: string}} params
 */
export function listPeople(params = {}) {
  return request(`/people${toQuery(params)}`)
}
