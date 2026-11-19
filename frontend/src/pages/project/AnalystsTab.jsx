import { useState } from 'react'
import PropTypes from 'prop-types'
import {
  Button, FormControl, IconButton, InputLabel, List, ListItem, ListItemText, MenuItem, Paper, Select, Stack, Tooltip,
  Typography,
} from '@mui/material'
import PersonRemoveOutlinedIcon from '@mui/icons-material/PersonRemoveOutlined'
import { assignAnalyst, listAnalysts, removeAnalyst } from '../../api/analysts'
import ConfirmDialog from '../../components/ConfirmDialog'
import { useNotify } from '../../components/NotifyProvider'
import { EmptyState, ErrorState, LoadingState } from '../../components/PageState'
import useApiQuery from '../../utils/useApiQuery'
import { formatDate } from '../../utils/format'

/** PM Analysts assigned to the project; the PM (or PMO) can assign and remove them. */
export default function AnalystsTab({ project, lookups }) {
  const notify = useNotify()
  const canAssign = Boolean(project.permissions?.can_assign_analysts)
  const [reloadKey, setReloadKey] = useState(0)
  const [selected, setSelected] = useState('')
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState(null)
  const state = useApiQuery(() => listAnalysts(project.id), `${project.id}|${reloadKey}`)
  const items = state.data?.items || []
  const assignedIds = new Set(items.map((a) => a.user_id))
  const available = (lookups?.analysts || []).filter((a) => !assignedIds.has(a.id))

  const add = async () => {
    setBusy(true)
    try {
      await assignAnalyst(project.id, selected)
      notify('Analyst assigned')
      setSelected('')
      setReloadKey((k) => k + 1)
    } catch (err) {
      notify(err.message || 'The analyst could not be assigned.', 'error')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setBusy(true)
    try {
      await removeAnalyst(project.id, removing.user_id)
      notify('Analyst removed')
      setRemoving(null)
      setReloadKey((k) => k + 1)
    } catch (err) {
      notify(err.message || 'The analyst could not be removed.', 'error')
    } finally {
      setBusy(false)
    }
  }

  let body
  if (state.loading && !state.data) body = <LoadingState rows={2} label="Loading analysts" />
  else if (state.error) body = <ErrorState message={state.error.message} onRetry={state.reload} />
  else if (!items.length) body = <EmptyState title="No PM Analysts assigned" description={canAssign ? 'Assign an analyst so they can propose updates for your approval.' : undefined} />
  else {
    body = (
      <List aria-label="Assigned analysts">
        {items.map((a) => (
          <ListItem
            key={a.user_id} divider
            secondaryAction={canAssign ? (
              <Tooltip title="Remove">
                <IconButton edge="end" aria-label={`Remove ${a.display_name}`} onClick={() => setRemoving(a)}><PersonRemoveOutlinedIcon /></IconButton>
              </Tooltip>
            ) : undefined}
          >
            <ListItemText primary={a.display_name} secondary={`${a.email} · assigned ${formatDate(a.assigned_at)}`} />
          </ListItem>
        ))}
      </List>
    )
  }

  return (
    <Paper sx={{ p: { xs: 2, md: 3 } }}>
      <Typography variant="h2" component="h2" gutterBottom>PM Analysts</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Analysts propose changes to milestones and tasks. Their proposals apply only when the project manager approves them.
      </Typography>
      {canAssign && (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
          <FormControl size="small" sx={{ minWidth: 240 }}>
            <InputLabel id="assign-analyst-label">Analyst</InputLabel>
            <Select labelId="assign-analyst-label" id="assign-analyst" label="Analyst" value={selected} onChange={(e) => setSelected(e.target.value)} disabled={busy}>
              {available.map((a) => <MenuItem key={a.id} value={a.id}>{a.display_name}</MenuItem>)}
            </Select>
          </FormControl>
          <Button variant="contained" onClick={add} disabled={busy || !selected}>Assign analyst</Button>
        </Stack>
      )}
      {body}
      <ConfirmDialog
        open={Boolean(removing)} title="Remove analyst?" confirmLabel="Remove" destructive busy={busy}
        message={`${removing?.display_name || ''} will no longer be able to propose changes on this project. Their past proposals stay in the history.`}
        onConfirm={remove} onCancel={() => setRemoving(null)}
      />
    </Paper>
  )
}

AnalystsTab.propTypes = {
  project: PropTypes.object.isRequired,
  lookups: PropTypes.shape({ analysts: PropTypes.array }),
}
