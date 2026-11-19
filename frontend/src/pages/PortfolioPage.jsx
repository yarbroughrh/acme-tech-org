import { useCallback, useEffect, useState } from 'react'
import PropTypes from 'prop-types'
import { Link as RouterLink, useSearchParams } from 'react-router-dom'
import {
  Box, Card, CardActionArea, CardContent, FormControl, InputAdornment, InputLabel, Link, MenuItem, Paper, Select,
  Stack, Table, TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow, TextField, Typography,
  useMediaQuery,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import SearchIcon from '@mui/icons-material/Search'
import { getLookups, listProjects } from '../api/projects'
import HealthBadge from '../components/HealthBadge'
import LifecycleChip from '../components/LifecycleChip'
import { EmptyState, ErrorState, LoadingState } from '../components/PageState'
import { LIFECYCLE_LABELS, PRIORITY_LABELS, formatDate, formatUsd } from '../utils/format'
import useDebouncedValue from '../utils/useDebouncedValue'
import useApiQuery from '../utils/useApiQuery'

export const PAGE_SIZE = 20
const FILTER_KEYS = ['department_id', 'lifecycle_status', 'priority', 'pm_user_id']
const SORT_OPTIONS = [
  { value: 'name', label: 'Name (A–Z)' },
  { value: '-name', label: 'Name (Z–A)' },
  { value: 'planned_end', label: 'End date (earliest)' },
  { value: '-planned_end', label: 'End date (latest)' },
  { value: '-approved_budget', label: 'Budget (highest)' },
  { value: 'approved_budget', label: 'Budget (lowest)' },
]

/** Labelled select used for each filter. */
function FilterSelect({ id, label, value, onChange, options }) {
  return (
    <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 170 } }}>
      <InputLabel id={`${id}-label`}>{label}</InputLabel>
      <Select labelId={`${id}-label`} id={id} label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        <MenuItem value=""><em>All</em></MenuItem>
        {options.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
      </Select>
    </FormControl>
  )
}

FilterSelect.propTypes = {
  id: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  options: PropTypes.arrayOf(PropTypes.shape({ value: PropTypes.string, label: PropTypes.string })).isRequired,
}

/** One project as a card (mobile). */
function ProjectCard({ project }) {
  return (
    <Card variant="outlined">
      <CardActionArea component={RouterLink} to={`/portfolio/${project.id}`}>
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
            <Typography variant="h3" component="h2">{project.name}</Typography>
            <HealthBadge health={project.health_overall} reasons={project.health_reasons || []} lifecycleStatus={project.lifecycle_status} size="small" />
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {project.department?.name} · PM {project.pm?.display_name}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ mt: 1 }} alignItems="center" flexWrap="wrap" useFlexGap>
            <LifecycleChip status={project.lifecycle_status} />
            <Typography variant="body2">Ends {formatDate(project.planned_end)}</Typography>
            <Typography variant="body2">{formatUsd(project.approved_budget)}</Typography>
          </Stack>
        </CardContent>
      </CardActionArea>
    </Card>
  )
}

ProjectCard.propTypes = { project: PropTypes.object.isRequired }

/**
 * Portfolio list: server-side search, filters, sorting and pagination.
 * All state lives in the URL so dashboards can link to a pre-filtered view.
 */
