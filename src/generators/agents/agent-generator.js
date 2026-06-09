import { join } from 'node:path';
import { writeText, ensureDir } from '../../utils/fs.js';
import { renderAdvanced } from '../../utils/template.js';
import * as log from '../../utils/logger.js';

/**
 * Generate agent definition files (.pi/agents/*.md).
 *
 * @param {string} projectRoot
 * @param {import('../../config/schema.js').Role[]} roles
 * @param {import('../../config/schema.js').StackProfile} stackProfile
 * @param {import('../../config/schema.js').UserConfig} userConfig
 */
export async function generateAgents(projectRoot, roles, stackProfile, userConfig) {
  log.info('Generating agent definitions...');

  const agentsDir = join(projectRoot, '.pi', 'agents');
  await ensureDir(agentsDir);

  for (const role of roles) {
    const content = generateAgentMarkdown(role, stackProfile, userConfig);
    const filePath = join(agentsDir, `${role.name}.md`);
    await writeText(filePath, content);
    log.bullet(`${role.name} → .pi/agents/${role.name}.md`);
  }

  return roles.map((r) => `.pi/agents/${r.name}.md`);
}

/**
 * Generate markdown content for an agent definition.
 */
function generateAgentMarkdown(role, stackProfile, userConfig) {
  const titleName = toTitleCase(role.name.replace(/-/g, ' '));
  const memoryPath = `.agents/agent-memory/${role.name}.md`;

  // Build scope section
  let scopeSection = '';
  if (role.scope?.owns?.length) {
    scopeSection = '## Scope\nYou can modify:\n' + role.scope.owns.map((p) => `- \`${p}\` — All code under this directory`).join('\n') + '\n\n';
  }

  // Build constraints
  const constraints = [];
  if (role.scope?.owns?.length) {
    const otherPaths = stackProfile.domains
      .filter((d) => {
        const teamName = d.name;
        return teamName !== role.name.replace('-team', '') && role.name !== 'dev-team';
      })
      .flatMap((d) => d.paths);

    if (otherPaths.length > 0) {
      constraints.push(`NEVER modify ${otherPaths.map((p) => `\`${p}\``).join(' or ')} directory files without coordination`);
    }
  }
  constraints.push('All changes must pass Reviewer gate before merge');

  // Build commands
  const testCmd = inferTestCommand(role, stackProfile);
  const typecheckCmd = inferTypecheckCommand(role, stackProfile);
  const lintCmd = inferLintCommand(role, stackProfile);

  // Build team context
  const teams = role.category === 'build-team' && role.scope?.frameworks?.length
    ? role.scope.frameworks.join(', ')
    : '';

  // Agent template
  const frontmatter = `---
name: ${role.name}
description: "${role.description}"
tools: ${role.tools}
---`;

  const body = `# ${titleName} Agent

You are the **${titleName}** — ${role.description}.

## Your Role
1. Read task specifications and understand requirements
2. Implement changes within your scope
3. Write tests for all new code
4. Run quality checks before reporting completion
5. Update your memory with learnings

## Memory

### PRE-TASK (Mandatory)
Before starting ANY task, read your memory file: \`${memoryPath}\`
This provides context from previous sessions — your mental model, active work, and known gotchas.

### Memory File
- Location: \`${memoryPath}\`
- Auto-loaded at the start of every task (first 1500 chars)

### POST-TASK (Mandatory)
After completing ANY task, you MUST update your memory file using the write tool to APPEND.
Include ALL of the following:
- **What you did** — specific changes, files modified, commands run
- **What you learned** — new discoveries about the codebase, APIs, or patterns
- **Decisions made** — architectural choices, trade-offs, and rationale
- **Gotchas discovered** — things that broke, unexpected behaviors, workarounds
- **Current state** — what's in progress, what's blocked, what changed

### Standardized Memory Format
Your memory file MUST follow this structure:
\`\`\`
# ${titleName} Memory

## Mental Model
[Running understanding of the project from your perspective]

## Key Decisions
[Important choices made and why]

## Active Work
[What's currently in progress]

## Gotchas & Learnings
[Things to remember]

## History
[Chronological task log — entries as: ## [YYYY-MM-DD] brief summary]
\`\`\`
${scopeSection ? '\n' + scopeSection : ''}
## Before Starting a Task
1. Read your personal memory for context
2. Read the task specification
3. Check current codebase state of affected files
4. Plan your changes

## While Working
1. Follow coding standards
2. Write tests as you go
3. Run quality checks frequently
${testCmd ? `4. Run tests: \`${testCmd}\`` : ''}

## After Completing a Task
${testCmd ? `1. Run tests: \`${testCmd}\`` : ''}
${typecheckCmd ? `${testCmd ? '2' : '1'}. Run type checking: \`${typecheckCmd}\`` : ''}
${lintCmd ? `${(testCmd ? 2 : 1) + (typecheckCmd ? 1 : 0)}. Run linting: \`${lintCmd}\`` : ''}
- Update your personal memory with learnings
- Report completion for Reviewer gate

## GitHub Workflow
${userConfig.cicd === 'github' ? `All work is tracked via **GitHub Issues** and **Pull Requests**. Use \`gh\` CLI for all operations.

### Branch & PR Conventions
- Branch naming: \`{type}/issue-{number}-{description}\`
- PR titles: conventional commits — \`type(scope): description\`
- PR body must include \`Closes #N\` to link to the issue
- Always apply \`team:${role.name}\` label to PRs
- Never push directly to main — always use branches + PRs` : 'Follow your project\'s version control workflow.'}

## Constraints
${constraints.map((c) => `- ${c}`).join('\n')}
`;

  return frontmatter + '\n\n' + body;
}

function toTitleCase(str) {
  return str.replace(/\b\w/g, (c) => c.toUpperCase());
}

function inferTestCommand(role, stackProfile) {
  const testFw = stackProfile.structure.testFrameworks;
  if (!testFw.length) return null;

  // Check if this team owns a subdirectory
  const owns = role.scope?.owns || [];
  const subdir = owns.find((p) => p !== 'src/' && p.endsWith('/'));

  if (subdir && stackProfile.structure.type === 'monorepo') {
    return `cd ${subdir.replace('/', '')} && npm test`;
  }
  return 'npm test';
}

function inferTypecheckCommand(role, stackProfile) {
  const hasTS = stackProfile.languages.some((l) => l.name === 'typescript');
  if (!hasTS) return null;

  const owns = role.scope?.owns || [];
  const subdir = owns.find((p) => p !== 'src/' && p.endsWith('/'));

  if (subdir && stackProfile.structure.type === 'monorepo') {
    return `cd ${subdir.replace('/', '')} && npx tsc --noEmit`;
  }
  return 'npx tsc --noEmit';
}

function inferLintCommand(role, stackProfile) {
  const owns = role.scope?.owns || [];
  const subdir = owns.find((p) => p !== 'src/' && p.endsWith('/'));

  if (subdir && stackProfile.structure.type === 'monorepo') {
    return `cd ${subdir.replace('/', '')} && npm run lint`;
  }
  return 'npm run lint';
}
