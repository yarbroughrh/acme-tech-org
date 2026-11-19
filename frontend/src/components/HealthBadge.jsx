import PropTypes from 'prop-types'
import { Box, Tooltip, Typography } from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import ErrorIcon from '@mui/icons-material/Error'
import RemoveCircleOutlinedIcon from '@mui/icons-material/RemoveCircleOutlined'
import HelpOutlinedIcon from '@mui/icons-material/HelpOutlined'
import { HEALTH_COLORS } from '../theme'
import { HEALTH_LABELS, LIFECYCLE_LABELS } from '../utils/format'

const HEALTH_ICONS = { GREEN: CheckCircleIcon, AMBER: WarningAmberIcon, RED: ErrorIcon }

/**
 * Describe what the badge should show.
 * @returns {{label: string, color: string, Icon: object, kind: string}}
 */
function describe(health, lifecycleStatus) {
  if (lifecycleStatus && lifecycleStatus !== 'ACTIVE') {
    return { label: LIFECYCLE_LABELS[lifecycleStatus] || lifecycleStatus, color: HEALTH_COLORS.NEUTRAL, Icon: RemoveCircleOutlinedIcon, kind: 'lifecycle' }
  }
  if (!health || !HEALTH_ICONS[health]) {
    return { label: 'Not calculated', color: HEALTH_COLORS.NEUTRAL, Icon: HelpOutlinedIcon, kind: 'none' }
  }
  return { label: HEALTH_LABELS[health], color: HEALTH_COLORS[health], Icon: HEALTH_ICONS[health], kind: 'health' }
}

/**
 * Project health badge: colour + icon + text (never colour alone).
 * Reasons appear in a tooltip on hover, focus or tap, and in the accessible label.
 */
export default function HealthBadge({ health = null, reasons = [], lifecycleStatus = 'ACTIVE', size = 'medium' }) {
  const { label, color, Icon, kind } = describe(health, lifecycleStatus)
  const hasReasons = kind === 'health' && reasons.length > 0
  const ariaLabel = kind === 'lifecycle'
    ? `Health not calculated: project is ${label}`
    : `Health: ${label}${hasReasons ? `. ${reasons.join('. ')}` : ''}`

  const badge = (
    <Box
      component="span"
      tabIndex={0}
      role="img"
      aria-label={ariaLabel}
      data-health={kind === 'health' ? health : kind}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        px: 1,
        py: size === 'small' ? 0.125 : 0.25,
        borderRadius: 999,
        border: `1px solid ${color}`,
        color,
        bgcolor: kind === 'health' ? `${color}14` : 'transparent',
        whiteSpace: 'nowrap',
        cursor: hasReasons ? 'help' : 'default',
        '&:focus-visible': { outline: `2px solid ${color}`, outlineOffset: 2 },
      }}
    >
      <Icon fontSize="small" aria-hidden="true" data-testid={`health-icon-${kind === 'health' ? health : kind}`} />
      <Typography component="span" variant="body2" sx={{ fontWeight: 600 }}>{label}</Typography>
    </Box>
  )

  if (!hasReasons) return badge
  return (
    <Tooltip
      enterTouchDelay={0}
      leaveTouchDelay={6000}
      title={(
        <Box component="ul" sx={{ m: 0, pl: 2 }}>
          {reasons.map((reason) => <li key={reason}>{reason}</li>)}
        </Box>
      )}
    >
      {badge}
    </Tooltip>
  )
}

HealthBadge.propTypes = {
  health: PropTypes.oneOf(['GREEN', 'AMBER', 'RED', null]),
  reasons: PropTypes.arrayOf(PropTypes.string),
  lifecycleStatus: PropTypes.string,
  size: PropTypes.oneOf(['small', 'medium']),
}
