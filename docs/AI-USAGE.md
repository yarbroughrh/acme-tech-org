# Beacon — How AI Was Used

Beacon was built in one day by an engineering lead (product owner) directing Claude (Claude Code, Opus 5.5) as
the senior engineer. This records how the work was directed, the prompts that shaped it, and where people stayed
in control.

## Operating model
- **The lead owned the business decisions:** scope, every business rule and threshold, permissions, cuts, and the
  build order. Claude made technical decisions and recorded each as an ADR (docs/DECISIONS.md, Part A).
- **Working agreement (set in the first prompt):**
  - read before writing;
  - thin vertical slices, each ending with tests green, a commit and a summary;
  - never invent a threshold or permission without saying so, and mark it ASSUMPTION;
  - ask before any infrastructure, IAM or deploy-script change, or anything destructive;
  - never weaken a test to make it pass;
  - keep CLAUDE.md, PROGRESS.md and DECISIONS.md current.
- **Parallel work:** Claude used forked sub-agents for well-scoped frontend slices against an API contract it wrote
  first. Claude owned integration: it re-ran every suite itself before committing a fork's work, and committed and
  deployed only verified code.

## The prompts that shaped the build (paraphrased)
1. **Phase 0, reconnaissance:** "Read the docs, the example service, the scripts and the Terraform; work out
   routing, packaging, DB, config, run, deploy, test and logs; start local; first AWS deploy; write CLAUDE.md;
   report risks and stop."
2. **Approvals:** the proxy header fix; the shared-library sync with committed copies plus a drift test; auth
   Lambda memory (diff shown first); deleting the smoke service; Vitest. Plus "rank the open questions, give me the
   top 5."
3. **Slice 1:** sign-in, sessions, RBAC, Admin users, read-only portfolio, deployed and smoke-tested.
4. **Stakeholder confirmations, fed in mid-slice:** overall = worst; weekly updates; PMO-only spend; executive home
   order; then the PM Analyst change-request workflow; then confirmed thresholds and no hard allocation block; then
   weekly (not monthly) spend.
5. **Nine lead decisions recorded as ASSUMPTIONs with rationale:** Admin has no project data; PMs see all and edit
   their own; PMO-only lifecycle and rebaselining with a reason; departments; mobile scope; and others.
6. **"Your next actions":** the action-first home page, with the lead's ranking rule.
7. **Evidence pass:** "Verify everything, fix nothing, be strictly honest: traceability table, access-control proof
   against the deployed API, health boundary proof, gaps."
8. **Time management:** a 25–30 minute time-box per item; "commit, deploy, smoke, then tell me ready to push";
   a hard stop at 15:00; cut list recorded as deliberate decisions.

## Where people stayed in control
- **Every infrastructure change was shown first and approved:** the auth Lambda memory diff and the CloudFront
  error-page fix. Claude never ran destroy, a database reset or a force-push.
- **Pushing to GitHub was done by the lead.** The VDI had no credentials, and Claude never handled the token.
- **Business rules came only from the lead or the stakeholder.** Each is labelled CONFIRMED, LEAD DECISION or
  ASSUMPTION in the code comments and in docs/DECISIONS.md. Claude flagged interpretations of a rule rather than
  silently choosing, for example "14+ days overdue" and the ranking rule's severity overlap.
- **The lead redirected scope repeatedly:** the build order, cutting the polish pass for the brief's minimum
  dashboard, and protecting allocations from cuts. Claude reported status and estimates, and asked before
  switching.
- **During the demo the lead froze deployments:** "do NOT deploy anything until I say so". Claude committed locally
  only. For the pre-demo sort tweak it deployed from an isolated worktree, so nothing else shipped (ADR-016).

- **The 14:50 hard stop was respected even when new confirmed requirements arrived at 15:09.** Claude reported the
  conflict, did not start the features, recorded them as confirmed-but-not-implemented, and asked the lead whether
  to make an exception before the 16:00 freeze.
- **Claude kept a feature the lead asked to drop** (weekly spend entry), because it was already live and verified.
  It said so plainly rather than silently removing working code.

## What the AI got wrong, and how it was caught
- **CloudFront masked API 404s as 200 HTML.** This was found by the lead's evidence pass when a "PM creates spend"
  check returned 200; it was fixed with an approved infra change.
- **Several tests depended on test order** (exact seed counts in a shared test database). They were caught by
  full-suite runs and fixed by scoping assertions to seeded rows, never by weakening the rule under test.
- **Some tests initially encoded a wrong expectation:** a fixture with an inconsistent actual start; a milestone with
  tasks where the percentage is correctly ignored; sign-in moving `previous_login_at`. In each case the product
  behaviour was checked against the rule first, and the test was corrected.
- **One fork was stopped by the lead before finishing.** Its unreviewed work was stashed, not merged.
- **Over-optimistic scope:** at the evidence pass several requested features were not built. The report said so
  plainly; it did not claim them.

## Verification habits
- **No "done" without evidence:**
  - test counts from fresh runs;
  - smoke tests against the deployed CloudFront URL after every deploy;
  - Terraform plans read before and after applying.
- **Access control proven against the deployed API, not only in unit tests:** each check's expected and actual
  status was recorded.
