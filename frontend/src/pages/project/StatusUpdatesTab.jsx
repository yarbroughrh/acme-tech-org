import { useState } from 'react'
import PropTypes from 'prop-types'
import {
  Alert, Box, Button, FormControl, FormControlLabel, FormHelperText, FormLabel, Paper, Radio, RadioGroup, Stack,
  TextField, Typography,
} from '@mui/material'
import { listStatusUpdates, submitStatusUpdate } from '../../api/statusUpdates'
import { newIdempotencyKey } from '../../api/client'
import HealthBadge from '../../components/HealthBadge'
import { useNotify } from '../../components/NotifyProvider'
import { EmptyState, ErrorState, LoadingState } from '../../components/PageState'
import useApiQuery from '../../utils/useApiQuery'
import { HEALTH_LABELS, formatDateTime } from '../../utils/format'
import { fieldErrorsFrom } from '../../utils/forms'

const MAX_SUMMARY = 4000

/** The weekly update form: one choice and a short summary, designed for under two minutes. */
function StatusUpdateForm({ projectId, onSubmitted }) {
  const notify = useNotify()
  const [reported, setReported] = useState('')
  const [summary, setSummary] = useState('')
  const [errors, setErrors] = useState({})
  const [serverError, setServerError] = useState('')
  const [saving, setSaving] = useState(false)
  const [key, setKey] = useState(() => newIdempotencyKey())

  const submit = async (event) => {
    event.preventDefault()
    const found = {}
    if (!reported) found.reported_status = 'Choose the status you believe the project is in.'
    if (!summary.trim()) found.summary = 'Write a short summary of this week.'
    else if (summary.length > MAX_SUMMARY) found.summary = `Keep the summary under ${MAX_SUMMARY} characters.`
    setErrors(found)
    setServerError('')
    if (Object.keys(found).length) return
    setSaving(true)
    try {
      const result = await submitStatusUpdate(projectId, { reported_status: reported, summary: summary.trim() }, key)
      notify('Weekly update submitted')
      setReported('')
      setSummary('')
      setKey(newIdempotencyKey())
      onSubmitted(result)
    } catch (err) {
      setErrors(fieldErrorsFrom(err))
      setServerError(err.message || 'The update could not be submitted.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Paper sx={{ p: { xs: 2, md: 3 }, mb: 2 }} component="form" onSubmit={submit} noValidate aria-labelledby="weekly-update-heading">
      <Typography id="weekly-update-heading" variant="h2" component="h2" gutterBottom>Weekly status update</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Tell us how you see the project. This does not change its calculated health; if you report a better status than
        the data shows, the project is flagged &quot;Status mismatch&quot; for the Portfolio Manager.
      </Typography>
      <Stack spacing={2}>
        {serverError && <Alert severity="error" role="alert">{serverError}</Alert>}
        <FormControl error={Boolean(errors.reported_status)} required>
          <FormLabel id="reported-status-label">Status you believe the project is in</FormLabel>
          <RadioGroup row aria-labelledby="reported-status-label" value={reported} onChange={(e) => setReported(e.target.value)}>
            {['GREEN', 'AMBER', 'RED'].map((h) => (
              <FormControlLabel
                key={h} value={h} disabled={saving}
                control={<Radio slotProps={{ input: { 'aria-label': HEALTH_LABELS[h] } }} />}
                label={<HealthBadge health={h} size="small" />}
              />
            ))}
          </RadioGroup>
          {errors.reported_status && <FormHelperText>{errors.reported_status}</FormHelperText>}
        </FormControl>
        <TextField
          id="status-summary" label="Summary" required multiline minRows={3} value={summary} onChange={(e) => setSummary(e.target.value)}
          error={Boolean(errors.summary)} helperText={errors.summary || `${summary.length}/${MAX_SUMMARY}`} disabled={saving}
        />
        <Box>
          <Button type="submit" variant="contained" disabled={saving}>{saving ? 'Submitting…' : 'Submit update'}</Button>
        </Box>
      </Stack>
    </Paper>
  )
}

StatusUpdateForm.propTypes = { projectId: PropTypes.string.isRequired, onSubmitted: PropTypes.func.isRequired }

/** Status updates tab: the weekly form (owning PM) and the history. */
export default function StatusUpdatesTab({ project, onChanged }) {
  const [reloadKey, setReloadKey] = useState(0)
  const history = useApiQuery(() => listStatusUpdates(project.id), `${project.id}|${reloadKey}`)
  const items = history.data?.items || []

  let list
  if (history.loading && !history.data) list = <LoadingState rows={3} label="Loading status updates" />
  else if (history.error) list = <ErrorState message={history.error.message} onRetry={history.reload} />
  else if (!items.length) list = <EmptyState title="No status updates yet" />
  else {
    list = (
      <Stack spacing={1.5} component="ol" sx={{ listStyle: 'none', p: 0, m: 0 }} aria-label="Status update history">
        {items.map((u) => (
          <Paper component="li" key={u.id} sx={{ p: 2 }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }} sx={{ mb: 1 }}>
              <HealthBadge health={u.reported_status} size="small" />
              <Typography variant="body2" color="text.secondary">
                {`Reported by ${u.author?.display_name || 'PM'} · ${formatDateTime(u.created_at)}`}
              </Typography>
            </Stack>
            <Typography sx={{ whiteSpace: 'pre-line' }}>{u.summary}</Typography>
          </Paper>
        ))}
      </Stack>
    )
  }

  return (
    <>
      {project.permissions?.can_submit_status && (
        <StatusUpdateForm projectId={project.id} onSubmitted={() => { setReloadKey((k) => k + 1); onChanged() }} />
      )}
      {list}
    </>
  )
}

StatusUpdatesTab.propTypes = { project: PropTypes.object.isRequired, onChanged: PropTypes.func.isRequired }
