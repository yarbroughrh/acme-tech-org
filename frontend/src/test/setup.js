import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

// Every routed screen mounts the shared work-queue provider; default to an empty queue.
// Tests that care override getWorkQueue with mockResolvedValue / mockRejectedValue.
vi.mock('../api/workQueue', () => ({
  getWorkQueue: vi.fn(() => Promise.resolve({ items: [], counts: { critical: 0, high: 0, due_soon: 0, total: 0 }, last_sign_in_at: null })),
}))

afterEach(() => {
  cleanup()
  sessionStorage.clear()
})
