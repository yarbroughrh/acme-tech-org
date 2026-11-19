import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import PropTypes from 'prop-types'
import {
  Alert, Box, Button, Card, CardActions, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControl, FormControlLabel, InputAdornment, InputLabel, MenuItem, Paper, Select, Stack, Switch, Table, TableBody,
  TableCell, TableContainer, TableHead, TablePagination, TableRow, TextField, Typography, useMediaQuery,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import AddIcon from '@mui/icons-material/Add'
import SearchIcon from '@mui/icons-material/Search'
import { createUser, listUsers, resetPassword, unlockUser, updateUser } from '../api/users'
import { ROLE_LABELS } from '../auth/roles'
import ConfirmDialog from '../components/ConfirmDialog'
import { useNotify } from '../components/NotifyProvider'
import { EmptyState, ErrorState, LoadingState } from '../components/PageState'
import { formatDateTime, isEmail } from '../utils/format'
import useDebouncedValue from '../utils/useDebouncedValue'
import useApiQuery from '../utils/useApiQuery'

const PAGE_SIZE = 20
const ROLE_OPTIONS = Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }))
const CONFLICT_MESSAGE = 'This user was changed by someone else. Reload and try again.'

/** Status chips for a user (text labels, not colour alone). */
function UserStatus({ user }) {
  return (
    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
      <Chip size="small" label={user.is_active ? 'Active' : 'Inactive'} color={user.is_active ? 'success' : 'default'} variant="outlined" />
      {user.is_locked && <Chip size="small" label="Locked" color="error" variant="outlined" />}
      {user.must_change_password && <Chip size="small" label="Must change password" variant="outlined" />}
    </Stack>
  )
}

UserStatus.propTypes = { user: PropTypes.object.isRequired }

