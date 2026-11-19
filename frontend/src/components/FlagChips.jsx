import PropTypes from 'prop-types'
import { Chip, Stack } from '@mui/material'
import CompareArrowsIcon from '@mui/icons-material/CompareArrows'
import ScheduleIcon from '@mui/icons-material/Schedule'
import { FLAG_LABELS } from '../utils/format'

const FLAG_ICONS = { STATUS_MISMATCH: CompareArrowsIcon, UPDATE_OVERDUE: ScheduleIcon }

/** Project attention flags ("Status mismatch", "Update overdue") as labelled chips with icons. */
export default function FlagChips({ flags = [], size = 'small' }) {
  if (!flags.length) return null
  return (
    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
      {flags.map((flag) => {
        const Icon = FLAG_ICONS[flag]
        return (
          <Chip
            key={flag}
            size={size}
            color="warning"
            variant="outlined"
            icon={Icon ? <Icon aria-hidden="true" /> : undefined}
            label={FLAG_LABELS[flag] || flag}
          />
        )
      })}
    </Stack>
  )
}

FlagChips.propTypes = {
  flags: PropTypes.arrayOf(PropTypes.string),
  size: PropTypes.oneOf(['small', 'medium']),
}
