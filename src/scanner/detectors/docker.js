import { join } from 'node:path';
import { pathExists, readText } from '../../utils/fs.js';

/**
 * Detect Docker setup from Dockerfile, docker-compose.yml, etc.
 */
export async function detect(projectRoot) {
  const result = {
    detected: false,
    services: [],
    hasCompose: false,
    hasDockerfile: false,
    evidence: [],
  };

  // Check for Dockerfile
  const dockerfilePaths = ['Dockerfile', 'Dockerfile.dev', 'Dockerfile.prod'];
  for (const df of dockerfilePaths) {
    if (await pathExists(join(projectRoot, df))) {
      result.hasDockerfile = true;
      result.detected = true;
      result.evidence.push(df);
    }
  }

  // Also check subdirectory Dockerfiles (e.g., backend/Dockerfile)
  const commonSubdirs = ['backend', 'frontend', 'api', 'web', 'server', 'client', 'docker'];
  for (const sub of commonSubdirs) {
    if (await pathExists(join(projectRoot, sub, 'Dockerfile'))) {
      result.detected = true;
      result.evidence.push(`${sub}/Dockerfile`);
    }
  }

  // Check for docker-compose files
  const composeFiles = [
    'docker-compose.yml',
    'docker-compose.yaml',
    'docker-compose.dev.yml',
    'docker-compose.prod.yml',
    'compose.yml',
    'compose.yaml',
  ];

  for (const cf of composeFiles) {
    const fullPath = join(projectRoot, cf);
    if (await pathExists(fullPath)) {
      result.hasCompose = true;
      result.detected = true;
      result.evidence.push(cf);

      // Parse services from compose file
      try {
        const content = await readText(fullPath);
        const services = parseComposeServices(content);
        result.services.push(...services);
      } catch {
        // If parse fails, still detected but no service details
      }
    }
  }

  return result;
}

/**
 * Basic docker-compose service extraction.
 * Handles simple `services:` → `service-name:` patterns.
 * No YAML parser dependency.
 */
function parseComposeServices(content) {
  const services = [];
  const lines = content.split('\n');
  let inServices = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect services section
    if (/^services\s*:/.test(trimmed)) {
      inServices = true;
      continue;
    }

    // Exit services section on next top-level key
    if (inServices && /^[a-z]/.test(line) && !line.startsWith(' ') && !line.startsWith('\t')) {
      if (!trimmed.startsWith('services')) {
        inServices = false;
        continue;
      }
    }

    // Match service names (2-space indent, name:)
    if (inServices && /^\s{2}(\w[\w-]*)\s*:/.test(line)) {
      const match = line.match(/^\s{2}(\w[\w-]*)\s*:/);
      if (match) {
        const name = match[1];
        // Skip common non-service keys
        if (!['version', 'include', 'extends', 'profiles'].includes(name)) {
          services.push({ name, inferred: inferServiceType(name) });
        }
      }
    }
  }

  return services;
}

function inferServiceType(name) {
  const lower = name.toLowerCase();
  if (lower.includes('db') || lower.includes('postgres') || lower.includes('mysql') || lower.includes('mongo') || lower.includes('redis')) return 'database';
  if (lower.includes('api') || lower.includes('server') || lower.includes('backend')) return 'backend';
  if (lower.includes('web') || lower.includes('frontend') || lower.includes('client') || lower.includes('app')) return 'frontend';
  if (lower.includes('worker') || lower.includes('queue') || lower.includes('job')) return 'worker';
  if (lower.includes('nginx') || lower.includes('proxy') || lower.includes('caddy')) return 'proxy';
  return 'service';
}
