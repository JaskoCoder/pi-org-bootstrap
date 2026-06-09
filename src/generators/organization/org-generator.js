import { join } from 'node:path';
import { writeText, ensureDir } from '../../utils/fs.js';
import * as log from '../../utils/logger.js';

/**
 * Generate ORGANIZATION.md in .agents/
 */
export async function generateOrganization(projectRoot, roles, stackProfile, userConfig) {
  log.info('Generating ORGANIZATION.md...');

  const filePath = join(projectRoot, '.agents', 'ORGANIZATION.md');
  await ensureDir(join(projectRoot, '.agents'));

  const content = buildOrgMarkdown(roles, stackProfile, userConfig);
  await writeText(filePath, content);

  log.bullet('ORGANIZATION.md → .agents/ORGANIZATION.md');
  return filePath;
}

function buildOrgMarkdown(roles, stackProfile, userConfig) {
  const projectName = stackProfile.gitHosting.repo || 'Project';
  const buildTeams = roles.filter((r) => r.category === 'build-team');
  const universalRoles = roles.filter((r) => r.isUniversal);
  const teamCount = buildTeams.length;
  const roleCount = roles.length;

  let md = `# ${projectName} Agent Organization Charter

## 1. Purpose
This document defines the autonomous agent organization for ${projectName}.
Agents work collaboratively under the direction of a dispatcher (head agent),
with clear separation of concerns, ownership boundaries, and quality gates.

## 2. Agent Roles & Responsibilities

`;

  // Dispatcher
  const dispatcher = roles.find((r) => r.name === 'dispatcher');
  if (dispatcher) {
    md += `### 2.1 Dispatcher (Orchestrator)
**Role**: Central coordinator — triages issues, assigns tasks, manages workflow.
**Tools**: ${dispatcher.tools}
**Scope**: Full project access (no restrictions)
**Responsibilities**:
- Triage incoming GitHub Issues
- Route tasks to appropriate teams
- Monitor task progress
- Coordinate cross-team work
- Enforce separation of powers

`;
  }

  // Tech Lead
  const techLead = roles.find((r) => r.name === 'tech-lead');
  if (techLead) {
    md += `### 2.2 Tech Lead (Architect)
**Role**: Architect — designs solutions, reviews architecture, defines standards.
**Tools**: ${techLead.tools}
**Scope**: Full project access (read-only by default)
**Responsibilities**:
- Design technical solutions
- Write ADRs (Architecture Decision Records)
- Define coding standards
- Review architecture decisions
- Guide technology choices

`;
  }

  // Build teams
  buildTeams.forEach((team, i) => {
    const num = i + 3;
    const titleName = toTitleCase(team.name.replace(/-/g, ' '));
    const owns = team.scope?.owns?.join(', ') || 'assigned directories';
    const frameworks = team.scope?.frameworks?.join(', ') || 'N/A';

    md += `### 2.${num} ${titleName}
**Role**: ${team.description}
**Tools**: ${team.tools}
**Scope**: ${owns}
**Frameworks**: ${frameworks}
**Constraints**:
- Only modify files within assigned scope
- All changes must pass Reviewer gate
- Must coordinate for cross-scope changes

`;
  });

  // Security officer
  const secOff = roles.find((r) => r.name === 'security-officer');
  if (secOff) {
    md += `### Security Officer
**Role**: ${secOff.description}
**Tools**: ${secOff.tools}
**Powers**: Can block deployments, veto changes with security concerns
**Responsibilities**:
- Security audits
- Vulnerability scanning
- Dependency review
- Incident response

`;
  }

  // Reviewer
  const reviewer = roles.find((r) => r.name === 'reviewer');
  if (reviewer) {
    md += `### Reviewer (Quality Gate)
**Role**: ${reviewer.description}
**Tools**: ${reviewer.tools}
**Powers**: Can approve or reject PRs
**Responsibilities**:
- Code review for all PRs
- Quality standards enforcement
- Test coverage verification
- Architecture compliance

`;
  }

  // Workflow
  md += `## 3. Workflow Processes

### 3.1 Bug Fix Workflow
1. Bug reported → GitHub Issue created
2. Dispatcher triages → assigns to appropriate team
3. Team creates branch, implements fix
4. Team opens PR with \`Closes #N\`
5. Reviewer reviews PR
6. PR merged → issue auto-closes

### 3.2 Feature Workflow
1. Feature request → GitHub Issue
2. Tech Lead designs solution
3. Dispatcher assigns implementation
4. Team implements on branch
5. Reviewer reviews
6. PR merged

### 3.3 Release Workflow
${userConfig.features.releaseChain ? `1. Release chain triggers: changelog → version bump → deploy → health check
2. Infra team monitors deployment
3. Health verification with automatic rollback` : '1. Manual release process'}

## 4. Memory Architecture

${userConfig.features.memory ? `Each agent maintains a personal memory file at \`.agents/agent-memory/{agent-name}.md\`.

### Memory Structure
- **Mental Model**: Running understanding of the project
- **Key Decisions**: Important choices and rationale
- **Active Work**: What's currently in progress
- **Gotchas & Learnings**: Things to remember
- **History**: Chronological task log

### Memory Protocol
- Read memory at start of every task
- Append to memory after every task
- Never overwrite — always append
- Tag entries with instance ID when multiple instances active` : 'Memory system not enabled.'}

## 5. Communication Protocols

${userConfig.features.contextBus ? `Agents communicate via the context bus at \`.agents/context-bus/\`.

### Inter-Agent Mail
- Use \`send_mail\` to send messages to teams
- Check \`check_mail\` before starting work
- Messages include: handoffs, findings, blockers

### Event Logging
- All actions logged to context bus
- Events visible to all instances
- Used for coordination and conflict avoidance` : 'Agents communicate through task delegation only.'}

## 6. Agent Count

- **${roleCount} agents** across ${teamCount} team(s)
- **${universalRoles.length} universal roles**: ${universalRoles.map((r) => r.name).join(', ')}
${buildTeams.length > 0 ? `- **${buildTeams.length} domain teams**: ${buildTeams.map((r) => r.name).join(', ')}` : ''}
`;

  return md;
}

function toTitleCase(str) {
  return str.replace(/\b\w/g, (c) => c.toUpperCase());
}
