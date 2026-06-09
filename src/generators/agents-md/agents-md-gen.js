import { join } from 'node:path';
import { writeText, ensureDir, appendText, pathExists } from '../../utils/fs.js';
import * as log from '../../utils/logger.js';

/**
 * Generate AGENTS.md in the project root.
 */
export async function generateAgentsMd(projectRoot, roles, stackProfile, userConfig) {
  log.info('Generating AGENTS.md...');

  const filePath = join(projectRoot, 'AGENTS.md');
  const content = buildAgentsMd(roles, stackProfile, userConfig);
  await writeText(filePath, content);

  log.bullet('AGENTS.md → ./AGENTS.md');
  return filePath;
}

function buildAgentsMd(roles, stackProfile, userConfig) {
  const projectName = stackProfile.gitHosting.repo || 'Project';
  const buildTeams = roles.filter((r) => r.category === 'build-team');
  const hasSecurityOfficer = roles.some((r) => r.name === 'security-officer');
  const roleCount = roles.length;
  const teamCount = buildTeams.length;

  let md = `# AGENTS.md

Project guidelines for AI assistants.

## ⚠️ MANDATORY: Always Use Git/GitHub — Never Local-Only Changes

**Every code change must go through Git and GitHub. No exceptions.**

`;

  if (userConfig.cicd === 'github') {
    md += `### Workflow for every change:
\`\`\`bash
1. gh issue create → GitHub Issue
2. git checkout -b fix/issue-N-description
3. Delegate to team → make changes on the branch
4. git add && git commit -m "fix(scope): description closes #N"
5. git push origin fix/issue-N-description
6. gh pr create → PR linked to issue
7. Delegate to reviewer → gh pr review
8. gh pr merge → closes issue automatically
\`\`\`

### Quick Commands
\`\`\`bash
# Report a bug → GitHub Issue
gh issue create --title "bug title" --body "description" --label "type:bug,severity:medium"

# Triage → apply labels
gh issue edit <number> --add-label "team:frontend,priority:high"

# Check pipeline status
# (use pipeline_status tool)

# Run CI pipeline
# (use pipeline_run tool)

# Create a branch for a fix
git checkout -b fix/issue-<number>-<short-description>

# Commit and push
git add -A && git commit -m "fix(scope): description closes #<number>"
git push origin fix/issue-<number>-<short-description>

# Create a PR linked to the issue
gh pr create --title "fix(scope): description" --body "Closes #<number>" --label "team:backend"

# Review a PR
gh pr view <number>
gh pr diff <number>
gh pr review <number> --approve --body "LGTM"

# Check CI on a PR
gh pr checks <number>

# Merge (auto-closes the issue)
gh pr merge <number> --squash
\`\`\`

`;
  }

  md += `---

## Autonomous Agent Organization

This project has an **autonomous agent organization** at \`.agents/\` with:
- **${roleCount} specialized agents** across ${teamCount} team(s) + dispatcher + reviewer${hasSecurityOfficer ? ' + security officer' : ''} + tech lead
${userConfig.features.smartDispatcher ? '- **Smart dispatcher** — file-path-aware routing\n' : ''}${userConfig.features.releaseChain ? '- **Release chain** — changelog → version → deploy → health\n' : ''}
- **${userConfig.cicd === 'github' ? 'GitHub' : userConfig.cicd === 'gitlab' ? 'GitLab' : 'Manual'}-first bug tracking** — all bugs as Issues with labels
- **Separation of powers** — no agent can both write and approve code
${userConfig.features.memory ? '- **Personal memory** — each agent has persistent context across sessions' : ''}

**Read the full organization**: \`.agents/ORGANIZATION.md\`

### Agent Definitions
Agents are defined in \`.pi/agents/\`:
`;

  for (const role of roles) {
    const short = role.description.split('—')[0].trim();
    md += `- \`${role.name}\` — ${short}\n`;
  }

  md += `
## ${projectName} Context

${stackProfile.languages.length > 0 ? `**Languages**: ${stackProfile.languages.map((l) => l.name).join(', ')}\n` : ''}${stackProfile.frameworks.length > 0 ? `**Frameworks**: ${stackProfile.frameworks.map((f) => f.name).join(', ')}\n` : ''}${stackProfile.structure.type !== 'single-app' ? `**Structure**: ${stackProfile.structure.type}\n` : ''}${stackProfile.databases.length > 0 ? `**Databases**: ${stackProfile.databases.map((d) => d.type).join(', ')}\n` : ''}
`;

  return md;
}
