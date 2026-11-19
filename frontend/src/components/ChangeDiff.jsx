import PropTypes from 'prop-types'
import { Box, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'
import { FIELD_LABELS, formatFieldValue } from '../utils/format'

/**
 * Field-by-field comparison: field | current | proposed. Used by approvals, proposals and the
 * audit log. `compact` renders a stacked list (mobile cards) instead of a table.
 */
export default function ChangeDiff({ changes, current = {}, entityType, compact = false, currentLabel = 'Current', proposedLabel = 'Proposed' }) {
  const fields = Object.keys(changes || {})
  if (!fields.length) return null
  if (compact) {
    return (
      <Box component="dl" sx={{ m: 0 }}>
        {fields.map((f) => (
          <Box key={f} sx={{ mb: 1 }}>
            <Typography component="dt" variant="body2" color="text.secondary">{FIELD_LABELS[f] || f}</Typography>
            <Typography component="dd" sx={{ m: 0 }}>
              <Box component="span" sx={{ textDecoration: 'line-through', color: 'text.secondary' }}>
                {formatFieldValue(f, current?.[f], entityType)}
              </Box>
              {' → '}
              <Box component="strong">{formatFieldValue(f, changes[f], entityType)}</Box>
            </Typography>
          </Box>
        ))}
      </Box>
    )
  }
  return (
    <Table size="small" aria-label="Proposed changes">
      <TableHead>
        <TableRow>
          <TableCell>Field</TableCell>
          <TableCell>{currentLabel}</TableCell>
          <TableCell>{proposedLabel}</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {fields.map((f) => (
          <TableRow key={f}>
            <TableCell>{FIELD_LABELS[f] || f}</TableCell>
            <TableCell>{formatFieldValue(f, current?.[f], entityType)}</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>{formatFieldValue(f, changes[f], entityType)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

ChangeDiff.propTypes = {
  changes: PropTypes.object.isRequired,
  current: PropTypes.object,
  entityType: PropTypes.string,
  compact: PropTypes.bool,
  currentLabel: PropTypes.string,
  proposedLabel: PropTypes.string,
}
