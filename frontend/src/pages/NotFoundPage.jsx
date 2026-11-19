import { Link as RouterLink } from 'react-router-dom'
import { Button, Paper, Typography } from '@mui/material'
import { EmptyState } from '../components/PageState'

/** Fallback for unknown routes. */
export default function NotFoundPage() {
  return (
    <>
      <Typography variant="h1" component="h1" sx={{ mb: 2 }}>Page not found</Typography>
      <Paper>
        <EmptyState
          title="We couldn't find that page"
          description="The link may be out of date."
          action={<Button component={RouterLink} to="/" variant="contained">Go to your home page</Button>}
        />
      </Paper>
    </>
  )
}
