---
name: release-chain
description: "Triggers the 4-stage release chain: Changelog Generation → Version Bump → Deploy → Health Verification (with automatic rollback on failure). Use when creating releases, deploying to production, cutting a new version, publishing a release, bumping versions, or performing deployment health checks. Produces changelog, health report, and status tracking in .agents/releases/. Triggers on keywords: release, deploy, version bump, changelog, publish, cut a release, ship it, production deploy, rollout, health check, rollback, deployment pipeline, release chain."
---

# Release Chain Skill

Orchestrates the 4-stage release chain that transforms merged PRs into a
versioned, deployed, and health-verified production release — with automatic
rollback on failure.

## When to Load

This skill activates when the user's task involves:
- Creating a new release ("cut a release", "ship it", "publish release")
- Deploying to production ("deploy to prod", "production deploy", "rollout")
- Version management ("bump version", "new version", "version X.Y.Z")
- Release preparation ("generate changelog", "what changed since...")
- Post-deploy verification ("health check", "verify deployment", "smoke test")
- Rollback scenarios ("rollback", "revert deployment", "un-deploy")

## Chain Overview

```
Changelog → Version Bump → Deploy → Health Check → (Rollback if needed)
```

The chain produces **3 artifacts** stored in `.agents/releases/`:

| Artifact | Path | Stage |
|----------|------|-------|
| Changelog | `.agents/releases/changelog-{version}.md` | Stage 1 |
| Health Report | `.agents/releases/health-report-{version}.md` | Stage 4 |
| Chain Status | `.agents/releases/status-{version}.json` | All stages |

---

## Execution Protocol

### Prerequisites

