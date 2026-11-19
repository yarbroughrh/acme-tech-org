import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Alert, Box, Button, CircularProgress, List, ListItem, ListItemIcon, ListItemText, Paper, Stack, TextField, Typography,
} from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked'
import { useAuth } from '../auth/AuthContext'
import { homeFor } from '../auth/roles'
import { checkPassword } from '../utils/passwordPolicy'
import { useNotify } from '../components/NotifyProvider'

/** Change password, required after an Admin reset (temporary password). */
export default function ChangePasswordPage() {
  const { user, changePassword } = useAuth()
  const notify = useNotify()
  const navigate = useNavigate()
  const [values, setValues] = useState({ current: '', next: '', confirm: '' })
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState('')
  const policy = checkPassword(values.next)
  const confirmMatches = values.confirm.length > 0 && values.confirm === values.next
  const canSubmit = values.current && policy.valid && confirmMatches && !submitting

  const set = (field) => (e) => setValues((v) => ({ ...v, [field]: e.target.value }))

  const handleSubmit = async (event) => {
    event.preventDefault()
    setSubmitted(true)
    if (!canSubmit) return
    setSubmitting(true)
    setServerError('')
    try {
      const updated = await changePassword(values.current, values.next)
      notify('Password changed.')
      navigate(homeFor(updated.role), { replace: true })
    } catch (err) {
      const detail = err.details?.map((d) => d.message).join(' ')
      setServerError(detail || err.message)
      setSubmitting(false)
    }
  }

  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 2 }}>
      <Paper component="main" sx={{ p: { xs: 3, sm: 4 }, width: '100%', maxWidth: 460 }}>
        <Typography variant="h1" gutterBottom>Change your password</Typography>
        {user?.must_change_password && (
          <Alert severity="info" role="status" sx={{ mb: 2 }}>You signed in with a temporary password. Choose a new one to continue.</Alert>
        )}
        {serverError && <Alert severity="error" sx={{ mb: 2 }} role="alert">{serverError}</Alert>}
        <Box component="form" noValidate onSubmit={handleSubmit}>
          <Stack spacing={2}>
            <TextField
              id="current-password" label="Current password" type="password" autoComplete="current-password"
              required fullWidth size="medium" value={values.current} onChange={set('current')} disabled={submitting}
              error={submitted && !values.current} helperText={submitted && !values.current ? 'Enter your current password.' : ' '}
            />
            <TextField
              id="new-password" label="New password" type="password" autoComplete="new-password"
              required fullWidth size="medium" value={values.next} onChange={set('next')} disabled={submitting}
              error={submitted && !policy.valid}
              slotProps={{ htmlInput: { 'aria-describedby': 'password-rules' } }}
            />
            <List dense id="password-rules" aria-label="Password requirements" sx={{ py: 0 }}>
              {policy.results.map((rule) => (
                <ListItem key={rule.id} disableGutters sx={{ py: 0 }}>
                  <ListItemIcon sx={{ minWidth: 28 }}>
                    {rule.met
                      ? <CheckCircleIcon fontSize="small" color="success" aria-hidden="true" />
                      : <RadioButtonUncheckedIcon fontSize="small" aria-hidden="true" />}
                  </ListItemIcon>
                  <ListItemText primary={`${rule.label}${rule.met ? ' (met)' : ''}`} />
                </ListItem>
              ))}
            </List>
            <TextField
              id="confirm-password" label="Confirm new password" type="password" autoComplete="new-password"
              required fullWidth size="medium" value={values.confirm} onChange={set('confirm')} disabled={submitting}
              error={(submitted || values.confirm.length > 0) && !confirmMatches}
              helperText={(submitted || values.confirm.length > 0) && !confirmMatches ? 'Passwords do not match.' : ' '}
            />
            <Button
              type="submit" variant="contained" size="large" disabled={submitting}
              startIcon={submitting ? <CircularProgress size={18} color="inherit" /> : undefined}
            >
              {submitting ? 'Saving…' : 'Change password'}
            </Button>
          </Stack>
        </Box>
      </Paper>
    </Box>
  )
}
