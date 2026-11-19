import PropTypes from 'prop-types'
import { Chip } from '@mui/material'
import { LIFECYCLE_LABELS } from '../utils/format'

const VARIANTS = {
  ACTIVE: { color: 'primary', variant: 'outlined' },
  PROPOSED: { color: 'default', variant: 'outlined' },
  ON_HOLD: { color: 'warning', variant: 'outlined' },
  CLOSED: { color: 'default', variant: 'filled' },
  CANCELLED: { color: 'default', variant: 'filled' },
}

/** Lifecycle status chip (text label always present). */
export default function LifecycleChip({ status }) {
  const v = VARIANTS[status] || VARIANTS.PROPOSED
  return <Chip size="small" label={LIFECYCLE_LABELS[status] || status} color={v.color} variant={v.variant} />
}

LifecycleChip.propTypes = { status: PropTypes.string.isRequired }