/** Role select used in create/edit dialogs. */
function RoleSelect({ value, onChange, disabled, error }) {
  return (
    <FormControl fullWidth size="small" required error={Boolean(error)}>
      <InputLabel id="user-role-label">Role</InputLabel>
      <Select labelId="user-role-label" id="user-role" label="Role" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        {ROLE_OPTIONS.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
      </Select>
      {error && <Typography variant="caption" color="error" sx={{ mx: 1.75, mt: 0.5 }}>{error}</Typography>}
    </FormControl>
  )
}

RoleSelect.propTypes = { value: PropTypes.string.isRequired, onChange: PropTypes.func.isRequired, disabled: PropTypes.bool, error: PropTypes.string }

/** Shows a temporary password exactly once. */
function TempPasswordDialog({ info, onClose }) {
  return (
    <Dialog open={Boolean(info)} onClose={onClose} aria-labelledby="temp-pw-title">
      <DialogTitle id="temp-pw-title">Temporary password</DialogTitle>
      <DialogContent>
        <Typography gutterBottom>
          Give this temporary password to {info?.name} through a secure channel. It is shown only once, and they must change it at their next sign-in.
        </Typography>
        <TextField
          fullWidth
          value={info?.password || ''}
          label="Temporary password"
          slotProps={{ htmlInput: { readOnly: true, 'aria-readonly': true, style: { fontFamily: 'monospace' } } }}
          helperText="Select the text and copy it now."
          onFocus={(e) => e.target.select()}
        />
      </DialogContent>
      <DialogActions><Button variant="contained" onClick={onClose}>Done</Button></DialogActions>
    </Dialog>
  )
}

TempPasswordDialog.propTypes = { info: PropTypes.shape({ name: PropTypes.string, password: PropTypes.string }), onClose: PropTypes.func.isRequired }

/** Create-user dialog with inline validation. */
function CreateUserDialog({ open, onClose, onCreated }) {
  const [values, setValues] = useState({ display_name: '', email: '', role: 'ANALYST' })
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [serverError, setServerError] = useState('')
  const errors = {}
  if (!values.display_name.trim()) errors.display_name = 'Enter a name.'
  if (!values.email.trim()) errors.email = 'Enter an email address.'
  else if (!isEmail(values.email)) errors.email = 'Enter a valid email address.'

  const reset = () => { setValues({ display_name: '', email: '', role: 'ANALYST' }); setSubmitted(false); setServerError('') }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setSubmitted(true)
    if (Object.keys(errors).length) return
    setSaving(true)
    setServerError('')
    try {
      const result = await createUser({ ...values, email: values.email.trim(), display_name: values.display_name.trim() })
      reset()
      onCreated(result)
    } catch (err) {
      const detail = err.details?.map((d) => d.message).join(' ')
      setServerError(detail ? `${err.message} ${detail}` : err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onClose={saving ? undefined : () => { reset(); onClose() }} fullWidth maxWidth="sm" aria-labelledby="create-user-title">
      <Box component="form" noValidate onSubmit={handleSubmit}>
        <DialogTitle id="create-user-title">Create user</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {serverError && <Alert severity="error" role="alert">{serverError}</Alert>}
            <TextField
              id="new-user-name" label="Full name" required value={values.display_name} disabled={saving}
              onChange={(e) => setValues((v) => ({ ...v, display_name: e.target.value }))}
              error={submitted && Boolean(errors.display_name)} helperText={submitted ? errors.display_name : undefined}
            />
            <TextField
              id="new-user-email" label="Email" type="email" required value={values.email} disabled={saving}
              onChange={(e) => setValues((v) => ({ ...v, email: e.target.value }))}
              error={submitted && Boolean(errors.email)} helperText={submitted ? errors.email : undefined}
            />
            <RoleSelect value={values.role} onChange={(role) => setValues((v) => ({ ...v, role }))} disabled={saving} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { reset(); onClose() }} disabled={saving}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={saving}>{saving ? 'Creating…' : 'Create user'}</Button>
        </DialogActions>
      </Box>
    </Dialog>
  )
}

CreateUserDialog.propTypes = { open: PropTypes.bool.isRequired, onClose: PropTypes.func.isRequired, onCreated: PropTypes.func.isRequired }

/** Edit role / active flag, with optimistic-concurrency handling. */
function EditUserDialog({ user, onClose, onSaved, onConflict }) {
  const [values, setValues] = useState(() => ({ role: user?.role || 'ANALYST', is_active: user?.is_active ?? true }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSave = async () => {
    setSaving(true)
    setError('')
    try {
      const result = await updateUser(user.id, { ...values, version: user.version })
      onSaved(result.user)
    } catch (err) {
      if (err.status === 409) onConflict()
      else setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={Boolean(user)} onClose={saving ? undefined : onClose} fullWidth maxWidth="xs" aria-labelledby="edit-user-title">
      <DialogTitle id="edit-user-title">Edit {user?.display_name}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error" role="alert">{error}</Alert>}
          <RoleSelect value={values.role} onChange={(role) => setValues((v) => ({ ...v, role }))} disabled={saving} />
          <FormControlLabel
            control={<Switch checked={values.is_active} onChange={(e) => setValues((v) => ({ ...v, is_active: e.target.checked }))} disabled={saving} />}
            label={values.is_active ? 'Account active' : 'Account inactive'}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
      </DialogActions>
    </Dialog>
  )
}

EditUserDialog.propTypes = { user: PropTypes.object, onClose: PropTypes.func.isRequired, onSaved: PropTypes.func.isRequired, onConflict: PropTypes.func.isRequired }

/** Row/card action buttons for one user. */
function UserActions({ user, onEdit, onReset, onUnlock }) {
  return (
    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
      <Button size="small" onClick={() => onEdit(user)} aria-label={`Edit ${user.display_name}`}>Edit</Button>
      <Button size="small" onClick={() => onReset(user)} aria-label={`Reset password for ${user.display_name}`}>Reset password</Button>
      {user.is_locked && <Button size="small" onClick={() => onUnlock(user)} aria-label={`Unlock ${user.display_name}`}>Unlock</Button>}
    </Stack>
  )
}

UserActions.propTypes = { user: PropTypes.object.isRequired, onEdit: PropTypes.func.isRequired, onReset: PropTypes.func.isRequired, onUnlock: PropTypes.func.isRequired }

/** Admin user management: list, create, edit role/active, reset password, unlock. */
export default function UsersPage() {
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'))
  const notify = useNotify()
  const [params] = useSearchParams()
  const [search, setSearch] = useState(params.get('q') || '')
  const q = useDebouncedValue(search, 300)
  const [role, setRole] = useState('')
  const [page, setPage] = useState(0)
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [resetting, setResetting] = useState(null)
  const [busy, setBusy] = useState(false)
  const [tempPassword, setTempPassword] = useState(null)
  const [conflict, setConflict] = useState(false)

  const state = useApiQuery(() => listUsers({ q, role, page: page + 1, page_size: PAGE_SIZE }), `${q}|${role}|${page}`)
  const { reload } = state

  const handleReset = async () => {
    setBusy(true)
    try {
      const result = await resetPassword(resetting.id)
      setTempPassword({ name: resetting.display_name, password: result.temporary_password })
      notify(`Password reset for ${resetting.display_name}.`)
      setResetting(null)
      reload()
    } catch (err) {
      notify(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const handleUnlock = async (user) => {
    try {
      await unlockUser(user.id)
      notify(`${user.display_name} unlocked.`)
      reload()
    } catch (err) {
      notify(err.message, 'error')
    }
  }

  const items = state.data?.items || []
  const total = state.data?.total || 0
  const actionProps = { onEdit: setEditing, onReset: setResetting, onUnlock: handleUnlock }

  let content
  if (state.loading && !state.data) content = <LoadingState label="Loading users" />
  else if (state.error) content = <ErrorState message={state.error.message} onRetry={reload} />
  else if (!items.length) content = <EmptyState title="No users match" description="Try a different search or role." />
  else if (isMobile) {
    content = (
      <Stack spacing={1.5}>
        {items.map((u) => (
          <Card key={u.id} variant="outlined">
            <CardContent sx={{ pb: 1 }}>
              <Typography variant="h3" component="h2">{u.display_name}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ wordBreak: 'break-all' }}>{u.email}</Typography>
              <Typography variant="body2" sx={{ my: 0.5 }}>{ROLE_LABELS[u.role] || u.role}</Typography>
              <UserStatus user={u} />
            </CardContent>
            <CardActions><UserActions user={u} {...actionProps} /></CardActions>
          </Card>
        ))}
      </Stack>
    )
  } else {
    content = (
      <TableContainer>
        <Table size="small" aria-label="Users">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Email</TableCell>
              <TableCell>Role</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Last sign-in</TableCell>
              <TableCell>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((u) => (
              <TableRow key={u.id} hover>
                <TableCell>{u.display_name}</TableCell>
                <TableCell>{u.email}</TableCell>
                <TableCell>{ROLE_LABELS[u.role] || u.role}</TableCell>
                <TableCell><UserStatus user={u} /></TableCell>
                <TableCell>{formatDateTime(u.last_login_at)}</TableCell>
                <TableCell><UserActions user={u} {...actionProps} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    )
  }

  return (
    <>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }} spacing={1}>
        <Typography variant="h1" component="h1">Users</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}>Create user</Button>
      </Stack>
      {conflict && (
        <Alert severity="warning" sx={{ mb: 2 }} action={<Button color="inherit" size="small" onClick={() => { setConflict(false); reload() }}>Reload</Button>}>
          {CONFLICT_MESSAGE}
        </Alert>
      )}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
          <TextField
            id="user-search" label="Search name or email" value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0) }}
            sx={{ minWidth: { sm: 280 } }}
            slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon aria-hidden="true" /></InputAdornment> } }}
          />
          <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 200 } }}>
            <InputLabel id="role-filter-label">Role</InputLabel>
            <Select labelId="role-filter-label" id="role-filter" label="Role" value={role} onChange={(e) => { setRole(e.target.value); setPage(0) }}>
              <MenuItem value=""><em>All roles</em></MenuItem>
              {ROLE_OPTIONS.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
            </Select>
          </FormControl>
        </Stack>
      </Paper>
      <Paper sx={{ p: { xs: 1.5, sm: 0 } }} aria-busy={state.loading}>
        {content}
        {total > 0 && (
          <TablePagination
            component="div" count={total} page={page} rowsPerPage={PAGE_SIZE} rowsPerPageOptions={[PAGE_SIZE]}
            onPageChange={(_e, p) => setPage(p)}
          />
        )}
      </Paper>
      <CreateUserDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(result) => {
          setCreateOpen(false)
          notify(`${result.user.display_name} created.`)
          setTempPassword({ name: result.user.display_name, password: result.temporary_password })
          reload()
        }}
      />
      {editing && (
        <EditUserDialog
          key={editing.id}
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={(u) => { setEditing(null); notify(`${u.display_name} updated.`); reload() }}
          onConflict={() => { setEditing(null); setConflict(true) }}
        />
      )}
      <ConfirmDialog
        open={Boolean(resetting)}
        title="Reset password?"
        message={`${resetting?.display_name || ''} will get a temporary password, be signed out everywhere, and must choose a new password at next sign-in.`}
        confirmLabel="Reset password"
        busy={busy}
        onConfirm={handleReset}
        onCancel={() => setResetting(null)}
      />
      <TempPasswordDialog info={tempPassword} onClose={() => setTempPassword(null)} />
    </>
  )
}
