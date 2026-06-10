import { join } from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import * as nodeDetector from './detectors/node.js';
import * as pythonDetector from './detectors/python.js';
import * as dockerDetector from './detectors/docker.js';
import * as ciDetector from './detectors/ci.js';
import { analyze } from './analyzer.js';
import * as log from '../utils/logger.js';

/**
 * Scan a project directory and produce a StackProfile.
 *
 * @param {string} projectRoot - Absolute path to the project root
 * @returns {Promise<import('../config/schema.js').StackProfile>}
 */
export async function scan(projectRoot) {
  log.step('1', 'Scanning project stack...');

  // Run all detectors in parallel
  const [nodeResult, pythonResult, dockerResult, ciResult] = await Promise.all([
    nodeDetector.detect(projectRoot),
    pythonDetector.detect(projectRoot),
    dockerDetector.detect(projectRoot),
    ciDetector.detect(projectRoot),
  ]);

  // Log detection results
  if (nodeResult.detected) {
    log.bullet(`Node.js: ${nodeResult.frameworks.map((f) => f.name).join(', ') || 'detected'}`);
  }
  if (pythonResult.detected) {
    log.bullet(`Python: ${pythonResult.frameworks.map((f) => f.name).join(', ') || 'detected'}`);
  }
  if (dockerResult.detected) {
    log.bullet(`Docker: ${dockerResult.services.length} service(s)`);
  }
  if (ciResult.detected) {
    log.bullet(`CI: ${ciResult.provider} (${ciResult.stages.length} stages)`);
  }

  // List top-level directories for structure analysis
  const directories = await listTopLevelDirs(projectRoot);

  // Combine into StackProfile
  const profile = await analyze(projectRoot, {
    node: nodeResult,
    python: pythonResult,
    docker: dockerResult,
    ci: ciResult,
    directories,
  });

  // Detect empty / greenfield project
  if (profile.languages.length === 0 && profile.frameworks.length === 0) {
    profile.isEmptyProject = true;
  }

  // Stash projectRoot for interview mode
  profile._projectRoot = projectRoot;

  if (profile.isEmptyProject) {
    log.info('No existing tech stack detected — empty / greenfield project');
  } else {
    log.success(`Stack detected: ${profile.languages.map((l) => l.name).join(', ')}`);
    log.bullet(`Frameworks: ${profile.frameworks.map((f) => f.name).join(', ') || 'none'}`);
  }
  log.bullet(`Structure: ${profile.structure.type}`);

  return profile;
}

/**
 * List top-level directories with basic metadata
 */
async function listTopLevelDirs(projectRoot) {
  const entries = await readdir(projectRoot);
  const dirs = [];

  for (const entry of entries) {
    if (entry.startsWith('.') && entry !== '.github') continue;
    const fullPath = join(projectRoot, entry);
    try {
      const s = await stat(fullPath);
      if (s.isDirectory()) {
        dirs.push(entry);
      }
    } catch {
      // skip inaccessible
    }
  }

  return dirs;
}
