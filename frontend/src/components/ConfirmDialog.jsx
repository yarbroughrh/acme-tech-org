import PropTypes from 'prop-types'
import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from '@mui/material'

/** Confirmation dialog for consequential actions (archive, reset password, ...). */
export default function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', busy = false, onConfirm, onCancel, destructive = false }) {
  return (
    <Dialog open={open} onClose={busy ? undefined : onCancel} aria-labelledby="confirm-dialog-title">
      <DialogTitle id="confirm-dialog-title">{title}</DialogTitle>
      <DialogContent>
        <DialogContentText>{message}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button onClick={onConfirm} disabled={busy} variant="contained" color={destructive ? 'error' : 'primary'}>
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

ConfirmDialog.propTypes = {
  open: PropTypes.bool.isRequired,
  title: PropTypes.string.isRequired,
  message: PropTypes.node.isRequired,
  confirmLabel: PropTypes.string,
  busy: PropTypes.bool,
  destructive: PropTypes.bool,
  onConfirm: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
}
