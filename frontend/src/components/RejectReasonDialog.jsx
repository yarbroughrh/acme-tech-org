import { useState } from 'react'
import PropTypes from 'prop-types'
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField } from '@mui/material'

/** Ask for a mandatory reason before rejecting a change request. */
export default function RejectReasonDialog({ open, title, busy, onCancel, onConfirm }) {
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  const missing = !reason.trim()
  return (
    <Dialog open={open} onClose={onCancel} fullWidth maxWidth="sm" aria-labelledby="reject-reason-title">
      <DialogTitle id="reject-reason-title">{title}</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus fullWidth multiline minRows={2} required margin="dense"
          id="reject-reason" label="Reason for rejecting"
          value={reason} onChange={(e) => setReason(e.target.value)} onBlur={() => setTouched(true)}
          error={touched && missing} helperText={touched && missing ? 'A reason is required.' : 'The analyst sees this reason.'}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button color="error" variant="contained" disabled={busy || missing} onClick={() => onConfirm(reason.trim())}>Reject</Button>
      </DialogActions>
    </Dialog>
  )
}

RejectReasonDialog.propTypes = {
  open: PropTypes.bool.isRequired,
  title: PropTypes.string.isRequired,
  busy: PropTypes.bool,
  onCancel: PropTypes.func.isRequired,
  onConfirm: PropTypes.func.isRequired,
}
