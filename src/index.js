import { join } from 'node:path';
import { pathExists, writeJSON, ensureDir } from './utils/fs.js';
import { scan } from './scanner/index.js';
import { prompt } from './prompter/index.js';
import { buildRoles } from './generators/agents/role-builder.js';
import { generateAgents } from './generators/agents/agent-generator.js';
import { generateOrganization } from './generators/organization/org-generator.js';
import { generateAgentsMd } from './generators/agents-md/agents-md-gen.js';
import { generateInfrastructure } from './generators/infrastructure/infra-generator.js';
import { generateExtensions } from './generators/extensions/ext-generator.js';
import * as log from './utils/logger.js';

/**
 * Main bootstrap orchestrator.
 *
 * @param {string} projectRoot - Absolute path to the project root
 * @param {{ yes?: boolean, force?: boolean, type?: string, teams?: string[] }} options
 */
export async function bootstrap(projectRoot, options = {}) {
  const startTime = Date.now();

  log.header('pi-org-bootstrap');

  // ── Phase 0: Pre-flight checks ─────────────────────
  log.step('0', 'Pre-flight checks');

  const piDir = join(projectRoot, '.pi');
  const agentsDir = join(projectRoot, '.agents');
  const bootstrapFile = join(piDir, 'bootstrap.json');

  const hasPi = await pathExists(piDir);
  const hasAgents = await pathExists(agentsDir);
  const hasBootstrap = await pathExists(bootstrapFile);

  if (hasPi && hasAgents && hasBootstrap && !options.force) {
    log.warn('Existing pi-org-bootstrap configuration found.');
    log.info('Run with --force to regenerate, or use `pi-org-bootstrap status` to inspect.');
    return;
  }

  if (hasPi || hasAgents) {
    if (options.force) {
      log.warn('Force mode — overwriting existing configuration');
    } else {
      log.info('Found existing .pi/ or .agents/ directories — will merge');
    }
  }

  log.success('Pre-flight checks passed');

  // ── Phase 1: Scan project → StackProfile ───────────
  const stackProfile = await scan(projectRoot);

  // ── Phase 2: Ask questions → UserConfig ────────────
  const userConfig = await prompt(stackProfile, options);

  // Normalize userConfig — handle multiselect results
  // Features can come as object { memory: true, ... } or needs normalization
  if (userConfig.features === undefined || typeof userConfig.features !== 'object') {
    userConfig.features = {
      memory: true,
      contextBus: true,
      smartDispatcher: true,
      releaseChain: true,
      tmuxControl: true,
      uxDesignChain: false,
      brainWiki: false,
      securityOfficer: true,
    };
  }

  // Normalize cicd from display text
  if (typeof userConfig.cicd === 'string') {
    if (userConfig.cicd.includes('GitHub')) userConfig.cicd = 'github';
    else if (userConfig.cicd.includes('GitLab')) userConfig.cicd = 'gitlab';
    else userConfig.cicd = 'none';
  }

  // Normalize interactionMode
  if (typeof userConfig.interactionMode === 'string') {
    if (userConfig.interactionMode.includes('Head agent')) userConfig.interactionMode = 'head-agent';
    else if (userConfig.interactionMode.includes('Direct')) userConfig.interactionMode = 'direct';
    else userConfig.interactionMode = 'both';
  }

  log.step('2', 'Configuration complete');
  log.bullet(`Project type: ${userConfig.projectType}`);
  log.bullet(`Interaction mode: ${userConfig.interactionMode}`);
  log.bullet(`Features: ${Object.entries(userConfig.features).filter(([, v]) => v).map(([k]) => k).join(', ')}`);

  // ── Phase 3: Build roles → Role[] ──────────────────
  log.step('3', 'Building agent roles');
  const roles = buildRoles(stackProfile, userConfig);
  log.success(`${roles.length} roles generated:`);
  for (const role of roles) {
    log.bullet(`${role.name} (${role.category})`);
  }

  // ── Phase 4: Generate files ─────────────────────────
  log.step('4', 'Generating files');

  const generatedFiles = [];

  // 4.1 Agent definitions
  const agentFiles = await generateAgents(projectRoot, roles, stackProfile, userConfig);
  generatedFiles.push(...agentFiles);

  // 4.2 ORGANIZATION.md
  const orgFile = await generateOrganization(projectRoot, roles, stackProfile, userConfig);
  generatedFiles.push(orgFile);

  // 4.3 AGENTS.md
  const agentsMdFile = await generateAgentsMd(projectRoot, roles, stackProfile, userConfig);
  generatedFiles.push(agentsMdFile);

  // 4.4 Infrastructure (.agents/)
  const infraFiles = await generateInfrastructure(projectRoot, roles, userConfig);
  generatedFiles.push(...infraFiles);

  // 4.5 Extensions
  const extFiles = await generateExtensions(projectRoot, roles, userConfig);
  generatedFiles.push(...extFiles);

  // ── Phase 5: Write bootstrap.json ──────────────────
  log.step('5', 'Writing bootstrap configuration');

  await ensureDir(piDir);

  const bootstrapConfig = {
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    bootstrapVersion: '0.1.0',

    scan: {
      languages: stackProfile.languages.map((l) => l.name),
      frameworks: stackProfile.frameworks.map((f) => f.name),
      structure: stackProfile.structure.type,
      databases: stackProfile.databases.map((d) => d.type),
      packageManager: stackProfile.packageManager,
      gitHosting: stackProfile.gitHosting,
    },

    config: {
      projectType: userConfig.projectType,
      teamStructure: userConfig.teamStructure,
      interactionMode: userConfig.interactionMode,
      features: userConfig.features,
      security: userConfig.security,
      cicd: userConfig.cicd,
    },

    generated: {
      agents: roles.map((r) => ({
        name: r.name,
        category: r.category,
        template: r.isUniversal ? r.name : 'team-agent',
        path: `.pi/agents/${r.name}.md`,
      })),
      files: generatedFiles,
    },
  };

  await writeJSON(join(piDir, 'bootstrap.json'), bootstrapConfig);
  log.success('bootstrap.json → .pi/bootstrap.json');

  // ── Summary ─────────────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log.header('Bootstrap Complete');
  log.success(`${roles.length} agents generated in ${elapsed}s`);
  log.bullet(`${generatedFiles.length} files created`);
  log.bullet(`Domains: ${stackProfile.domains.map((d) => d.name).join(', ')}`);
  log.newline();
  log.info('Next steps:');
  log.bullet('Review your agents in .pi/agents/');
  log.bullet('Review AGENTS.md in your project root');
  log.bullet('Start pi and your agent organization is ready!');
  log.newline();
}
