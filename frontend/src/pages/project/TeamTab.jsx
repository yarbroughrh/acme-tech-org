import { useEffect, useState } from 'react'
import PropTypes from 'prop-types'
import {
  Alert, Autocomplete, Button, Card, CardContent, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Paper,
  Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Tooltip, Typography, useMediaQuery,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import AddIcon from '@mui/icons-material/Add'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import PersonRemoveOutlinedIcon from '@mui/icons-material/PersonRemoveOutlined'
import { createAllocation, listAllocations, removeAllocation, updateAllocation } from '../../api/allocations'
import { listPeople } from '../../api/people'
import ConfirmDialog from '../../components/ConfirmDialog'
import LoadChip from '../../components/LoadChip'
import { useNotify } from '../../components/NotifyProvider'
import { EmptyState, ErrorState, LoadingState } from '../../components/PageState'
import { validateAllocation } from '../../utils/allocations'
import { formatDate } from '../../utils/format'
import useApiQuery from '../../utils/useApiQuery'
import useDebouncedValue from '../../utils/useDebouncedValue'

const SEVERITY = { RED: 'error', AMBER: 'warning', INFO: 'info' }

/** Add or edit an allocation. */
function AllocationDialog({ open, project, allocation, onClose, onSaved }) {
  const editing = Boolean(allocation)
  // Initialised from props; the parent remounts the dialog (key) for each allocation it opens.
  const [values, setValues] = useState(() => (allocation
    ? { person: allocation.person, hours: String(allocation.hours_per_week), start: allocation.start_date, end: allocation.end_date }
    : { person: null, hours: '', start: project.planned_start, end: project.planned_end }))
  const [errors, setErrors] = useState({})
  const [serverError, setServerError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')
  const debounced = useDebouncedValue(search, 300)
  const [options, setOptions] = useState([])

  useEffect(() => {
    if (!open || editing) return
    let cancelled = false
    listPeople({ q: debounced, page_size: 20 })
      .then((r) => { if (!cancelled) setOptions((r.items || []).map((p) => ({ id: p.id, full_name: p.full_name, total_hours: p.total_hours }))) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [debounced, open, editing])

  const set = (field) => (e) => setValues((v) => ({ ...v, [field]: e.target.value }))

  const save = async () => {
    const found = validateAllocation(values, project, editing)
    setErrors(found)
    if (Object.keys(found).length) return
    setBusy(true)
    setServerError(null)
    try {
      const body = { hours_per_week: Number(values.hours), start_date: values.start, end_date: values.end }
      const result = editing
        ? await updateAllocation(project.id, allocation.id, { ...body, version: allocation.version })
        : await createAllocation(project.id, { ...body, person_id: values.person.id })
      onSaved(result, editing ? allocation.person.full_name : values.person.full_name)
    } catch (err) {
      const fieldErrors = {}
      ;(err.details || []).forEach((d) => {
        const key = { person_id: 'person', hours_per_week: 'hours', start_date: 'start', end_date: 'end' }[d.field]
        if (key) fieldErrors[key] = d.message
      })
      setErrors(fieldErrors)
      setServerError(err.message || 'The allocation could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm" aria-labelledby="allocation-dialog-title">
      <DialogTitle id="allocation-dialog-title">{editing ? `Edit allocation: ${allocation.person.full_name}` : 'Allocate a person'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {serverError && <Alert severity="error">{serverError}</Alert>}
          {!editing && (
            <Autocomplete
              id="allocation-person"
              options={options}
              value={values.person}
              onChange={(_e, person) => setValues((v) => ({ ...v, person }))}
              onInputChange={(_e, text) => setSearch(text)}
              getOptionLabel={(o) => o.full_name}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              filterOptions={(x) => x}
              renderOption={(props, o) => (
                <li {...props} key={o.id}>{o.full_name} <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1 }}>{o.total_hours} h/week now</Typography></li>
              )}
              renderInput={(params) => (
                <TextField {...params} label="Person" required error={Boolean(errors.person)} helperText={errors.person || 'Search by name'} />
              )}
              disabled={busy}
            />
          )}
          <TextField
            id="allocation-hours" label="Hours per week" type="number" required value={values.hours} onChange={set('hours')}
            error={Boolean(errors.hours)} helperText={errors.hours || '0.5 to 168. Over 40 h/week across projects shows a warning; nothing is blocked.'}
            slotProps={{ htmlInput: { min: 0.5, max: 168, step: 0.5 } }} disabled={busy}
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField id="allocation-start" label="Start date" type="date" required value={values.start} onChange={set('start')}
              error={Boolean(errors.start)} helperText={errors.start} slotProps={{ inputLabel: { shrink: true } }} disabled={busy} fullWidth />
            <TextField id="allocation-end" label="End date" type="date" required value={values.end} onChange={set('end')}
              error={Boolean(errors.end)} helperText={errors.end} slotProps={{ inputLabel: { shrink: true } }} disabled={busy} fullWidth />
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
      </DialogActions>
    </Dialog>
  )
}

AllocationDialog.propTypes = {
  open: PropTypes.bool.isRequired,
  project: PropTypes.object.isRequired,
  allocation: PropTypes.object,
  onClose: PropTypes.func.isRequired,
  onSaved: PropTypes.func.isRequired,
}

/** Team tab: who is allocated, how many hours, and each person's total load across projects. */
export default function TeamTab({ project }) {
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'))
  const notify = useNotify()
  const canEdit = Boolean(project.permissions?.can_edit_allocations)
  const [reloadKey, setReloadKey] = useState(0)
  const [editing, setEditing] = useState(undefined) // undefined = closed, null = new, object = edit
  const [removing, setRemoving] = useState(null)
  const [busy, setBusy] = useState(false)
  const [warnings, setWarnings] = useState([])
  const state = useApiQuery(() => listAllocations(project.id), `${project.id}|${reloadKey}`)
  const items = state.data?.items || []

  const onSaved = (result, name) => {
    setEditing(undefined)
    setReloadKey((k) => k + 1)
    const list = result?.warnings || []
    setWarnings(list)
    notify(list.length ? `Saved allocation for ${name} with ${list.length} warning${list.length > 1 ? 's' : ''}.` : `Saved allocation for ${name}.`,
      list.some((w) => w.severity === 'RED') ? 'error' : list.length ? 'warning' : 'success')
  }

  const remove = async () => {
    setBusy(true)
    try {
      await removeAllocation(project.id, removing.id)
      notify(`Removed ${removing.person.full_name} from the team.`)
      setRemoving(null)
      setReloadKey((k) => k + 1)
    } catch (err) {
      notify(err.message || 'The allocation could not be removed.', 'error')
    } finally {
      setBusy(false)
    }
  }

  const actions = (a) => canEdit && (
    <Stack direction="row" spacing={0.5}>
      <Tooltip title="Edit"><IconButton aria-label={`Edit allocation for ${a.person.full_name}`} onClick={() => setEditing(a)}><EditOutlinedIcon /></IconButton></Tooltip>
      <Tooltip title="Remove"><IconButton aria-label={`Remove ${a.person.full_name}`} onClick={() => setRemoving(a)}><PersonRemoveOutlinedIcon /></IconButton></Tooltip>
    </Stack>
  )

  let body
  if (state.loading && !state.data) body = <LoadingState rows={3} label="Loading team" />
  else if (state.error) body = <ErrorState message={state.error.message} onRetry={state.reload} />
  else if (!items.length) body = <EmptyState title="No one is allocated yet" description={canEdit ? 'Allocate people so delivery capacity is visible.' : undefined} />
  else if (isMobile) {
    body = (
      <Stack spacing={1.5}>
        {items.map((a) => (
          <Card key={a.id} variant="outlined">
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                <Typography variant="subtitle1" component="h3">{a.person.full_name}</Typography>
                {actions(a)}
              </Stack>
              <Typography variant="body2">{a.hours_per_week} h/week · {formatDate(a.start_date)} – {formatDate(a.end_date)}</Typography>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
                <Typography variant="body2" color="text.secondary">Total {a.person_total_hours} h/week</Typography>
                <LoadChip status={a.load_status} totalHours={a.person_total_hours} />
              </Stack>
            </CardContent>
          </Card>
        ))}
      </Stack>
    )
  } else {
    body = (
      <TableContainer>
        <Table size="small" aria-label="Team allocations">
          <TableHead>
            <TableRow>
              <TableCell>Person</TableCell>
              <TableCell align="right">Hours/week</TableCell>
              <TableCell>Dates</TableCell>
              <TableCell align="right">Total across projects</TableCell>
              <TableCell>Load</TableCell>
              {canEdit && <TableCell align="right">Actions</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((a) => (
              <TableRow key={a.id}>
                <TableCell>{a.person.full_name}</TableCell>
                <TableCell align="right">{a.hours_per_week}</TableCell>
                <TableCell>{formatDate(a.start_date)} – {formatDate(a.end_date)}</TableCell>
                <TableCell align="right">{a.person_total_hours} h</TableCell>
                <TableCell><LoadChip status={a.load_status} totalHours={a.person_total_hours} /></TableCell>
                {canEdit && <TableCell align="right">{actions(a)}</TableCell>}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    )
  }

  return (
    <Paper sx={{ p: { xs: 2, md: 3 } }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }} spacing={1}>
        <Typography variant="h2" component="h2">Team</Typography>
        {canEdit && <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing(null)}>Allocate person</Button>}
      </Stack>
      {warnings.length > 0 && (
        <Stack spacing={1} sx={{ mb: 2 }} role="status">
          {warnings.map((w) => (
            <Alert key={w.code} severity={SEVERITY[w.severity] || 'info'} onClose={() => setWarnings([])}>
              {w.severity === 'RED' && <strong>Severely over-allocated. </strong>}
              {w.severity === 'AMBER' && <strong>Over-allocated. </strong>}
              {w.message} The allocation was saved.
            </Alert>
          ))}
        </Stack>
      )}
      {body}
      {editing !== undefined && (
        <AllocationDialog
          key={editing?.id || 'new'} open project={project} allocation={editing || null}
          onClose={() => setEditing(undefined)} onSaved={onSaved}
        />
      )}
      <ConfirmDialog
        open={Boolean(removing)} title="Remove from team?" confirmLabel="Remove" destructive busy={busy}
        message={`${removing?.person.full_name || ''}'s allocation will be archived. It stays in the history.`}
        onConfirm={remove} onCancel={() => setRemoving(null)}
      />
    </Paper>
  )
}

TeamTab.propTypes = { project: PropTypes.object.isRequired }
