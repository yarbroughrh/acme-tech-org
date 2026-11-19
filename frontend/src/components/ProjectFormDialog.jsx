import { useState } from 'react'
import PropTypes from 'prop-types'
import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, FormHelperText, InputLabel,
  MenuItem, Select, Stack, TextField, useMediaQuery,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { createProject, updateProject } from '../api/projects'
import { newIdempotencyKey } from '../api/client'
import { LIFECYCLE_LABELS, PRIORITY_LABELS } from '../utils/format'
import { changedFields, fieldErrorsFrom, isConflict, saveErrorMessage } from '../utils/forms'
import { validateProject } from '../utils/validation'

const BASELINE_FIELDS = ['planned_start', 'planned_end', 'approved_budget', 'pm_user_id']
export const BASELINE_HELP = 'Only the Portfolio Manager can change baselines'

/** Form values from a project (edit) or defaults (create). */
function initialValues(project) {
  return {
    name: project?.name || '',
    department_id: project?.department?.id || '',
    pm_user_id: project?.pm?.id || '',
    planned_start: project?.planned_start || '',
    planned_end: project?.planned_end || '',
    approved_budget: project?.approved_budget ?? '',
    lifecycle_status: project?.lifecycle_status || 'PROPOSED',
    priority: project?.priority || 'MEDIUM',
    sponsor: project?.sponsor || '',
    description: project?.description || '',
    actual_start: project?.actual_start || '',
  }
}

/** Convert form strings into the API payload (numbers, nulls for empty optionals). */
function toPayload(values) {
  const out = { ...values, approved_budget: values.approved_budget === '' ? null : Number(values.approved_budget) }
  ;['sponsor', 'description', 'actual_start'].forEach((k) => { if (out[k] === '') out[k] = null })
  return out
}

/** Labelled select with an inline error. */
function SelectField({ id, label, value, onChange, options, error, disabled, required, helperText }) {
  return (
    <FormControl fullWidth size="small" error={Boolean(error)} disabled={disabled} required={required}>
      <InputLabel id={`${id}-label`}>{label}</InputLabel>
      <Select labelId={`${id}-label`} id={id} label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
      </Select>
      {(error || helperText) && <FormHelperText>{error || helperText}</FormHelperText>}
    </FormControl>
  )
}

SelectField.propTypes = {
  id: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  options: PropTypes.arrayOf(PropTypes.shape({ value: PropTypes.string, label: PropTypes.string })).isRequired,
  error: PropTypes.string,
  disabled: PropTypes.bool,
  required: PropTypes.bool,
  helperText: PropTypes.string,
}

/**
 * Create or edit a project. Validates inline before submitting, shows server field errors next to
 * fields, disables itself while saving, and (create) sends one Idempotency-Key per dialog opening so a
 * double-click or retry cannot create a duplicate. In edit mode, baseline fields are disabled unless
 * the caller may change baselines, and only changed fields are sent with the current version.
 */