1. Determine the **target version**. If not specified, it will be calculated in Stage 2 based on the changelog.
2. Get the **last git tag**: `git describe --tags --abbrev=0`
3. Ensure working tree is clean: `git status --porcelain` must return empty
4. Ensure `.agents/releases/` directory exists: `mkdir -p .agents/releases`
5. Initialize the status file (see [Status File Format](#status-file-format))

### Stage 1: Changelog Generation

**Delegate to:** `infra-devops` (or whichever team owns release tooling)

**Task:**
```
Generate the changelog for the upcoming release.
Last tag: {last_tag}
Target version: {version} (or "auto-detect" if unspecified)

Steps:
1. Gather merged PRs since last tag:
   gh pr list --state merged --search "merged:>{last_tag_date}" --json number,title,labels,url

2. Categorize each PR into:
   - 🚀 Features (label: type:feature)
   - 🐛 Bug Fixes (label: type:bug)
   - 💥 Breaking Changes (label: type:breaking)
   - 📦 Dependencies (label: type:dependencies)
   - 🔧 Maintenance (everything else)

3. Generate a conventional changelog with sections:
   - Header: "## v{version} ({date})"
   - Summary line with counts: "X features, Y fixes, Z breaking"
   - Each section with PR links
   - Contributors list

4. Write changelog to .agents/releases/changelog-{version}.md

5. Output the categorized counts so Stage 2 can determine bump type.
```

**Gate:** Changelog file must exist and contain at least the header and one categorized section. If zero merged PRs are found, abort with message "No changes since last release."

### Stage 2: Version Bump

**Delegate to:** `infra-devops` (or whichever team owns release tooling)

**Task:**
```
Bump the project version based on the changelog analysis.
Changelog: .agents/releases/changelog-{version}.md

Steps:
1. Determine bump type from changelog categories:
   - MAJOR (X.0.0): Any breaking changes present
   - MINOR (0.X.0): Any features present (no breaking)
   - PATCH (0.0.X): Only fixes and/or maintenance (no features, no breaking)

2. Calculate new version:
   - Parse current version from git tag (strip 'v' prefix)
   - Apply semver bump: increment the appropriate component, zero out lower components
   - Example: v1.2.3 + minor bump → v1.3.0

3. Update version in ALL package.json files (or equivalent manifest files):
<!-- BOOTSTRAP:VERSION-FILES-START -->
   - Update "version" field in each package.json found in the project
<!-- BOOTSTRAP:VERSION-FILES-END -->

4. Git operations:
   git add {version files}
   git commit -m "chore(release): v{version}"
   git tag -a v{version} -m "Release v{version}"
   git push origin main --follow-tags

5. If changelog file was named with "auto-detect" or placeholder, rename it now:
   mv .agents/releases/changelog-auto-detect.md .agents/releases/changelog-{version}.md

6. Update the status file with the confirmed version.
```

**Gate:** Git tag `v{version}` must exist and be pushed to remote. Verify with: `git ls-remote --tags origin | grep v{version}`

### Stage 3: Deploy

**Delegate to:** `infra-devops` (or whichever team owns deployment)

**Task:**
```
Build and deploy version {version} to production.

Steps:
1. Build artifacts:
<!-- BOOTSTRAP:BUILD-COMMANDS-START -->
   # Default: Use Docker if docker-compose.yml exists, otherwise npm/pnpm build
   if [ -f docker-compose.prod.yml ]; then
     docker compose -f docker-compose.prod.yml build
     docker tag {image}:latest {image}:v{version}
   else
     npm run build
   fi
<!-- BOOTSTRAP:BUILD-COMMANDS-END -->

2. Push to registry (if applicable):
<!-- BOOTSTRAP:PUSH-COMMANDS-START -->
   # Default: Push Docker images if Docker is used
   if [ -f docker-compose.prod.yml ]; then
     docker push {registry}/{image}:v{version}
     docker push {registry}/{image}:latest
   fi
<!-- BOOTSTRAP:PUSH-COMMANDS-END -->

3. Deploy:
<!-- BOOTSTRAP:DEPLOY-COMMANDS-START -->
   # Default: Docker Compose or direct process restart
   if [ -f docker-compose.prod.yml ]; then
     docker compose -f docker-compose.prod.yml up -d
   else
     # Restart the application process
     pm2 restart all  # or systemctl restart app
   fi
<!-- BOOTSTRAP:DEPLOY-COMMANDS-END -->

4. Wait for health endpoint to respond:
   Retry up to 10 times with 10s intervals:
<!-- BOOTSTRAP:HEALTH-ENDPOINT-START -->
     curl -sf http://localhost:3000/health
<!-- BOOTSTRAP:HEALTH-ENDPOINT-END -->
   If health endpoint responds with 200, deployment is live.
   If health endpoint never responds, flag as FAILED.

5. Do NOT proceed to health verification if deployment failed.
   Set status to "deploy-failed" and notify for rollback.
```

**Gate:** Health endpoint returns HTTP 200 within 100 seconds. If gate fails, jump directly to rollback procedure.

### Stage 4: Health Verification

**Delegate to:** `infra-devops` (or whichever team owns deployment)

**Task:**
```
Verify the health of the v{version} deployment.
Previous version (for rollback): {prev_version}

Steps:
1. Hit health endpoint:
<!-- BOOTSTRAP:HEALTH-CHECK-START -->
   curl -sf http://localhost:3000/health
<!-- BOOTSTRAP:HEALTH-CHECK-END -->
   Record response code, latency, and body.

2. Smoke test critical flows:
<!-- BOOTSTRAP:SMOKE-TESTS-START -->
   - Homepage loads (200)
   - API health check (200)
   - Login/auth flow (200 or appropriate redirect)
<!-- BOOTSTRAP:SMOKE-TESTS-END -->
   Record results per endpoint.

3. Monitor error rates for 5 minutes:
   - Check application logs
<!-- BOOTSTRAP:LOG-COMMAND-START -->
   # Default: Docker logs or application logs
   if [ -f docker-compose.prod.yml ]; then
     docker compose logs --since 5m
   else
     journalctl -u app --since "5 minutes ago"
   fi
<!-- BOOTSTRAP:LOG-COMMAND-END -->
   - Look for error-level entries, exceptions, crashes
   - Count errors vs total requests
   - Calculate error rate percentage

4. Produce health report at .agents/releases/health-report-{version}.md:
   - Deployment info (version, time, host)
   - Health endpoint result
   - Smoke test results (table: endpoint | status | latency)
   - Error rate summary
   - Verdict: HEALTHY | DEGRADED | UNHEALTHY

5. Determine verdict:
   - HEALTHY: error rate < 1%, all smoke tests pass
   - DEGRADED: error rate 1-5%, or 1 non-critical smoke test failing
   - UNHEALTHY: error rate > 5%, or any critical smoke test failing, or health endpoint down

6. If verdict is DEGRADED or UNHEALTHY, execute rollback (see below).

7. If verdict is HEALTHY, update status to "complete" and notify.
```

**Gate:** Verdict is HEALTHY. Otherwise, rollback is triggered.

### Rollback Procedure

Triggered when Stage 3 deploy fails OR Stage 4 verdict is DEGRADED/UNHEALTHY.

**Delegate to:** `infra-devops` (or whichever team owns deployment)

**Task:**
```
ROLLBACK: Deployment v{version} failed or is unhealthy.
Previous known-good version: {prev_version}

Steps:
1. Notify all teams immediately:
   send_mail(all, "ROLLBACK: v{version} → v{prev_version}", "Deploy failed/unhealthy. Initiating rollback.")

2. Revert to previous version:
<!-- BOOTSTRAP:ROLLBACK-COMMANDS-START -->
   # Default: Docker rollback or process restart
   if [ -f docker-compose.prod.yml ]; then
     docker compose -f docker-compose.prod.yml down
     docker tag {registry}/{image}:v{prev_version} {registry}/{image}:latest
     docker compose -f docker-compose.prod.yml up -d
   else
     git checkout v{prev_version}
     npm run build
     pm2 restart all  # or systemctl restart app
   fi
<!-- BOOTSTRAP:ROLLBACK-COMMANDS-END -->

3. Wait for health endpoint:
   Retry up to 10 times with 10s intervals:
<!-- BOOTSTRAP:ROLLBACK-HEALTH-START -->
   curl -sf http://localhost:3000/health
<!-- BOOTSTRAP:ROLLBACK-HEALTH-END -->

4. Verify rollback:
   - Health endpoint returns 200
   - Quick smoke test of homepage + API
   - Check logs for errors

5. Create GitHub issue for the failed deployment:
   gh issue create --title "release: v{version} deployment failed — rolled back to v{prev_version}" \
     --body "## Rollback Report\n\n- Failed version: v{version}\n- Rolled back to: v{prev_version}\n- Reason: [from health report]\n\nSee: .agents/releases/health-report-{version}.md" \
     --label "type:bug,severity:critical,team:infra-devops"

6. Remove the failed tag (optional, discuss with team):
   git push origin :refs/tags/v{version}
   git tag -d v{version}

7. Update status file: status → "rolled-back"

8. If ROLLBACK ITSELF FAILS (health endpoint doesn't recover):
   - This is CRITICAL — production may be down
   - send_mail(all, "CRITICAL: Rollback failed — production may be down")
   - Create severity:critical issue
   - Human intervention required immediately
```

---

## Inter-Stage Communication

Between stages, use `send_mail` to notify relevant teams:

| Transition | Recipient | Subject |
|------------|-----------|---------|
| Before chain | `all` | "Starting release chain for v{version}" |
| Changelog → Version Bump | `infra-devops` | "Changelog ready for v{version}" |
| Version Bump → Deploy | `infra-devops` | "v{version} tagged and pushed — ready to deploy" |
| Deploy → Health Check | `infra-devops` | "v{version} deployed — starting health check" |
| Health Check (HEALTHY) | `all` | "Release v{version} complete and healthy ✅" |
| Health Check (DEGRADED) | `tech-lead` | "Release v{version} deployed but DEGRADED ⚠️" |
| Rollback triggered | `all` | "ROLLBACK: v{version} → v{prev_version} 🔄" |
| Rollback complete | `all` | "Rollback to v{prev_version} complete" |
| Rollback failed | `all` | "CRITICAL: Rollback failed — production may be down 🚨" |

---

## Status File Format

Write this JSON file at `.agents/releases/status-{version}.json`:

```json
{
  "version": "0.0.0",
  "previousVersion": "0.0.0",
  "status": "generating-changelog",
  "bumpType": null,
  "deployedAt": null,
  "healthVerdict": null,
  "errorRate": null,
  "rollbackVersion": null,
  "createdAt": "",
  "updatedAt": ""
}
```

**Status values:** `generating-changelog` | `bumping-version` | `deploying` | `verifying-health` | `complete` | `deploy-failed` | `degraded` | `rolled-back` | `rollback-failed`

**Update after each stage:**
- Start: `status: "generating-changelog"`
- After Stage 1: `status: "bumping-version"`
- After Stage 2: `status: "deploying"`, set `bumpType` and confirmed `version`
- After Stage 3: `status: "verifying-health"`, set `deployedAt`
- After Stage 4 (healthy): `status: "complete"`, set `healthVerdict: "HEALTHY"`
- After Stage 4 (degraded): `status: "degraded"`, set `healthVerdict: "DEGRADED"`
- After rollback: `status: "rolled-back"`, set `rollbackVersion`
- Rollback failed: `status: "rollback-failed"`

---

## Rollback Decision Tree

```
Stage 3 Deploy
├── SUCCESS → Stage 4 (Health Verification)
│   ├── HEALTHY (error_rate < 1%, all smokes pass)
│   │   └── → status: "complete" ✅
│   ├── DEGRADED (error_rate 1-5%, non-critical smoke fail)
│   │   └── → ROLLBACK → rollback to prev_version
│   │       ├── Rollback succeeds → status: "rolled-back" 🔄
│   │       └── Rollback fails → status: "rollback-failed" 🚨
│   └── UNHEALTHY (error_rate > 5%, critical smoke fail, health down)
│       └── → ROLLBACK → rollback to prev_version
│           ├── Rollback succeeds → status: "rolled-back" 🔄
│           └── Rollback fails → status: "rollback-failed" 🚨
└── FAILED (health endpoint never responded)
    └── → ROLLBACK → rollback to prev_version
        ├── Rollback succeeds → status: "rolled-back" 🔄
        └── Rollback fails → status: "rollback-failed" 🚨
```

---

## Error Handling

| Scenario | Action |
|---------|--------|
| No merged PRs since last tag | Abort chain — "No changes since last release" |
| Working tree dirty | Abort chain — ask user to commit/stash changes first |
| Git tag already exists | Abort chain — "Version v{X} already exists" |
| Build fails | Do NOT deploy. Retry build once. If still fails, abort. |
| Health endpoint never responds (Stage 3) | Rollback immediately |
| Health check finds errors (Stage 4) | Follow rollback decision tree |
| Rollback succeeds but prev version also unhealthy | CRITICAL alert — human intervention required |
| Sub-agent/delegate fails | Retry once with 30s wait. If still fails, escalate to tech-lead |
| `gh` CLI not authenticated | Abort chain — "GitHub CLI not authenticated. Run `gh auth login`" |

---

## Artifact Archive Convention

Each release is preserved for traceability:

```
.agents/releases/
├── changelog-v1.2.0.md                 # Stage 1 output
├── changelog-v1.2.1.md                 # Next patch release
├── health-report-v1.2.0.md             # Stage 4 output (if reached)
├── health-report-v1.2.1.md             # Next health report
├── status-v1.2.0.json                  # Chain state
└── status-v1.2.1.json                  # Next chain state
```

Previous release artifacts are never overwritten — each version creates new files.

---

## Quick Reference

### Semver Bump Rules

| Condition | Bump Type | Example |
|-----------|-----------|---------|
| Any `type:breaking` label | MAJOR | 1.2.3 → 2.0.0 |
| Any `type:feature` label (no breaking) | MINOR | 1.2.3 → 1.3.0 |
| Only `type:bug` or maintenance | PATCH | 1.2.3 → 1.2.4 |

### Health Verdict Thresholds

| Verdict | Error Rate | Smoke Tests | Action |
|---------|-----------|-------------|--------|
| HEALTHY | < 1% | All pass | Complete ✅ |
| DEGRADED | 1-5% | 1 non-critical fail | Rollback 🔄 |
| UNHEALTHY | > 5% | Any critical fail | Rollback 🔄 |

### Key Commands

```bash
# Get last tag
git describe --tags --abbrev=0

# Get merged PRs since tag
gh pr list --state merged --search "merged:>$(git log -1 --format=%ci {last_tag})" --json number,title,labels

# Check working tree
git status --porcelain

# Verify tag pushed
git ls-remote --tags origin | grep v{version}
```
