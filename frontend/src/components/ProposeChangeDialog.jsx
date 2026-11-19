import { useState } from 'react'
import PropTypes from 'prop-types'
import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, FormControl, InputLabel,
  MenuItem, Select, Stack, TextField, useMediaQuery,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { proposeChange } from '../api/changeRequests'
import { newIdempotencyKey } from '../api/client'
import { MILESTONE_STATUS_LABELS, TASK_STATUS_LABELS } from '../utils/format'
import { changedFields, fieldErrorsFrom } from '../utils/forms'

/** Fields a PM Analyst may propose, per entity type (CONFIRMED). */
const PROPOSABLE_FIELDS = {
  MILESTONE: ['status', 'percent_complete', 'due_date', 'notes'],
  TASK: ['status', 'due_date', 'notes'],
}

/** Current values of the proposable fields, as form strings. */
function currentValues(entityType, entity) {
  const out = {}
  PROPOSABLE_FIELDS[entityType].forEach((f) => {
    out[f] = entity?.[f] === null || entity?.[f] === undefined ? '' : String(entity[f])
  })
  return out
}

/**
 * PM Analyst proposes a change to a milestone or task. Only changed fields are sent, at least one
 * change is required, and nothing changes until the project's PM approves.
 */
export default function ProposeChangeDialog({ open, projectId, pmName, entityType, entity, onClose, onProposed }) {
  const theme = useTheme()
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'))
  const original = currentValues(entityType, entity)
  const [values, setValues] = useState(original)
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [idempotencyKey] = useState(() => newIdempotencyKey())
  const statusLabels = entityType === 'TASK' ? TASK_STATUS_LABELS : MILESTONE_STATUS_LABELS
  const set = (field) => (e) => setValues((v) => ({ ...v, [field]: e.target.value }))

  const handleSubmit = async (event) => {
    event.preventDefault()
    setFormError('')
    const found = {}
    if (values.percent_complete !== undefined && values.percent_complete !== '') {
      const pct = Number(values.percent_complete)
      if (!Number.isInteger(pct) || pct < 0 || pct > 100) found.percent_complete = 'Enter a whole number from 0 to 100.'
    }
    setErrors(found)
    if (Object.keys(found).length) return
    const changes = changedFields(values, original)
    if ('percent_complete' in changes && changes.percent_complete !== null) changes.percent_complete = Number(changes.percent_complete)
    if (!Object.keys(changes).length) {
      setFormError('Change at least one field before sending a proposal.')
      return
    }
    setSaving(true)
    try {
      const body = { entity_type: entityType, entity_id: entity.id, changes }
      if (note.trim()) body.note = note.trim()
      const result = await proposeChange(projectId, body, idempotencyKey)
      onProposed(result.change_request)
    } catch (err) {
      setErrors(fieldErrorsFrom(err))
      setFormError(err.message || 'The proposal could not be sent.')
    } finally {
      setSaving(false)
    }
  }

  const entityLabel = entityType === 'TASK' ? 'task' : 'milestone'
  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth="sm" fullScreen={fullScreen} aria-labelledby="propose-title">
      <form onSubmit={handleSubmit} noValidate>
        <DialogTitle id="propose-title">Propose a change</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            {`${entity?.name || entity?.title} — your proposal goes to ${pmName || 'the project manager'} for approval. `}
            {`Nothing changes on the ${entityLabel} until it is approved.`}
          </DialogContentText>
          <Stack spacing={2}>
            {formError && <Alert severity="error" role="alert">{formError}</Alert>}
            <FormControl fullWidth size="small">
              <InputLabel id="propose-status-label">Status</InputLabel>
              <Select labelId="propose-status-label" id="propose-status" label="Status" value={values.status} onChange={set('status')} disabled={saving}>
                {Object.entries(statusLabels).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
              </Select>
            </FormControl>
            {entityType === 'MILESTONE' && (
              <TextField
                id="propose-percent" label="Percent complete" type="number" value={values.percent_complete} onChange={set('percent_complete')}
                error={Boolean(errors.percent_complete)} helperText={errors.percent_complete || 'Used when the milestone has no tasks'}
                disabled={saving} slotProps={{ htmlInput: { min: 0, max: 100, step: 1 } }}
              />
            )}
            <TextField
              id="propose-due" label="Due date" type="date" value={values.due_date} onChange={set('due_date')}
              error={Boolean(errors.due_date)} helperText={errors.due_date} disabled={saving} slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              id="propose-notes" label="Notes" value={values.notes} onChange={set('notes')} multiline minRows={2}
              error={Boolean(errors.notes)} helperText={errors.notes} disabled={saving}
            />
            <TextField
              id="propose-note" label="Message to the project manager (optional)" value={note} onChange={(e) => setNote(e.target.value)}
              multiline minRows={2} disabled={saving}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={saving}>{saving ? 'Sending…' : 'Send for approval'}</Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

ProposeChangeDialog.propTypes = {
  open: PropTypes.bool.isRequired,
  projectId: PropTypes.string.isRequired,
  pmName: PropTypes.string,
  entityType: PropTypes.oneOf(['MILESTONE', 'TASK']).isRequired,
  entity: PropTypes.object.isRequired,
  onClose: PropTypes.func.isRequired,
  onProposed: PropTypes.func.isRequired,
}
