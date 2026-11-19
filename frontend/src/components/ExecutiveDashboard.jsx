import { useEffect, useState } from 'react'
import PropTypes from 'prop-types'
import { useNavigate } from 'react-router-dom'
import {
  Box, ButtonBase, FormControl, InputLabel, MenuItem, Paper, Select, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Typography,
} from '@mui/material'
import { visuallyHidden } from '@mui/utils'
import ErrorOutlinedIcon from '@mui/icons-material/ErrorOutlined'
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined'
import CheckCircleOutlinedIcon from '@mui/icons-material/CheckCircleOutlined'
import { getPortfolioSummary } from '../api/portfolio'
import { getLookups } from '../api/projects'
import { HEALTH_COLORS } from '../theme'
import { formatUsd } from '../utils/format'
import useApiQuery from '../utils/useApiQuery'
import { ErrorState, LoadingState } from './PageState'

const SEGMENTS = [
  { key: 'red', health: 'RED', label: 'Red', color: HEALTH_COLORS.RED, Icon: ErrorOutlinedIcon },
  { key: 'amber', health: 'AMBER', label: 'Amber', color: HEALTH_COLORS.AMBER, Icon: WarningAmberOutlinedIcon },
  { key: 'green', health: 'GREEN', label: 'Green', color: HEALTH_COLORS.GREEN, Icon: CheckCircleOutlinedIcon },
]

/**
 * Variance presentation: positive = over plan. Amber above 10 %, Red above 20 % (budget health thresholds).
 * @param {number|null} pct
 * @returns {{text: string, tone: 'red'|'amber'|null}}
 */
// eslint-disable-next-line react-refresh/only-export-components
export function varianceView(pct) {
  if (pct === null || pct === undefined) return { text: '—', tone: null }
  const rounded = Math.round(pct * 10) / 10
  const text = `${rounded > 0 ? '+' : ''}${rounded.toFixed(1)}%`
  if (pct > 20) return { text, tone: 'red' }
  if (pct > 10) return { text, tone: 'amber' }
  return { text, tone: null }
}

/** Variance cell with icon + text for over-plan tones (never colour alone). */
function Variance({ pct }) {
  const { text, tone } = varianceView(pct)
  if (!tone) return <span>{text}</span>
  const Icon = tone === 'red' ? ErrorOutlinedIcon : WarningAmberOutlinedIcon
  const color = tone === 'red' ? HEALTH_COLORS.RED : HEALTH_COLORS.AMBER
  return (
    <Stack direction="row" spacing={0.5} alignItems="center" justifyContent="flex-end" sx={{ color, fontWeight: 600 }}>
      <Icon fontSize="small" aria-hidden="true" />
      <span>{text}</span>
      <Box component="span" sx={visuallyHidden}>{tone === 'red' ? '(more than 20% over plan)' : '(more than 10% over plan)'}</Box>
    </Stack>
  )
}

Variance.propTypes = { pct: PropTypes.number }

/** One department row: stacked bar segments, each labelled with its count and clickable. */
function DepartmentBar({ row, onSelect }) {
  const total = row.red + row.amber + row.green
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '180px 1fr' }, gap: 1, alignItems: 'center' }}>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>{row.department.name}</Typography>
      {total === 0 ? (
        <Typography variant="body2" color="text.secondary">No Active projects</Typography>
      ) : (
        <Box sx={{ display: 'flex', height: 32, borderRadius: 1, overflow: 'hidden' }}>
          {SEGMENTS.filter((s) => row[s.key] > 0).map((s) => (
            <ButtonBase
              key={s.key}
              onClick={() => onSelect(s.health, row.department.id)}
              aria-label={`${row.department.name}: ${row[s.key]} ${s.label} — show projects`}
              sx={{
                flexGrow: row[s.key], flexBasis: 0, minWidth: 36, bgcolor: s.color, color: '#fff',
                fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                '&:focus-visible': { outline: '3px solid #1F3A5F', outlineOffset: -3 },
              }}
            >
              {row[s.key]}
            </ButtonBase>
          ))}
        </Box>
      )}
    </Box>
  )
}

