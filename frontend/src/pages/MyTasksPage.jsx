import { Paper, Typography } from '@mui/material'
import { EmptyState } from '../components/PageState'

/** Team member home. Task list arrives in slice 2. */
export default function MyTasksPage() {
  return (
    <>
      <Typography variant="h1" component="h1" sx={{ mb: 2 }}>My tasks</Typography>
      <Paper>
        <EmptyState
          title="Your assigned tasks will appear here"
          description="When a project manager assigns you a task, you'll be able to update its status from this page."
        />
      </Paper>
    </>
  )
}