export default function PortfolioPage() {
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('md'))
  const [params, setParams] = useSearchParams()
  const [searchText, setSearchText] = useState(params.get('q') || '')
  const debouncedSearch = useDebouncedValue(searchText, 300)
  const [lookups, setLookups] = useState({ departments: [], project_managers: [] })

  const page = Math.max(1, Number(params.get('page')) || 1)
  const sort = params.get('sort') || 'name'
  const query = params.toString()

  /** Update URL params; any change other than paging returns to page 1. */
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
    getLookups().then(setLookups).catch(() => {})
  }, [])

  const state = useApiQuery(() => {
    const current = new URLSearchParams(query)
    const request = { page, page_size: PAGE_SIZE, sort }
    if (current.get('q')) request.q = current.get('q')
    FILTER_KEYS.forEach((key) => { if (current.get(key)) request[key] = current.get(key) })
    if (current.get('health')) request.health = current.get('health')
    return listProjects(request)
  }, `${query}|${page}|${sort}`)

  const items = state.data?.items || []
  const total = state.data?.total || 0

  let content
  if (state.loading && !state.data) content = <LoadingState label="Loading projects" />
  else if (state.error) content = <ErrorState message={state.error.message} onRetry={state.reload} />
  else if (!items.length) {
    content = (
      <EmptyState
        title="No projects match"
        description="Try a different search or clear the filters."
      />
    )
  } else if (isMobile) {
    content = <Stack spacing={1.5}>{items.map((p) => <ProjectCard key={p.id} project={p} />)}</Stack>
  } else {
    content = (
      <TableContainer>
        <Table size="small" aria-label="Projects">
          <TableHead>
            <TableRow>
              <TableCell>Project</TableCell>
              <TableCell>Department</TableCell>
              <TableCell>Project manager</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Priority</TableCell>
              <TableCell>Planned end</TableCell>
              <TableCell align="right">Budget</TableCell>
              <TableCell>Health</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((p) => (
              <TableRow key={p.id} hover>
                <TableCell><Link component={RouterLink} to={`/portfolio/${p.id}`}>{p.name}</Link></TableCell>
                <TableCell>{p.department?.name}</TableCell>
                <TableCell>{p.pm?.display_name}</TableCell>
                <TableCell><LifecycleChip status={p.lifecycle_status} /></TableCell>
                <TableCell>{PRIORITY_LABELS[p.priority] || p.priority}</TableCell>
                <TableCell>{formatDate(p.planned_end)}</TableCell>
                <TableCell align="right">{formatUsd(p.approved_budget)}</TableCell>
                <TableCell>
                  <HealthBadge health={p.health_overall} reasons={p.health_reasons || []} lifecycleStatus={p.lifecycle_status} size="small" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    )
  }

  return (
    <>
      <Typography variant="h1" component="h1" sx={{ mb: 2 }}>Portfolio</Typography>
      <Paper sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} flexWrap="wrap" useFlexGap>
          <TextField
            id="project-search"
            label="Search projects or PMs"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            sx={{ minWidth: { xs: '100%', sm: 260 } }}
            slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon aria-hidden="true" /></InputAdornment> } }}
          />
          <FilterSelect
            id="filter-department" label="Department" value={params.get('department_id') || ''}
            onChange={(v) => updateParams({ department_id: v })}
            options={lookups.departments.map((d) => ({ value: d.id, label: d.name }))}
          />
          <FilterSelect
            id="filter-status" label="Status" value={params.get('lifecycle_status') || ''}
            onChange={(v) => updateParams({ lifecycle_status: v })}
            options={Object.entries(LIFECYCLE_LABELS).map(([value, label]) => ({ value, label }))}
          />
          <FilterSelect
            id="filter-priority" label="Priority" value={params.get('priority') || ''}
            onChange={(v) => updateParams({ priority: v })}
            options={Object.entries(PRIORITY_LABELS).map(([value, label]) => ({ value, label }))}
          />
          <FilterSelect
            id="filter-pm" label="Project manager" value={params.get('pm_user_id') || ''}
            onChange={(v) => updateParams({ pm_user_id: v })}
            options={lookups.project_managers.map((m) => ({ value: m.id, label: m.display_name }))}
          />
          <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 190 } }}>
            <InputLabel id="sort-label">Sort by</InputLabel>
            <Select labelId="sort-label" id="sort" label="Sort by" value={sort} onChange={(e) => updateParams({ sort: e.target.value })}>
              {SORT_OPTIONS.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
            </Select>
          </FormControl>
        </Stack>
      </Paper>
      <Paper sx={{ p: { xs: 1.5, md: 0 } }} aria-busy={state.loading}>
        <Box sx={{ px: { md: 2 }, pt: { md: 1.5 } }}>
          <Typography variant="body2" color="text.secondary" aria-live="polite">
            {state.data ? `${total} project${total === 1 ? '' : 's'}` : ' '}
          </Typography>
        </Box>
        {content}
        {total > 0 && (
          <TablePagination
            component="div"
            count={total}
            page={page - 1}
            rowsPerPage={PAGE_SIZE}
            rowsPerPageOptions={[PAGE_SIZE]}
            onPageChange={(_e, newPage) => updateParams({ page: newPage + 1 })}
          />
        )}
      </Paper>
    </>
  )
}
