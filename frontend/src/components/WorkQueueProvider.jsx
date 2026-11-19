import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import PropTypes from 'prop-types'
import { getWorkQueue } from '../api/workQueue'

const REFRESH_MS = 60 * 1000
const WorkQueueContext = createContext(null)

/**
 * One shared fetch of the signed-in user's work queue for the page and the navigation badge.
 * Mounted inside the application frame, so it refreshes on every route change, and every 60 s.
 */
export function WorkQueueProvider({ children }) {
  const [state, setState] = useState({ data: null, error: null, loading: true })
  const [tick, setTick] = useState(0)

  const reload = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    let cancelled = false
    getWorkQueue()
      .then((data) => { if (!cancelled) setState({ data, error: null, loading: false }) })
      .catch((error) => { if (!cancelled) setState((prev) => ({ data: prev.data, error, loading: false })) })
    return () => { cancelled = true }
  }, [tick])

  useEffect(() => {
    const id = setInterval(reload, REFRESH_MS)
    return () => clearInterval(id)
  }, [reload])

  const value = useMemo(() => ({ ...state, reload }), [state, reload])
  return <WorkQueueContext.Provider value={value}>{children}</WorkQueueContext.Provider>
}

WorkQueueProvider.propTypes = { children: PropTypes.node.isRequired }

/**
 * Access the shared queue. Returns null outside the provider (e.g. sign-in page).
 * @returns {{data: object|null, error: Error|null, loading: boolean, reload: () => void}|null}
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useWorkQueue() {
  return useContext(WorkQueueContext)
}
