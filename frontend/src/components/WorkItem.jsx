import { useState } from 'react'
import PropTypes from 'prop-types'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { Box, Button, Card, Chip, Link, Stack, Typography } from '@mui/material'
import ErrorOutlinedIcon from '@mui/icons-material/ErrorOutlined'
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined'
import ScheduleOutlinedIcon from '@mui/icons-material/ScheduleOutlined'
import { approveChangeRequest, rejectChangeRequest } from '../api/changeRequests'
import { useNotify } from './NotifyProvider'
import RejectReasonDialog from './RejectReasonDialog'
import { SEVERITY_META, relativeTime } from '../utils/workQueue'

const ICONS = { critical: ErrorOutlinedIcon, high: WarningAmberOutlinedIcon, due_soon: ScheduleOutlinedIcon }

/**
 * One "next action": severity stripe + icon + text label (never colour alone), title, reason,
 * project, relative time, "New" chip and a primary action. PM approvals can be decided inline.
 */
export default function WorkItem({ item, onChanged }) {
  const navigate = useNavigate()
  const notify = useNotify()
  const [busy, setBusy] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const meta = SEVERITY_META[item.severity] || SEVERITY_META.due_soon
  const Icon = ICONS[item.severity] || ScheduleOutlinedIcon
  const when = relativeTime(item)
  const crId = item.approval?.change_request_id

  const decide = async (action, reason) => {
    setBusy(true)
    try {
      if (action === 'approve') await approveChangeRequest(crId)
      else await rejectChangeRequest(crId, reason)
      notify(action === 'approve' ? 'Approved and applied.' : 'Rejected. The analyst will see your reason.')
      setRejecting(false)
      onChanged()
    } catch (err) {
      notify(err.message, 'error')
      if (err.status === 409) onChanged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card
      variant="outlined"
      component="article"
      aria-label={`${meta.label}: ${item.title}`}
      sx={{ display: 'flex', borderLeft: 4, borderLeftColor: `${meta.color}.main` }}
    >
      <Box sx={{ p: 2, flexGrow: 1, minWidth: 0 }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 0.5 }}>
          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ color: `${meta.color}.main` }}>
            <Icon fontSize="small" aria-hidden="true" />
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{meta.label}</Typography>
          </Stack>
          {when && <Typography variant="body2" color="text.secondary">· {when}</Typography>}
          {item.is_new && <Chip size="small" label="New" color="primary" variant="outlined" />}
        </Stack>
        <Typography component="h3" sx={{ fontWeight: 700, fontSize: '1rem' }}>{item.title}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>{item.reason}</Typography>
        {item.project && (
          <Typography variant="body2" sx={{ mt: 0.5 }}>
            <Link component={RouterLink} to={`/portfolio/${item.project.id}`}>{item.project.name}</Link>
          </Typography>
        )}
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 1.5 }}>
          <Button
            variant="contained" size="medium" onClick={() => navigate(item.action.route)}
            sx={{ minHeight: 44, width: { xs: '100%', sm: 'auto' } }}
          >
            {item.action.label}
          </Button>
          {crId && (
            <>
              <Button
                variant="outlined" color="success" disabled={busy} onClick={() => decide('approve')}
                sx={{ minHeight: 44, width: { xs: '100%', sm: 'auto' } }}
              >
                Approve
              </Button>
              <Button
                variant="outlined" color="error" disabled={busy} onClick={() => setRejecting(true)}
                sx={{ minHeight: 44, width: { xs: '100%', sm: 'auto' } }}
              >
                Reject
              </Button>
            </>
          )}
        </Stack>
      </Box>
      {rejecting && (
        <RejectReasonDialog
          open
          busy={busy}
          title={`Reject: ${item.title}`}
          onCancel={() => setRejecting(false)}
          onConfirm={(reason) => decide('reject', reason)}
        />
      )}
    </Card>
  )
}

WorkItem.propTypes = {
  item: PropTypes.shape({
    id: PropTypes.string.isRequired,
    type: PropTypes.string.isRequired,
    severity: PropTypes.string.isRequired,
    title: PropTypes.string.isRequired,
    reason: PropTypes.string.isRequired,
    project: PropTypes.shape({ id: PropTypes.string, name: PropTypes.string }),
    action: PropTypes.shape({ label: PropTypes.string, route: PropTypes.string }).isRequired,
    is_new: PropTypes.bool,
    approval: PropTypes.shape({ change_request_id: PropTypes.string }),
  }).isRequired,
  onChanged: PropTypes.func.isRequired,
}
