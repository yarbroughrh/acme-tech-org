import { Typography } from '@mui/material'
import ApprovalsList from '../components/ApprovalsList'

/** Full list of change requests waiting for the signed-in PM's decision. */
export default function ApprovalsPage() {
  return (
    <>
      <Typography variant="h1" component="h1" sx={{ mb: 1 }}>Approvals</Typography>
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        Changes proposed by PM Analysts on your projects. Nothing changes, and health is not affected, until you approve.
      </Typography>
      <ApprovalsList />
    </>
  )
}
