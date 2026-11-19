import { useState } from 'react'
import PropTypes from 'prop-types'
import { Link as RouterLink } from 'react-router-dom'
import {
  Alert, Box, Button, Card, CardActions, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogContentText,
  DialogTitle, Link, Paper, Stack, TablePagination, TextField, Typography, useMediaQuery,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import CheckIcon from '@mui/icons-material/Check'
import CloseIcon from '@mui/icons-material/Close'
import { approveChangeRequest, listChangeRequests, rejectChangeRequest } from '../api/changeRequests'
import ChangeDiff from './ChangeDiff'
import { useNotify } from './NotifyProvider'
import { EmptyState, ErrorState, LoadingState } from './PageState'
import useApiQuery from '../utils/useApiQuery'
import { ENTITY_LABELS, formatDateTime } from '../utils/format'

const PAGE_SIZE = 10

/** Reject dialog: a reason is required before the Reject button enables. */
export function RejectDialog({ open, request, busy, onCancel, onConfirm }) {
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  const missing = !reason.trim()
  return (
    <Dialog open={open} onClose={busy ? undefined : onCancel} fullWidth maxWidth="sm" aria-labelledby="reject-title">
      <DialogTitle id="reject-title">Reject proposal</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          {`Tell ${request?.proposer?.display_name || 'the analyst'} why. They will see this reason.`}
        </DialogContentText>
        <TextField
          id="reject-reason" label="Reason for rejecting" required fullWidth multiline minRows={3} autoFocus
          value={reason} onChange={(e) => setReason(e.target.value)} onBlur={() => setTouched(true)}
          error={touched && missing} helperText={touched && missing ? 'A reason is required to reject.' : ' '} disabled={busy}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button variant="contained" color="error" disabled={busy || missing} onClick={() => onConfirm(reason.trim())}>
          {busy ? 'Rejecting…' : 'Reject'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

RejectDialog.propTypes = {
  open: PropTypes.bool.isRequired,
  request: PropTypes.object,
  busy: PropTypes.bool,
  onCancel: PropTypes.func.isRequired,
  onConfirm: PropTypes.func.isRequired,
}

/** Header lines describing one request. */
function RequestSummary({ request }) {
  return (
    <>
      <Typography variant="h3" component="h3">
        {`${ENTITY_LABELS[request.entity_type] || request.entity_type}: ${request.entity_name || ''}`}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        <Link component={RouterLink} to={`/portfolio/${request.project?.id}`}>{request.project?.name}</Link>
        {` · proposed by ${request.proposer?.display_name || 'an analyst'} · ${formatDateTime(request.created_at)}`}
      </Typography>
      {request.note && (
        <Typography variant="body2" sx={{ mt: 1, fontStyle: 'italic' }}>{`“${request.note}”`}</Typography>
      )}
    </>
  )
}

RequestSummary.propTypes = { request: PropTypes.object.isRequired }

/**
 * Pending change requests for the signed-in PM's projects, with Approve / Reject.
 * Works on mobile as cards with full-width buttons at least 44px tall.
 * @param {{limit?: number, onCountChange?: (n: number) => void}} props
 */
export default function ApprovalsList({ limit, onCountChange }) {
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'))
  const notify = useNotify()
  const [page, setPage] = useState(0)
  const [busyId, setBusyId] = useState(null)
  const [rejecting, setRejecting] = useState(null)
  const [error, setError] = useState('')
  const pageSize = limit || PAGE_SIZE

  const state = useApiQuery(
    () => listChangeRequests({ view: 'approvals', status: 'PENDING', page: page + 1, page_size: pageSize }).then((data) => {
      if (onCountChange) onCountChange(data.total)
      return data
    }),
    `${page}|${pageSize}`,
  )

  const approve = async (request) => {
    setBusyId(request.id)
    setError('')
    try {
      await approveChangeRequest(request.id)
      notify('Approved and applied')
      state.reload()
    } catch (err) {
      setError(err.message || 'The proposal could not be approved.')
      if (err.status === 409 || err.status === 404) state.reload()
    } finally {
      setBusyId(null)
    }
  }

  const reject = async (reason) => {
    const request = rejecting
    setBusyId(request.id)
    setError('')
    try {
      await rejectChangeRequest(request.id, reason)
      notify('Proposal rejected. The analyst can see your reason.')
      setRejecting(null)
      state.reload()
    } catch (err) {
      setError(err.message || 'The proposal could not be rejected.')
      setRejecting(null)
      if (err.status === 409 || err.status === 404) state.reload()
    } finally {
      setBusyId(null)
    }
  }

  const items = state.data?.items || []
  const total = state.data?.total || 0
  let body
  if (state.loading && !state.data) body = <LoadingState rows={3} label="Loading approvals" />
  else if (state.error) body = <ErrorState message={state.error.message} onRetry={state.reload} />
  else if (!items.length) body = <EmptyState title="No approvals waiting — you're all caught up" />
  else {
    body = (
      <Stack spacing={1.5}>
        {items.map((r) => {
          const busy = busyId === r.id
          const buttons = (
            <>
              <Button
                variant="contained" color="primary" startIcon={<CheckIcon />} onClick={() => approve(r)} disabled={busy}
                fullWidth={isMobile} sx={{ minHeight: 44 }} aria-label={`Approve change to ${r.entity_name}`}
              >
                Approve
              </Button>
              <Button
                variant="outlined" color="error" startIcon={<CloseIcon />} onClick={() => setRejecting(r)} disabled={busy}
                fullWidth={isMobile} sx={{ minHeight: 44 }} aria-label={`Reject change to ${r.entity_name}`}
              >
                Reject
              </Button>
            </>
          )
          return (
            <Card key={r.id} variant="outlined" data-testid="approval-item">
              <CardContent>
                <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
                  <Box sx={{ minWidth: 0 }}><RequestSummary request={r} /></Box>
                  <Chip size="small" label="Pending" color="warning" variant="outlined" />
                </Stack>
                <Box sx={{ mt: 1.5, overflowX: 'auto' }}>
                  <ChangeDiff changes={r.changes} current={r.current} entityType={r.entity_type} compact={isMobile} />
                </Box>
              </CardContent>
              <CardActions sx={{ px: 2, pb: 2, gap: 1, flexDirection: isMobile ? 'column' : 'row', '& > :not(style) ~ :not(style)': { ml: isMobile ? 0 : 1 } }}>
                {buttons}
              </CardActions>
            </Card>
          )
        })}
      </Stack>
    )
  }

  return (
    <Box aria-busy={state.loading}>
      {error && <Alert severity="error" role="alert" sx={{ mb: 1.5 }} onClose={() => setError('')}>{error}</Alert>}
      {body}
      {!limit && total > pageSize && (
        <Paper sx={{ mt: 1.5 }}>
          <TablePagination
            component="div" count={total} page={page} rowsPerPage={pageSize} rowsPerPageOptions={[pageSize]}
            onPageChange={(_e, p) => setPage(p)}
          />
        </Paper>
      )}
      {rejecting && (
        <RejectDialog open request={rejecting} busy={busyId === rejecting.id} onCancel={() => setRejecting(null)} onConfirm={reject} />
      )}
    </Box>
  )
}

ApprovalsList.propTypes = {
  limit: PropTypes.number,
  onCountChange: PropTypes.func,
}
