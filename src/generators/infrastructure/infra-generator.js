import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeText, writeJSON, ensureDir, copyDir } from '../../utils/fs.js';
import * as log from '../../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Generate the .agents/ infrastructure directory.
 *
 * @param {string} projectRoot
 * @param {import('../../config/schema.js').Role[]} roles
 * @param {import('../../config/schema.js').UserConfig} userConfig
 */
export async function generateInfrastructure(projectRoot, roles, userConfig) {
  log.info('Generating infrastructure...');

  const agentsDir = join(projectRoot, '.agents');
  const generated = [];

  // ── Agent memory files ──────────────────────────────
  const memoryDir = join(agentsDir, 'agent-memory');
  await ensureDir(memoryDir);

  for (const role of roles) {
    const memoryFile = join(memoryDir, `${role.name}.md`);
    const titleName = toTitleCase(role.name.replace(/-/g, ' '));
    await writeText(memoryFile, `# ${titleName} Memory\n\n## Mental Model\n[Running understanding of the project from your perspective]\n\n## Key Decisions\n[Important choices made and why]\n\n## Active Work\n[What's currently in progress]\n\n## Gotchas & Learnings\n[Things to remember]\n\n## History\n[Chronological task log]\n`);
    generated.push(`.agents/agent-memory/${role.name}.md`);
    log.bullet(`memory → .agents/agent-memory/${role.name}.md`);
  }

  // ── Context bus ─────────────────────────────────────
  if (userConfig.features.contextBus) {
    const contextBusDir = join(agentsDir, 'context-bus');
    await ensureDir(contextBusDir);

    // config.json
    await writeJSON(join(contextBusDir, 'config.json'), {
      version: '1.0.0',
      eventTypes: [
        'delegation.started',
        'delegation.completed',
        'delegation.failed',
        'tool.call_started',
        'tool.call_completed',
        'memory.updated',
        'mail.sent',
        'error.exception',
      ],
      logLevel: 'info',
      retention: '7d',
    });
    generated.push('.agents/context-bus/config.json');

    // events.jsonl (empty)
    await writeText(join(contextBusDir, 'events.jsonl'), '');
    generated.push('.agents/context-bus/events.jsonl');

    // README.md
    await writeText(
      join(contextBusDir, 'README.md'),
      `# Context Bus

The context bus logs events from all agent instances for cross-instance coordination.

## Structure
- \`config.json\` — Event types and retention settings
- \`events.jsonl\` — Event log (JSON Lines format, gitignored)

## Event Format
Each event is a JSON object on a single line:
\`\`\`json
{"event_id":"...","timestamp":"...","event_type":"...","source_agent":"...","payload":{}}
\`\`\`
`
    );
    generated.push('.agents/context-bus/README.md');
    log.bullet('context-bus → .agents/context-bus/');
  }

  // ── Instance registry ───────────────────────────────
  await writeJSON(join(agentsDir, 'instance-registry.json'), []);
  generated.push('.agents/instance-registry.json');

  // ── Optional directories ────────────────────────────
  const optionalDirs = [];
  if (userConfig.features.releaseChain) optionalDirs.push('releases');
  if (userConfig.features.smartDispatcher) optionalDirs.push('dispatch');
  if (userConfig.features.uxDesignChain) optionalDirs.push('designs');

  for (const dir of optionalDirs) {
    await ensureDir(join(agentsDir, dir));
    // Add .gitkeep
    await writeText(join(agentsDir, dir, '.gitkeep'), '');
    generated.push(`.agents/${dir}/`);
    log.bullet(`${dir} → .agents/${dir}/`);
  }

  // ── .gitignore additions ────────────────────────────
  await appendToGitignore(projectRoot);

  return generated;
}

/**
 * Install skills from the library to .pi/skills/
 */
