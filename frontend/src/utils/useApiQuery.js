import { useCallback, useEffect, useState } from 'react'

/**
 * Run an async loader whenever `key` changes and expose {data, error, loading, reload}.
 * State is only set from the promise callbacks; `loading` is derived by comparing the
 * key of the last settled result with the current key (no synchronous setState in effects).
 * Stale responses (for an older key) are ignored.
 *
 * @template T
 * @param {() => Promise<T>} loader async function to call (read inside the effect)
 * @param {string} key serialised inputs; a new value triggers a new request
 * @returns {{data: T|null, error: Error|null, loading: boolean, reload: () => void}}
 */
export default function useApiQuery(loader, key) {
  const [reloadCount, setReloadCount] = useState(0)
  const requestKey = `${key}#${reloadCount}`
  const [result, setResult] = useState({ key: null, data: null, error: null })

  useEffect(() => {
    let cancelled = false
    loader()
      .then((data) => { if (!cancelled) setResult({ key: requestKey, data, error: null }) })
      .catch((error) => { if (!cancelled) setResult((prev) => ({ key: requestKey, data: prev.data, error })) })
    return () => { cancelled = true }
    // The loader is intentionally keyed by `requestKey` only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey])

  const reload = useCallback(() => setReloadCount((c) => c + 1), [])
  const loading = result.key !== requestKey
  return { data: result.data, error: loading ? null : result.error, loading, reload }
}
