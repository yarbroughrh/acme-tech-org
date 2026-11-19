import { request } from './client'

/**
 * The signed-in user's ranked "Your next actions" queue.
 * @returns {Promise<{items: object[], counts: {critical: number, high: number, due_soon: number, total: number}, last_sign_in_at: string|null}>}
 */
export function getWorkQueue() {
  return request('/me/work-queue')
}
