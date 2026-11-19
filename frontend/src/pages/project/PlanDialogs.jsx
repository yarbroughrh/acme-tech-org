import { useState } from 'react'
import PropTypes from 'prop-types'
import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, FormHelperText, InputLabel,
  MenuItem, Select, Stack, TextField, useMediaQuery,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { createMilestone, updateMilestone } from '../../api/milestones'
import { createTask, updateTask } from '../../api/tasks'
import { newIdempotencyKey } from '../../api/client'
import { MILESTONE_STATUS_LABELS, TASK_STATUS_LABELS } from '../../utils/format'
import { changedFields, fieldErrorsFrom, isConflict, saveErrorMessage } from '../../utils/forms'
import { validateMilestone, validateTask } from '../../utils/validation'

/** Select with label and inline error. */
function Choice({ id, label, value, onChange, options, error, disabled, required, allowEmpty }) {
  return (
    <FormControl fullWidth size="small" error={Boolean(error)} disabled={disabled} required={required}>
      <InputLabel id={`${id}-label`}>{label}</InputLabel>
      <Select labelId={`${id}-label`} id={id} label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        {allowEmpty && <MenuItem value=""><em>None</em></MenuItem>}
        {options.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
      </Select>
      {error && <FormHelperText>{error}</FormHelperText>}
    </FormControl>
  )
}

Choice.propTypes = {
  id: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  options: PropTypes.arrayOf(PropTypes.shape({ value: PropTypes.string, label: PropTypes.string })).isRequired,
  error: PropTypes.string,
  disabled: PropTypes.bool,
  required: PropTypes.bool,
  allowEmpty: PropTypes.bool,
}

/** Shared save flow for create/edit dialogs. */
function useSave(onSaved) {
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState({})
  const [serverError, setServerError] = useState('')
  const [conflict, setConflict] = useState(false)
  const run = async (fn) => {
    setSaving(true)
    setServerError('')
    try {
      onSaved(await fn())
    } catch (err) {
      setErrors(fieldErrorsFrom(err))
      setServerError(saveErrorMessage(err))
      setConflict(isConflict(err))
    } finally {
      setSaving(false)
    }
  }
  return { saving, errors, setErrors, serverError, conflict, run }
}

const nullIfEmpty = (v) => (v === '' ? null : v)

/** Create or edit a milestone (PMO, or the project's own PM). */
export function MilestoneDialog({ open, project, milestone, team, onClose, onSaved }) {
  const theme = useTheme()
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'))
  const initial = {
    name: milestone?.name || '',
    due_date: milestone?.due_date || '',
    status: milestone?.status || 'NOT_STARTED',
    owner_person_id: milestone?.owner?.id || '',
    percent_complete: milestone?.percent_complete ?? '',
    description: milestone?.description || '',
    notes: milestone?.notes || '',
  }
  const [values, setValues] = useState(initial)
  const [key] = useState(() => newIdempotencyKey())
  const { saving, errors, setErrors, serverError, conflict, run } = useSave(onSaved)
  const set = (f) => (v) => setValues((x) => ({ ...x, [f]: v }))
  const text = (f) => (e) => set(f)(e.target.value)

  const submit = (event) => {
    event.preventDefault()
    const found = validateMilestone(values, project)
    setErrors(found)
    if (Object.keys(found).length) return
    const payload = {
      ...values,
      owner_person_id: nullIfEmpty(values.owner_person_id),
      percent_complete: values.percent_complete === '' ? null : Number(values.percent_complete),
      description: nullIfEmpty(values.description),
      notes: nullIfEmpty(values.notes),
    }
    run(async () => {
      if (!milestone) return (await createMilestone(project.id, payload, key)).milestone
      const changes = changedFields(payload, { ...initial, owner_person_id: nullIfEmpty(initial.owner_person_id), percent_complete: initial.percent_complete === '' ? null : Number(initial.percent_complete), description: nullIfEmpty(initial.description), notes: nullIfEmpty(initial.notes) })
      return (await updateMilestone(project.id, milestone.id, { ...changes, version: milestone.version })).milestone
    })
  }

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth="sm" fullScreen={fullScreen} aria-labelledby="milestone-dialog-title">
      <form onSubmit={submit} noValidate>
        <DialogTitle id="milestone-dialog-title">{milestone ? 'Edit milestone' : 'Add milestone'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {serverError && (
              <Alert severity="error" role="alert" action={conflict ? <Button color="inherit" size="small" onClick={onClose}>Reload</Button> : undefined}>
                {serverError}
              </Alert>
            )}
            <TextField id="milestone-name" label="Milestone name" required value={values.name} onChange={text('name')} error={Boolean(errors.name)} helperText={errors.name} disabled={saving} />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                id="milestone-due" label="Due date" type="date" required value={values.due_date} onChange={text('due_date')} fullWidth
                error={Boolean(errors.due_date)} helperText={errors.due_date || 'Within the project dates'} disabled={saving} slotProps={{ inputLabel: { shrink: true } }}
              />
              <Choice
                id="milestone-status" label="Status" required value={values.status} onChange={set('status')} error={errors.status} disabled={saving}
                options={Object.entries(MILESTONE_STATUS_LABELS).map(([value, label]) => ({ value, label }))}
              />
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <Choice
                id="milestone-owner" label="Owner" value={values.owner_person_id} onChange={set('owner_person_id')} error={errors.owner_person_id} disabled={saving} allowEmpty
                options={(team || []).map((p) => ({ value: p.id, label: p.full_name }))}
              />
              <TextField
                id="milestone-pct" label="Percent complete" type="number" value={values.percent_complete} onChange={text('percent_complete')} fullWidth
                error={Boolean(errors.percent_complete)} helperText={errors.percent_complete || 'Used only when it has no tasks'} disabled={saving}
                slotProps={{ htmlInput: { min: 0, max: 100, step: 1 } }}
              />
            </Stack>
            <TextField id="milestone-description" label="Description" value={values.description} onChange={text('description')} multiline minRows={2} disabled={saving} />
            <TextField id="milestone-notes" label="Notes" value={values.notes} onChange={text('notes')} multiline minRows={2} disabled={saving} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={saving}>{saving ? 'Saving…' : 'Save milestone'}</Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

MilestoneDialog.propTypes = {
  open: PropTypes.bool.isRequired,
  project: PropTypes.object.isRequired,
  milestone: PropTypes.object,
  team: PropTypes.array,
  onClose: PropTypes.func.isRequired,
  onSaved: PropTypes.func.isRequired,
}

/** Create or edit a task (PMO, or the project's own PM). Assignees come from the project team. */
export function TaskDialog({ open, project, task, milestones, defaultMilestoneId, team, onClose, onSaved }) {
  const theme = useTheme()
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'))
  const initial = {
    title: task?.title || '',
    milestone_id: task?.milestone_id || defaultMilestoneId || '',
    status: task?.status || 'TODO',
    assignee_person_id: task?.assignee?.id || '',
    due_date: task?.due_date || '',
    notes: task?.notes || '',
  }
  const [values, setValues] = useState(initial)
  const [key] = useState(() => newIdempotencyKey())
  const { saving, errors, setErrors, serverError, conflict, run } = useSave(onSaved)
  const set = (f) => (v) => setValues((x) => ({ ...x, [f]: v }))
  const text = (f) => (e) => set(f)(e.target.value)
  const clean = (v) => ({ ...v, assignee_person_id: nullIfEmpty(v.assignee_person_id), due_date: nullIfEmpty(v.due_date), notes: nullIfEmpty(v.notes) })

  const submit = (event) => {
    event.preventDefault()
    const found = validateTask(values, project)
    setErrors(found)
    if (Object.keys(found).length) return
    run(async () => {
      if (!task) return (await createTask(project.id, clean(values), key)).task
      const changes = changedFields(clean(values), clean(initial))
      return (await updateTask(project.id, task.id, { ...changes, version: task.version })).task
    })
  }

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth="sm" fullScreen={fullScreen} aria-labelledby="task-dialog-title">
      <form onSubmit={submit} noValidate>
        <DialogTitle id="task-dialog-title">{task ? 'Edit task' : 'Add task'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {serverError && (
              <Alert severity="error" role="alert" action={conflict ? <Button color="inherit" size="small" onClick={onClose}>Reload</Button> : undefined}>
                {serverError}
              </Alert>
            )}
            <TextField id="task-title" label="Task title" required value={values.title} onChange={text('title')} error={Boolean(errors.title)} helperText={errors.title} disabled={saving} />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <Choice
                id="task-milestone" label="Milestone" required value={values.milestone_id} onChange={set('milestone_id')} error={errors.milestone_id} disabled={saving}
                options={(milestones || []).map((m) => ({ value: m.id, label: m.name }))}
              />
              <Choice
                id="task-status" label="Status" required value={values.status} onChange={set('status')} error={errors.status} disabled={saving}
                options={Object.entries(TASK_STATUS_LABELS).map(([value, label]) => ({ value, label }))}
              />
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <Choice
                id="task-assignee" label="Assignee" value={values.assignee_person_id} onChange={set('assignee_person_id')} error={errors.assignee_person_id} disabled={saving} allowEmpty
                options={(team || []).map((p) => ({ value: p.id, label: p.full_name }))}
              />
              <TextField
                id="task-due" label="Due date" type="date" value={values.due_date} onChange={text('due_date')} fullWidth
                error={Boolean(errors.due_date)} helperText={errors.due_date} disabled={saving} slotProps={{ inputLabel: { shrink: true } }}
              />
            </Stack>
            <TextField id="task-notes" label="Notes" value={values.notes} onChange={text('notes')} multiline minRows={2} disabled={saving} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={saving}>{saving ? 'Saving…' : 'Save task'}</Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

TaskDialog.propTypes = {
  open: PropTypes.bool.isRequired,
  project: PropTypes.object.isRequired,
  task: PropTypes.object,
  milestones: PropTypes.array,
  defaultMilestoneId: PropTypes.string,
  team: PropTypes.array,
  onClose: PropTypes.func.isRequired,
  onSaved: PropTypes.func.isRequired,
}
