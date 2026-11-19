import PropTypes from 'prop-types'
import { Chip } from '@mui/material'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlined'
import EventAvailableOutlinedIcon from '@mui/icons-material/EventAvailableOutlined'
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlined'
import { loadLabel } from '../utils/allocations'

const STYLE = {
  UNDER: { color: 'default', icon: <EventAvailableOutlinedIcon /> },
  OK: { color: 'success', icon: <CheckCircleOutlineIcon /> },
  OVER: { color: 'warning', icon: <WarningAmberOutlinedIcon /> },
  SEVERE: { color: 'error', icon: <ErrorOutlineIcon /> },
}

/** Load chip for a person's weekly allocation. */
export default function LoadChip({ status, totalHours, size = 'small' }) {
  const style = STYLE[status] || STYLE.UNDER
  return <Chip size={size} variant={status === 'UNDER' ? 'outlined' : 'filled'} color={style.color} icon={style.icon} label={loadLabel(status, totalHours)} />
}

LoadChip.propTypes = {
  status: PropTypes.oneOf(['UNDER', 'OK', 'OVER', 'SEVERE']).isRequired,
  totalHours: PropTypes.oneOfType([PropTypes.number, PropTypes.string]).isRequired,
  size: PropTypes.oneOf(['small', 'medium']),
}