export async function installSkills(projectRoot, userConfig) {
  log.info('Installing skills...');
  const skillsDir = join(projectRoot, '.pi', 'skills');
  const libraryDir = join(__dirname, '..', '..', 'skills');
  const installed = [];

  const coreSkills = [
    'smart-dispatcher',
    'memory-maintenance',
    'memory-compaction',
    'smart-memory',
    'focused-subagent',
    'tmux-control',
  ];

  const optionalSkills = {
    'release-chain': 'releaseChain',
    'ux-design-chain': 'uxDesignChain',
    'brain-orchestrator': 'brainWiki',
  };

  for (const skill of coreSkills) {
    const src = join(libraryDir, skill);
    const dest = join(skillsDir, skill);
    await copyDir(src, dest);
    installed.push(skill);
    log.bullet(`skill → .pi/skills/${skill}/`);
  }

  for (const [skill, featureKey] of Object.entries(optionalSkills)) {
    if (userConfig.features[featureKey]) {
      const src = join(libraryDir, skill);
      const dest = join(skillsDir, skill);
      await copyDir(src, dest);
      installed.push(skill);
      log.bullet(`skill → .pi/skills/${skill}/ (optional)`);
    }
  }

  return installed;
}

/**
 * Install extensions from the library to .pi/extensions/
 */
export async function installExtensions(projectRoot, roles, userConfig) {
  if (userConfig.interactionMode === 'direct') return [];

  log.info('Installing extensions...');
  const extDir = join(projectRoot, '.pi', 'extensions');
  const libraryDir = join(__dirname, '..', '..', 'extensions');
  const installed = [];

  // Copy head-agent extension
  await copyDir(join(libraryDir, 'head-agent'), join(extDir, 'head-agent'));
  installed.push('head-agent');
  log.bullet('extension → .pi/extensions/head-agent/');

  // Generate constants.ts from template
  const constantsTemplate = await import('node:fs').then(fs =>
    fs.promises.readFile(join(libraryDir, 'head-agent', 'constants.ts.template'), 'utf-8')
  );
  const teams = roles.filter(r => r.category === 'build-team').map(r => r.name);
  let constantsContent = constantsTemplate;
  constantsContent = constantsContent
    .replace('{{TEAMS_OBJECT}}', JSON.stringify(
      Object.fromEntries(teams.map(t => [t, { name: t }]))
    ))
    .replace('{{TEAMS_ARRAY}}', JSON.stringify(teams))
    .replace('{{DEBUG_SCOPES_ARRAY}}', JSON.stringify(teams));
  await writeText(join(extDir, 'head-agent', 'constants.ts'), constantsContent);
  log.bullet('generated → .pi/extensions/head-agent/constants.ts');

  // Copy command-center
  await copyDir(join(libraryDir, 'command-center'), join(extDir, 'command-center'));
  installed.push('command-center');
  log.bullet('extension → .pi/extensions/command-center/');

  // Copy instance-username
  const { copyFile } = await import('node:fs/promises');
  await copyFile(join(libraryDir, 'instance-username.ts'), join(extDir, 'instance-username.ts'));
  installed.push('instance-username');
  log.bullet('extension → .pi/extensions/instance-username.ts');

  return installed;
}

function toTitleCase(str) {
  return str.replace(/\b\w/g, (c) => c.toUpperCase());
}

async function appendToGitignore(projectRoot) {
  const gitignorePath = join(projectRoot, '.gitignore');
  const additions = `
# Agent infrastructure (generated by pi-org-bootstrap)
.agents/context-bus/events.jsonl
.agents/instance-registry.json
.agents/agent-memory/archive/
.agents/designs/
.agents/releases/
.agents/dispatch/
`;

  try {
    const { readText, appendText, pathExists } = await import('../../utils/fs.js');
    if (await pathExists(gitignorePath)) {
      const existing = await readText(gitignorePath);
      if (!existing.includes('pi-org-bootstrap')) {
        await appendText(gitignorePath, additions);
        log.bullet('Updated .gitignore');
      }
    } else {
      await writeText(gitignorePath, additions);
      log.bullet('Created .gitignore');
    }
  } catch {
    // Non-critical
  }
}
