import { request, toQuery } from './client'

/**
 * Executive dashboard summary (Active projects only for health).
 * @param {{department_id?: string}} [params]
 */
export function getPortfolioSummary(params = {}) {
  return request(`/portfolio/summary${toQuery(params)}`)
}
