import { useCallback, useEffect, useState } from 'react'
import PropTypes from 'prop-types'
import { Link as RouterLink, useSearchParams } from 'react-router-dom'
import {
  Box, Card, CardContent, Chip, FormControl, InputAdornment, InputLabel, LinearProgress, Link, MenuItem, Paper, Select,
  Stack, Table, TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow, TextField, Typography,
  useMediaQuery,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import SearchIcon from '@mui/icons-material/Search'
import { listPeople } from '../api/people'
import { getLookups } from '../api/projects'
import LoadChip from '../components/LoadChip'
import { LOAD_FILTERS, PEOPLE_PAGE_SIZE, STANDARD_HOURS } from '../utils/allocations'
import { EmptyState, ErrorState, LoadingState } from '../components/PageState'
import useApiQuery from '../utils/useApiQuery'
import useDebouncedValue from '../utils/useDebouncedValue'

/** Hours against the 40 h standard, as text plus a thin bar (capped at 100%). */
function HoursBar({ person }) {
  const hours = Number(person.total_hours) || 0
  const color = { SEVERE: 'error', OVER: 'warning', OK: 'success' }[person.load_status] || 'primary'
  return (
    <Box sx={{ minWidth: 120 }}>
      <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>{hours} / {STANDARD_HOURS} h</Typography>
      <LinearProgress
        variant="determinate" value={Math.min(100, (hours / STANDARD_HOURS) * 100)} color={color}
        aria-label={`${person.full_name}: ${hours} of ${STANDARD_HOURS} hours per week`} sx={{ height: 4, borderRadius: 2, mt: 0.5 }}
      />
    </Box>
  )
}

HoursBar.propTypes = { person: PropTypes.object.isRequired }

/** A person's project allocations as links. */
function Allocations({ items }) {
  if (!items?.length) return <Typography variant="body2" color="text.secondary">No current allocations</Typography>
  return (
    <Stack spacing={0.25}>
      {items.map((a) => (
        <Typography key={a.project.id} variant="body2">
          <Link component={RouterLink} to={`/portfolio/${a.project.id}?tab=team`}>{a.project.name}</Link> · {a.hours_per_week} h
        </Typography>
      ))}
    </Stack>
  )
}

Allocations.propTypes = { items: PropTypes.array }

/** People: who is over-allocated or has capacity, by how much, and where their hours go. */
export default function PeoplePage() {
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'))
  const [params, setParams] = useSearchParams()
  const [searchText, setSearchText] = useState(params.get('q') || '')
  const debouncedSearch = useDebouncedValue(searchText, 300)
  const [departments, setDepartments] = useState([])
  const page = Math.max(1, Number(params.get('page')) || 1)
  const load = params.get('load') || ''
  const departmentId = params.get('department_id') || ''
  const query = params.toString()

  const updateParams = useCallback((changes) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      Object.entries(changes).forEach(([key, value]) => {
        if (value === '' || value === null || value === undefined) next.delete(key)
        else next.set(key, String(value))
      })
      if (!('page' in changes)) next.delete('page')
      return next
    }, { replace: true })
  }, [setParams])

  useEffect(() => {
    if ((params.get('q') || '') !== debouncedSearch) updateParams({ q: debouncedSearch })
  }, [debouncedSearch, params, updateParams])

  useEffect(() => {
    getLookups().then((l) => setDepartments(l.departments || [])).catch(() => {})
  }, [])

  const state = useApiQuery(() => {
    const current = new URLSearchParams(query)
    const request = { page, page_size: PEOPLE_PAGE_SIZE, sort: '-total_hours' }
    ;['q', 'load', 'department_id'].forEach((key) => { if (current.get(key)) request[key] = current.get(key) })
    return listPeople(request)
  }, `${query}|${page}`)
  const items = state.data?.items || []
  const total = state.data?.total || 0

  let content
  if (state.loading && !state.data) content = <LoadingState label="Loading people" />
  else if (state.error) content = <ErrorState message={state.error.message} onRetry={state.reload} />
  else if (!items.length) content = <EmptyState title="No people match" description="Try a different search or load filter." />
  else if (isMobile) {
    content = (
      <Stack spacing={1.5}>
        {items.map((p) => (
          <Card key={p.id} variant="outlined">
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
                <Box>
                  <Typography variant="subtitle1" component="h2">{p.full_name}</Typography>
                  <Typography variant="body2" color="text.secondary">{p.job_title} · {p.department?.name}</Typography>
                </Box>
                <LoadChip status={p.load_status} totalHours={p.total_hours} />
              </Stack>
              <Box sx={{ my: 1 }}><HoursBar person={p} /></Box>
              <Allocations items={p.allocations} />
            </CardContent>
          </Card>
        ))}
      </Stack>
    )
  } else {
    content = (
      <TableContainer>
        <Table size="small" aria-label="People">
          <TableHead>
            <TableRow>
              <TableCell>Person</TableCell>
              <TableCell>Department</TableCell>
              <TableCell>Hours per week</TableCell>
              <TableCell>Load</TableCell>
              <TableCell>Allocations</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((p) => (
              <TableRow key={p.id} hover>
                <TableCell>
                  <Typography variant="body2" fontWeight={600}>{p.full_name}</Typography>
                  <Typography variant="body2" color="text.secondary">{p.job_title}</Typography>
                </TableCell>
                <TableCell>{p.department?.name}</TableCell>
                <TableCell><HoursBar person={p} /></TableCell>
                <TableCell><LoadChip status={p.load_status} totalHours={p.total_hours} /></TableCell>
                <TableCell><Allocations items={p.allocations} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    )
  }

  return (
    <>
      <Typography variant="h1" component="h1" sx={{ mb: 2 }}>People</Typography>
      <Paper sx={{ p: 2, mb: 2 }}>
        <Stack spacing={1.5}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField
              id="people-search" label="Search people" value={searchText} onChange={(e) => setSearchText(e.target.value)}
              sx={{ minWidth: { xs: '100%', sm: 260 } }}
              slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon aria-hidden="true" /></InputAdornment> } }}
            />
            <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 200 } }}>
              <InputLabel id="people-department-label" shrink>Department</InputLabel>
              <Select labelId="people-department-label" id="people-department" label="Department" value={departmentId} displayEmpty notched
                onChange={(e) => updateParams({ department_id: e.target.value })}>
                <MenuItem value="">All</MenuItem>
                {departments.map((d) => <MenuItem key={d.id} value={d.id}>{d.name}</MenuItem>)}
              </Select>
            </FormControl>
          </Stack>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap role="group" aria-label="Load filter">
            {LOAD_FILTERS.map((f) => (
              <Chip
                key={f.value || 'all'} label={f.label} clickable aria-pressed={load === f.value}
                color={load === f.value ? 'primary' : 'default'} variant={load === f.value ? 'filled' : 'outlined'}
                onClick={() => updateParams({ load: f.value })}
              />
            ))}
          </Stack>
        </Stack>
      </Paper>
      <Paper sx={{ p: { xs: 1.5, md: 0 } }} aria-busy={state.loading}>
        {content}
        {total > 0 && (
          <TablePagination
            component="div" count={total} page={page - 1} rowsPerPage={PEOPLE_PAGE_SIZE} rowsPerPageOptions={[PEOPLE_PAGE_SIZE]}
            onPageChange={(_e, p) => updateParams({ page: p + 1 })}
          />
        )}
      </Paper>
    </>
  )
}
