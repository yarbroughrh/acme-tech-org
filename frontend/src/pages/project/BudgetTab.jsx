import { useState } from 'react'
import PropTypes from 'prop-types'
import {
  Alert, Button, Card, CardContent, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, FormHelperText,
  InputLabel, MenuItem, Paper, Select, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TextField, Typography, useMediaQuery,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import AddIcon from '@mui/icons-material/Add'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import { listSpend, saveSpend } from '../../api/spend'
import { newIdempotencyKey } from '../../api/client'
import { useNotify } from '../../components/NotifyProvider'
import { EmptyState, ErrorState, LoadingState } from '../../components/PageState'
import { formatDate, formatUsd } from '../../utils/format'
import { fieldErrorsFrom, saveErrorMessage } from '../../utils/forms'
import { SPEND_CATEGORY_LABELS, formatWeek, lastWeekMonday, validateSpend } from '../../utils/spend'
import useApiQuery from '../../utils/useApiQuery'

const NUM = { fontVariantNumeric: 'tabular-nums' }

/** Record or update one week's spend for one category (Portfolio Manager only). */
function SpendDialog({ projectId, entry, onClose, onSaved }) {
  const editing = Boolean(entry)
  const [values, setValues] = useState(() => (entry
    ? { week_starting: entry.week_starting, category: entry.category, amount: String(entry.amount), note: entry.note || '' }
    : { week_starting: lastWeekMonday(), category: 'LABOUR', amount: '', note: '' }))
  const [errors, setErrors] = useState({})
  const [serverError, setServerError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [idempotencyKey] = useState(() => newIdempotencyKey())
  const set = (field) => (e) => setValues((v) => ({ ...v, [field]: e.target.value }))

  const save = async (event) => {
    event.preventDefault()
    const found = validateSpend(values)
    setErrors(found)
    setServerError(null)
    if (Object.keys(found).length) return
    setBusy(true)
    try {
      const body = { week_starting: values.week_starting, category: values.category, amount: Number(values.amount) }
      if (values.note.trim()) body.note = values.note.trim()
      const result = await saveSpend(projectId, body, idempotencyKey)
      onSaved(result, values)
    } catch (err) {
      setErrors(fieldErrorsFrom(err))
      setServerError(saveErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="sm" aria-labelledby="spend-dialog-title">
      <form onSubmit={save} noValidate>
        <DialogTitle id="spend-dialog-title">{editing ? 'Edit weekly spend' : 'Record weekly spend'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {serverError && <Alert severity="error" role="alert">{serverError}</Alert>}
            <Typography variant="body2" color="text.secondary">
              One entry per week and category — saving the same week and category again updates it.
            </Typography>
            <TextField
              id="spend-week" label="Week starting (Monday)" type="date" required value={values.week_starting}
              onChange={set('week_starting')} disabled={busy || editing} error={Boolean(errors.week_starting)}
              helperText={errors.week_starting || (values.week_starting ? formatWeek(values.week_starting) : ' ')}
              slotProps={{ inputLabel: { shrink: true } }} fullWidth
            />
            <FormControl fullWidth required error={Boolean(errors.category)} disabled={busy || editing}>
              <InputLabel id="spend-category-label">Category</InputLabel>
              <Select labelId="spend-category-label" id="spend-category" label="Category" value={values.category} onChange={set('category')}>
                {Object.entries(SPEND_CATEGORY_LABELS).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
              </Select>
              {errors.category && <FormHelperText>{errors.category}</FormHelperText>}
            </FormControl>
            <TextField
              id="spend-amount" label="Amount (USD)" type="number" required value={values.amount} onChange={set('amount')}
              disabled={busy} error={Boolean(errors.amount)} helperText={errors.amount} fullWidth
              slotProps={{ htmlInput: { min: 0, step: 100 } }}
            />
            <TextField
              id="spend-note" label="Note" value={values.note} onChange={set('note')} disabled={busy}
              error={Boolean(errors.note)} helperText={errors.note || 'Optional'} fullWidth multiline minRows={2}
              slotProps={{ htmlInput: { maxLength: 500 } }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

SpendDialog.propTypes = {
  projectId: PropTypes.string.isRequired,
  entry: PropTypes.object,
  onClose: PropTypes.func.isRequired,
  onSaved: PropTypes.func.isRequired,
}

/** One labelled total. */
function Total({ label, value }) {
  return (
    <Paper variant="outlined" sx={{ p: 1.5, flex: 1, minWidth: 160 }}>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      <Typography variant="h3" component="p" sx={NUM}>{formatUsd(value)}</Typography>
    </Paper>
  )
}

Total.propTypes = { label: PropTypes.string.isRequired, value: PropTypes.number }

/**
 * Budget tab: totals and weekly spend entries. Only the Portfolio Manager (permissions.can_record_spend)
 * can record or edit spend (CONFIRMED); everyone who can view the project sees the figures.
 */
export default function BudgetTab({ project, onChanged }) {
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'))
  const notify = useNotify()
  const canRecord = Boolean(project.permissions?.can_record_spend)
  const [dialog, setDialog] = useState(null) // null | {entry}
  const state = useApiQuery(() => listSpend(project.id), project.id)
  const items = [...(state.data?.items || [])].sort((a, b) => (a.week_starting < b.week_starting ? 1 : -1))
  const totals = state.data?.totals || {}

  const onSaved = (result, values) => {
    const label = SPEND_CATEGORY_LABELS[values.category] || values.category
    notify(result.created
      ? `Recorded spend for week of ${formatWeek(values.week_starting)}.`
      : `Updated the existing ${label} entry for week of ${formatWeek(values.week_starting)}.`)
    setDialog(null)
    state.reload()
    if (onChanged) onChanged()
  }

  let body
  if (state.loading && !state.data) body = <LoadingState rows={3} label="Loading spend" />
  else if (state.error) body = <ErrorState message={state.error.message} onRetry={state.reload} />
  else if (!items.length) body = <EmptyState title="No spend recorded yet" description={canRecord ? 'Record weekly spend to track budget against plan.' : undefined} />
  else if (isMobile) {
    body = (
      <Stack spacing={1.5}>
        {items.map((e) => (
          <Card key={e.id} variant="outlined">
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="baseline" spacing={1}>
                <Typography variant="subtitle2">{formatWeek(e.week_starting)}</Typography>
                <Typography sx={NUM}>{formatUsd(e.amount)}</Typography>
              </Stack>
              <Typography variant="body2">{SPEND_CATEGORY_LABELS[e.category] || e.category}</Typography>
              {e.note && <Typography variant="body2" color="text.secondary">{e.note}</Typography>}
              {canRecord && (
                <Button size="small" startIcon={<EditOutlinedIcon />} onClick={() => setDialog({ entry: e })} sx={{ mt: 1, minHeight: 44 }} aria-label={`Edit ${SPEND_CATEGORY_LABELS[e.category]} for week of ${formatWeek(e.week_starting)}`}>Edit</Button>
              )}
            </CardContent>
          </Card>
        ))}
      </Stack>
    )
  } else {
    body = (
      <TableContainer component={Paper} variant="outlined">
        <Table size="small" aria-label="Weekly spend">
          <TableHead>
            <TableRow>
              <TableCell>Week starting</TableCell>
              <TableCell>Category</TableCell>
              <TableCell align="right">Amount</TableCell>
              <TableCell>Note</TableCell>
              <TableCell>Last updated</TableCell>
              {canRecord && <TableCell>Actions</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((e) => (
              <TableRow key={e.id}>
                <TableCell sx={NUM}>{formatWeek(e.week_starting)}</TableCell>
                <TableCell>{SPEND_CATEGORY_LABELS[e.category] || e.category}</TableCell>
                <TableCell align="right" sx={NUM}>{formatUsd(e.amount)}</TableCell>
                <TableCell>{e.note || ''}</TableCell>
                <TableCell>{[e.updated_by?.display_name, formatDate(e.updated_at)].filter(Boolean).join(' · ')}</TableCell>
                {canRecord && (
                  <TableCell>
                    <Button size="small" startIcon={<EditOutlinedIcon />} onClick={() => setDialog({ entry: e })} aria-label={`Edit ${SPEND_CATEGORY_LABELS[e.category]} for week of ${formatWeek(e.week_starting)}`}>Edit</Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    )
  }

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
        <Total label="Approved budget" value={totals.approved_budget} />
        <Total label="Spend to date" value={totals.spend_to_date} />
        <Total label="Planned to date" value={totals.planned_to_date} />
      </Stack>
      <Typography variant="body2" color="text.secondary">
        Planned to date = approved budget × share of the planned duration elapsed.
      </Typography>
      {canRecord && (
        <div>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialog({ entry: null })} sx={{ minHeight: 44 }}>
            Record weekly spend
          </Button>
        </div>
      )}
      {body}
      {dialog && <SpendDialog projectId={project.id} entry={dialog.entry} onClose={() => setDialog(null)} onSaved={onSaved} />}
    </Stack>
  )
}

BudgetTab.propTypes = {
  project: PropTypes.shape({ id: PropTypes.string.isRequired, permissions: PropTypes.object }).isRequired,
  onChanged: PropTypes.func,
}
