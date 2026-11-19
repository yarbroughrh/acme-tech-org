import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import PropTypes from 'prop-types'
import { Alert, Snackbar } from '@mui/material'

const NotifyContext = createContext(() => {})

/** Provides a snackbar for success and failure messages via useNotify(). */
export function NotifyProvider({ children }) {
  const [state, setState] = useState({ open: false, message: '', severity: 'success', key: 0 })

  const notify = useCallback((message, severity = 'success') => {
    setState((prev) => ({ open: true, message, severity, key: prev.key + 1 }))
  }, [])

  const handleClose = (_event, reason) => {
    if (reason === 'clickaway') return
    setState((prev) => ({ ...prev, open: false }))
  }

  const value = useMemo(() => notify, [notify])

  return (
    <NotifyContext.Provider value={value}>
      {children}
      <Snackbar
        key={state.key}
        open={state.open}
        autoHideDuration={state.severity === 'error' ? 8000 : 4000}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={handleClose} severity={state.severity} variant="filled" sx={{ width: '100%' }}>
          {state.message}
        </Alert>
      </Snackbar>
    </NotifyContext.Provider>
  )
}

NotifyProvider.propTypes = { children: PropTypes.node.isRequired }

/** @returns {(message: string, severity?: 'success'|'error'|'info'|'warning') => void} */
// eslint-disable-next-line react-refresh/only-export-components
export function useNotify() {
  return useContext(NotifyContext)
}