export default function ProjectFormDialog({ open, mode, project, canEditBaseline = true, lookups, onClose, onSaved }) {
  const theme = useTheme()
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'))
  const [values, setValues] = useState(() => initialValues(project))
  const [errors, setErrors] = useState({})
  const [serverError, setServerError] = useState('')
  const [conflict, setConflict] = useState(false)
  const [saving, setSaving] = useState(false)
  const [idempotencyKey] = useState(() => newIdempotencyKey())
  const baselineLocked = mode === 'edit' && !canEditBaseline

  const set = (field) => (value) => setValues((v) => ({ ...v, [field]: value }))
  const text = (field) => (e) => set(field)(e.target.value)

  const handleSubmit = async (event) => {
    event.preventDefault()
    const found = validateProject(values)
    setErrors(found)
    setServerError('')
    if (Object.keys(found).length) return
    setSaving(true)
    try {
      let result
      if (mode === 'create') {
        result = await createProject(toPayload(values), idempotencyKey)
      } else {
        const changes = changedFields(toPayload(values), toPayload(initialValues(project)))
        BASELINE_FIELDS.forEach((f) => { if (baselineLocked) delete changes[f] })
        if (!Object.keys(changes).length) { onClose(); return }
        result = await updateProject(project.id, { ...changes, version: project.version })
      }
      onSaved(result.project)
    } catch (err) {
      setErrors(fieldErrorsFrom(err))
      setServerError(saveErrorMessage(err))
      setConflict(isConflict(err))
    } finally {
      setSaving(false)
    }
  }

  const title = mode === 'create' ? 'New project' : 'Edit project'
  const baselineHelp = baselineLocked ? BASELINE_HELP : undefined
  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth="md" fullScreen={fullScreen} aria-labelledby="project-form-title">
      <form onSubmit={handleSubmit} noValidate>
        <DialogTitle id="project-form-title">{title}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {serverError && (
              <Alert severity="error" role="alert" action={conflict ? <Button color="inherit" size="small" onClick={onClose}>Reload</Button> : undefined}>
                {serverError}
              </Alert>
            )}
            <TextField
              id="project-name" label="Project name" required value={values.name} onChange={text('name')}
              error={Boolean(errors.name)} helperText={errors.name || '3–120 characters, unique'} disabled={saving} fullWidth
            />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <SelectField
                id="project-department" label="Department" required value={values.department_id} onChange={set('department_id')}
                options={(lookups?.departments || []).map((d) => ({ value: d.id, label: d.name }))}
                error={errors.department_id} disabled={saving}
              />
              <SelectField
                id="project-pm" label="Project manager" required value={values.pm_user_id} onChange={set('pm_user_id')}
                options={(lookups?.project_managers || []).map((m) => ({ value: m.id, label: m.display_name }))}
                error={errors.pm_user_id} disabled={saving || baselineLocked} helperText={baselineHelp}
              />
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                id="project-start" label="Planned start" type="date" required value={values.planned_start} onChange={text('planned_start')}
                error={Boolean(errors.planned_start)} helperText={errors.planned_start || baselineHelp} disabled={saving || baselineLocked}
                fullWidth slotProps={{ inputLabel: { shrink: true } }}
              />
              <TextField
                id="project-end" label="Planned end" type="date" required value={values.planned_end} onChange={text('planned_end')}
                error={Boolean(errors.planned_end)} helperText={errors.planned_end || baselineHelp} disabled={saving || baselineLocked}
                fullWidth slotProps={{ inputLabel: { shrink: true } }}
              />
              <TextField
                id="project-actual-start" label="Actual start" type="date" value={values.actual_start} onChange={text('actual_start')}
                error={Boolean(errors.actual_start)} helperText={errors.actual_start} disabled={saving}
                fullWidth slotProps={{ inputLabel: { shrink: true } }}
              />
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                id="project-budget" label="Approved budget (USD)" type="number" required value={values.approved_budget}
                onChange={text('approved_budget')} error={Boolean(errors.approved_budget)}
                helperText={errors.approved_budget || baselineHelp} disabled={saving || baselineLocked} fullWidth
                slotProps={{ htmlInput: { min: 0, step: 1000 } }}
              />
              <SelectField
                id="project-lifecycle" label="Lifecycle status" required value={values.lifecycle_status} onChange={set('lifecycle_status')}
                options={Object.entries(LIFECYCLE_LABELS).map(([value, label]) => ({ value, label }))}
                error={errors.lifecycle_status} disabled={saving}
              />
              <SelectField
                id="project-priority" label="Priority" value={values.priority} onChange={set('priority')}
                options={Object.entries(PRIORITY_LABELS).map(([value, label]) => ({ value, label }))}
                error={errors.priority} disabled={saving}
              />
            </Stack>
            <TextField
              id="project-sponsor" label="Sponsor" value={values.sponsor} onChange={text('sponsor')}
              error={Boolean(errors.sponsor)} helperText={errors.sponsor} disabled={saving} fullWidth
            />
            <TextField
              id="project-description" label="Description" value={values.description} onChange={text('description')}
              error={Boolean(errors.description)} helperText={errors.description} disabled={saving} fullWidth multiline minRows={3}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={saving}>
            {saving ? 'Saving…' : mode === 'create' ? 'Create project' : 'Save changes'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

ProjectFormDialog.propTypes = {
  open: PropTypes.bool.isRequired,
  mode: PropTypes.oneOf(['create', 'edit']).isRequired,
  project: PropTypes.object,
  canEditBaseline: PropTypes.bool,
  lookups: PropTypes.shape({ departments: PropTypes.array, project_managers: PropTypes.array }),
  onClose: PropTypes.func.isRequired,
  onSaved: PropTypes.func.isRequired,
}