DepartmentBar.propTypes = { row: PropTypes.object.isRequired, onSelect: PropTypes.func.isRequired }

/** Clickable people-allocation tile. */
function LoadTile({ label, count, color, Icon, onClick }) {
  return (
    <Paper
      component={ButtonBase}
      onClick={onClick}
      variant="outlined"
      aria-label={`${label}: ${count} people — show them`}
      sx={{ p: 2, flex: 1, minWidth: 160, justifyContent: 'flex-start', borderLeft: 4, borderLeftColor: color }}
    >
      <Stack direction="row" spacing={1.5} alignItems="center">
        {Icon && <Icon sx={{ color }} aria-hidden="true" />}
        <Box sx={{ textAlign: 'left' }}>
          <Typography sx={{ fontSize: '1.75rem', fontWeight: 700, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{count}</Typography>
          <Typography variant="body2" color="text.secondary">{label}</Typography>
        </Box>
      </Stack>
    </Paper>
  )
}

LoadTile.propTypes = {
  label: PropTypes.string.isRequired, count: PropTypes.number.isRequired, color: PropTypes.string.isRequired,
  Icon: PropTypes.elementType, onClick: PropTypes.func.isRequired,
}

/**
 * Minimum executive dashboard (the brief requires it): Active projects by health per department,
 * people allocation bands, and budget against plan per department. Every visual has a text
 * equivalent and drills through to the filtered list.
 */
export default function ExecutiveDashboard({ heading = 'Portfolio dashboard' }) {
  const navigate = useNavigate()
  const [departmentId, setDepartmentId] = useState('')
  const [departments, setDepartments] = useState([])
  useEffect(() => { getLookups().then((l) => setDepartments(l.departments || [])).catch(() => {}) }, [])
  const state = useApiQuery(() => getPortfolioSummary(departmentId ? { department_id: departmentId } : {}), departmentId)
  const data = state.data

  const goPortfolio = (health, deptId) => {
    const params = new URLSearchParams({ health, lifecycle_status: 'ACTIVE' })
    if (deptId) params.set('department_id', deptId)
    navigate(`/portfolio?${params.toString()}`)
  }

  let content
  if (state.loading && !data) content = <LoadingState label="Loading the dashboard" rows={4} />
  else if (state.error) content = <ErrorState message={state.error.message} onRetry={state.reload} />
  else if (data) {
    const rows = data.health_by_department || []
    content = (
      <Stack spacing={3}>
        <Paper variant="outlined" sx={{ p: 2 }} component="section" aria-labelledby="dash-health">
          <Typography id="dash-health" variant="h3" component="h3" sx={{ mb: 1 }}>Active projects by health per department</Typography>
          <Stack direction="row" spacing={2} sx={{ mb: 1.5 }} flexWrap="wrap" useFlexGap aria-label="Legend">
            {SEGMENTS.map((s) => (
              <Stack key={s.key} direction="row" spacing={0.5} alignItems="center">
                <s.Icon fontSize="small" sx={{ color: s.color }} aria-hidden="true" />
                <Typography variant="body2">{`${s.label} ${data.health_counts?.[s.health] ?? 0}`}</Typography>
              </Stack>
            ))}
          </Stack>
          <Stack spacing={1}>
            {rows.map((row) => <DepartmentBar key={row.department.id} row={row} onSelect={goPortfolio} />)}
          </Stack>
          <Table size="small" sx={visuallyHidden} aria-label="Active projects by health per department (table)">
            <TableHead><TableRow><TableCell>Department</TableCell><TableCell>Red</TableCell><TableCell>Amber</TableCell><TableCell>Green</TableCell></TableRow></TableHead>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.department.id}><TableCell>{r.department.name}</TableCell><TableCell>{r.red}</TableCell><TableCell>{r.amber}</TableCell><TableCell>{r.green}</TableCell></TableRow>
              ))}
            </TableBody>
          </Table>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
            {`Health applies to Active projects only; ${data.excluded_projects ?? 0} Proposed, On hold, Closed or Cancelled projects are not counted.`}
          </Typography>
        </Paper>

        <Box component="section" aria-labelledby="dash-people">
          <Typography id="dash-people" variant="h3" component="h3" sx={{ mb: 1 }}>People allocation</Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <LoadTile label="Over 60 h a week" count={data.people?.severe ?? 0} color={HEALTH_COLORS.RED} Icon={ErrorOutlinedIcon} onClick={() => navigate('/people?load=SEVERE')} />
            <LoadTile label="Over 40 h a week" count={data.people?.over ?? 0} color={HEALTH_COLORS.AMBER} Icon={WarningAmberOutlinedIcon} onClick={() => navigate('/people?load=OVER')} />
            <LoadTile label="At or under 40 h a week" count={data.people?.at_or_under ?? 0} color="#5F6B7A" onClick={() => navigate('/people?load=UNDER')} />
          </Stack>
        </Box>

        <Paper variant="outlined" component="section" aria-labelledby="dash-budget">
          <Typography id="dash-budget" variant="h3" component="h3" sx={{ p: 2, pb: 1 }}>Budget against plan by department</Typography>
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table size="small" aria-labelledby="dash-budget" sx={{ '& td, & th': { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' } }}>
              <TableHead>
                <TableRow>
                  <TableCell>Department</TableCell>
                  <TableCell align="right">Approved</TableCell>
                  <TableCell align="right">Planned to date</TableCell>
                  <TableCell align="right">Actual to date</TableCell>
                  <TableCell align="right">Variance %</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(data.budget_by_department || []).map((r) => (
                  <TableRow key={r.department.id}>
                    <TableCell>{r.department.name}</TableCell>
                    <TableCell align="right">{formatUsd(r.approved)}</TableCell>
                    <TableCell align="right">{formatUsd(r.planned_to_date)}</TableCell>
                    <TableCell align="right">{formatUsd(r.actual_to_date)}</TableCell>
                    <TableCell align="right"><Variance pct={r.variance_pct} /></TableCell>
                  </TableRow>
                ))}
                {data.totals && (
                  <TableRow sx={{ '& td': { fontWeight: 700 } }}>
                    <TableCell>Total</TableCell>
                    <TableCell align="right">{formatUsd(data.totals.approved)}</TableCell>
                    <TableCell align="right">{formatUsd(data.totals.planned_to_date)}</TableCell>
                    <TableCell align="right">{formatUsd(data.totals.actual_to_date)}</TableCell>
                    <TableCell align="right"><Variance pct={data.totals.variance_pct} /></TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
          <Typography variant="body2" color="text.secondary" sx={{ p: 2, pt: 1 }}>
            Positive variance means spend is ahead of plan. Active projects only.
          </Typography>
        </Paper>
      </Stack>
    )
  }

  return (
    <Box component="section" aria-labelledby="dashboard-heading">
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={1} sx={{ mb: 2 }}>
        <Typography id="dashboard-heading" variant="h2" component="h2">{heading}</Typography>
        <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 220 } }}>
          <InputLabel id="dash-dept-label" shrink>Department</InputLabel>
          <Select
            labelId="dash-dept-label" id="dash-dept" label="Department" value={departmentId} displayEmpty notched
            onChange={(e) => setDepartmentId(e.target.value)}
          >
            <MenuItem value="">All</MenuItem>
            {departments.map((d) => <MenuItem key={d.id} value={d.id}>{d.name}</MenuItem>)}
          </Select>
        </FormControl>
      </Stack>
      {content}
    </Box>
  )
}

ExecutiveDashboard.propTypes = { heading: PropTypes.string }
