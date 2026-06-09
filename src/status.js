import { join } from 'node:path';
import { pathExists, readJSON } from './utils/fs.js';
import * as log from './utils/logger.js';

/**
 * Show bootstrap status.
 */
export async function showStatus(projectRoot) {
  const bootstrapPath = join(projectRoot, '.pi', 'bootstrap.json');

  if (!(await pathExists(bootstrapPath))) {
    log.warn('No bootstrap configuration found.');
    log.info('Run `npx pi-org-bootstrap init` to get started.');
    return;
  }

  const config = await readJSON(bootstrapPath);

  log.header('pi-org-bootstrap status');
  log.bullet(`Bootstrapped: ${config.generatedAt}`);
  log.bullet(`Bootstrap version: ${config.bootstrapVersion}`);
  log.newline();

  // Agents
  const agents = config.generated?.agents || [];
  log.info(`Agents (${agents.length}):`);
  for (const agent of agents) {
    const tag = agent.category === 'build-team' ? 'stack-detected' : agent.category;
    log.bullet(`${agent.name} (${tag})`);
  }
  log.newline();

  // Scan info
  const scan = config.scan || {};
  log.info('Detected stack:');
  log.bullet(`Languages: ${(scan.languages || []).join(', ') || 'unknown'}`);
  log.bullet(`Frameworks: ${(scan.frameworks || []).join(', ') || 'none'}`);
  log.bullet(`Structure: ${scan.structure || 'unknown'}`);
  log.bullet(`Databases: ${(scan.databases || []).join(', ') || 'none'}`);

  // Files
  const files = config.generated?.files || [];
  log.newline();
  log.info(`Generated files (${files.length}):`);
  for (const file of files) {
    log.bullet(file);
  }
}
