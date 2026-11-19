import { useState } from 'react'
import PropTypes from 'prop-types'
import { Link as RouterLink } from 'react-router-dom'
import {
  Badge, Box, Button, Card, CardActionArea, CardContent, Paper, Stack, Typography,
} from '@mui/material'
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined'
import { listProjects } from '../api/projects'
import ApprovalsList from '../components/ApprovalsList'
import FlagChips from '../components/FlagChips'
import HealthBadge from '../components/HealthBadge'
import LifecycleChip from '../components/LifecycleChip'
import { EmptyState, ErrorState, LoadingState } from '../components/PageState'
import useApiQuery from '../utils/useApiQuery'
import { formatDate } from '../utils/format'

/** One of the PM's projects, highlighting health and attention flags. */
function MyProjectCard({ project }) {
  return (
    <Card variant="outlined">
      <CardActionArea component={RouterLink} to={`/portfolio/${project.id}`}>
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
            <Typography variant="h3" component="h3">{project.name}</Typography>
            <HealthBadge health={project.health_overall} reasons={project.health_reasons || []} lifecycleStatus={project.lifecycle_status} size="small" />
          </Stack>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
            <LifecycleChip status={project.lifecycle_status} />
            <Typography variant="body2" color="text.secondary">Ends {formatDate(project.planned_end)}</Typography>
            <FlagChips flags={project.flags || []} />
          </Stack>
        </CardContent>
      </CardActionArea>
    </Card>
  )
}

MyProjectCard.propTypes = { project: PropTypes.object.isRequired }

/** Project Manager home: approvals waiting, then my projects (worst health first). */
export default function PmHomePage() {
  const [approvalCount, setApprovalCount] = useState(null)
  const projects = useApiQuery(() => listProjects({ mine: true, sort: 'health', page_size: 50 }), 'mine')
  const items = projects.data?.items || []

  let projectList
  if (projects.loading && !projects.data) projectList = <LoadingState rows={3} label="Loading your projects" />
  else if (projects.error) projectList = <ErrorState message={projects.error.message} onRetry={projects.reload} />
  else if (!items.length) projectList = <EmptyState title="You don't manage any projects yet" description="The Portfolio Manager assigns projects to you." />
  else projectList = <Stack spacing={1.5}>{items.map((p) => <MyProjectCard key={p.id} project={p} />)}</Stack>

  return (
    <>
      <Typography variant="h1" component="h1" sx={{ mb: 2 }}>My work</Typography>
      <Paper sx={{ p: { xs: 2, md: 3 }, mb: 3 }} component="section" aria-labelledby="approvals-heading">
        <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2 }}>
          <Badge color="error" badgeContent={approvalCount ?? 0} showZero={approvalCount !== null} max={99} data-testid="approvals-count">
            <FactCheckOutlinedIcon aria-hidden="true" />
          </Badge>
          <Typography id="approvals-heading" variant="h2" component="h2" sx={{ flexGrow: 1 }}>
            {approvalCount === null ? 'Approvals waiting' : `Approvals waiting (${approvalCount})`}
          </Typography>
          <Button component={RouterLink} to="/approvals" size="small">See all</Button>
        </Stack>
        <ApprovalsList limit={5} onCountChange={setApprovalCount} />
      </Paper>
      <Box component="section" aria-labelledby="my-projects-heading">
        <Typography id="my-projects-heading" variant="h2" component="h2" sx={{ mb: 1.5 }}>My projects</Typography>
        {projectList}
      </Box>
    </>
  )
}
