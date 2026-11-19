import PropTypes from 'prop-types'
import { Alert, Box, Button, Skeleton, Stack, Typography } from '@mui/material'
import InboxOutlinedIcon from '@mui/icons-material/InboxOutlined'

/** Loading placeholder: a few skeleton rows. */
export function LoadingState({ rows = 5, label = 'Loading' }) {
  return (
    <Stack spacing={1} role="status" aria-live="polite" aria-label={label}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} variant="rounded" height={40} />
      ))}
    </Stack>
  )
}

LoadingState.propTypes = { rows: PropTypes.number, label: PropTypes.string }

/** Friendly empty state with an optional action. */
export function EmptyState({ title, description, action }) {
  return (
    <Box sx={{ textAlign: 'center', py: 6, px: 2, color: 'text.secondary' }}>
      <InboxOutlinedIcon sx={{ fontSize: 48, mb: 1 }} aria-hidden="true" />
      <Typography variant="h3" component="p" color="text.primary">{title}</Typography>
      {description && <Typography sx={{ mt: 1 }}>{description}</Typography>}
      {action && <Box sx={{ mt: 2 }}>{action}</Box>}
    </Box>
  )
}

EmptyState.propTypes = { title: PropTypes.string.isRequired, description: PropTypes.string, action: PropTypes.node }

/** Error banner with a retry button. */
export function ErrorState({ message, onRetry }) {
  return (
    <Alert
      severity="error"
      action={onRetry ? <Button color="inherit" size="small" onClick={onRetry}>Retry</Button> : undefined}
    >
      {message || 'Something went wrong.'}
    </Alert>
  )
}

ErrorState.propTypes = { message: PropTypes.string, onRetry: PropTypes.func }
