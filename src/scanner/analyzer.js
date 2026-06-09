import { join } from 'node:path';
import { pathExists, isDirectory } from '../utils/fs.js';

/**
 * Combine all detector outputs into a StackProfile.
 *
 * @param {string} projectRoot
 * @param {{ node: object, python: object, docker: object, ci: object, directories: string[] }} results
 * @returns {import('../config/schema.js').StackProfile}
 */
export async function analyze(projectRoot, results) {
  const { node, python, docker, ci, directories } = results;

  // ── Languages ──────────────────────────────────────────
  const languages = [];

  if (node.detected) {
    for (const lang of node.languages) {
      languages.push({
        name: lang,
        confidence: lang === 'typescript' && node.hasTypeScript ? 0.95 : 0.85,
        evidence: node.evidence,
      });
    }
  }

  if (python.detected) {
    languages.push({
      name: 'python',
      confidence: 0.9,
      evidence: python.evidence,
    });
  }

  // Sort by confidence descending
  languages.sort((a, b) => b.confidence - a.confidence);

  // ── Frameworks (merged from all detectors) ─────────────
  const frameworks = [
    ...node.frameworks,
    ...python.frameworks,
  ];

  // ── Project structure ──────────────────────────────────
  const structure = inferStructure(projectRoot, directories, node, frameworks);

  // ── Databases ──────────────────────────────────────────
  const databases = inferDatabases(frameworks, docker);

  // ── Package manager ────────────────────────────────────
  const packageManager = node.packageManager || (python.detected ? 'pip' : null);

  // ── Git hosting ────────────────────────────────────────
  const gitHosting = await inferGitHosting(projectRoot);

  // ── Domains (inferred from directories + frameworks) ───
  const domains = inferDomains(projectRoot, directories, frameworks, structure);

  return {
    languages,
    frameworks,
    structure,
    databases,
    packageManager,
    gitHosting,
    domains,
    raw: { node, python, docker, ci },
  };
}

/**
 * Infer project structure type
 */
function inferStructure(projectRoot, directories, node, frameworks) {
  const hasTests = directories.includes('tests') || directories.includes('test') || directories.includes('__tests__');
  const hasDocker = directories.includes('docker') || directories.includes('Docker');
  const hasCI = directories.includes('.github');

  // Detect test frameworks
  const testFrameworks = node.testFrameworks || [];

  // Check for monorepo indicators
  const workspaceIndicators = ['packages', 'apps', 'libs', 'modules', 'services'];
  const isMonorepo = directories.some((d) => workspaceIndicators.includes(d));

  // Check for common split patterns
  const hasFrontend = directories.includes('frontend') || directories.includes('client') || directories.includes('web');
  const hasBackend = directories.includes('backend') || directories.includes('server') || directories.includes('api');

  let type = 'single-app';
  if (isMonorepo) {
    type = 'monorepo';
  } else if (hasFrontend && hasBackend) {
    type = 'monorepo';
  } else if (directories.includes('services')) {
    type = 'microservices';
  }

  // Build directory purpose map
  const dirWithPurpose = directories.map((d) => ({
    path: d,
    purpose: inferDirectoryPurpose(d, frameworks),
  }));

  return {
    type,
    directories: dirWithPurpose,
    hasTests,
    testFrameworks,
    hasDocker,
    hasCI,
    ciProvider: hasCI ? 'github-actions' : null,
  };
}

/**
 * Map directory name to purpose
 */
function inferDirectoryPurpose(dir, frameworks) {
  const lower = dir.toLowerCase();
  const purposeMap = {
    frontend: 'frontend',
    client: 'frontend',
    web: 'frontend',
    app: 'frontend',
    backend: 'backend',
    server: 'backend',
    api: 'backend',
    infra: 'infrastructure',
    deploy: 'infrastructure',
    docker: 'infrastructure',
    '.github': 'infrastructure',
    scripts: 'tooling',
    docs: 'documentation',
    tests: 'testing',
    test: 'testing',
    __tests__: 'testing',
    shared: 'shared',
    packages: 'workspace',
    apps: 'workspace',
    libs: 'workspace',
    services: 'microservices',
    modules: 'workspace',
    tambo: 'ai-ml',
    rag: 'ai-ml',
    ml: 'ai-ml',
    ai: 'ai-ml',
    models: 'database',
    workers: 'background-jobs',
    mobile: 'mobile',
    data: 'data',
    pipelines: 'data',
    src: 'source',
  };
  return purposeMap[lower] || 'other';
}

/**
 * Detect databases from frameworks and Docker services
 */
function inferDatabases(frameworks, docker) {
  const databases = [];
  const frameworkNames = frameworks.map((f) => f.name);

  if (frameworkNames.includes('prisma') || frameworkNames.includes('typeorm') || frameworkNames.includes('sequelize')) {
    databases.push({ type: 'postgresql', evidence: ['ORM detected (likely PostgreSQL)'] });
  }

  if (frameworkNames.includes('mongoose')) {
    databases.push({ type: 'mongodb', evidence: ['Mongoose detected'] });
  }

  if (frameworkNames.includes('drizzle')) {
    databases.push({ type: 'postgresql', evidence: ['Drizzle detected (likely PostgreSQL)'] });
  }

  // Check Docker services for databases
  if (docker?.services) {
    for (const svc of docker.services) {
      if (svc.inferred === 'database') {
        const dbType = mapServiceNameToDb(svc.name);
        if (dbType && !databases.find((d) => d.type === dbType)) {
          databases.push({ type: dbType, evidence: [`docker-compose service: ${svc.name}`] });
        }
      }
    }
  }

  return databases;
}

function mapServiceNameToDb(name) {
  const lower = name.toLowerCase();
  if (lower.includes('postgres') || lower.includes('pg')) return 'postgresql';
  if (lower.includes('mysql')) return 'mysql';
  if (lower.includes('mongo')) return 'mongodb';
  if (lower.includes('redis')) return 'redis';
  if (lower.includes('maria')) return 'mariadb';
  if (lower.includes('sqlite')) return 'sqlite';
  return null;
}

/**
 * Detect git hosting provider
 */
async function inferGitHosting(projectRoot) {
  try {
    const { execSync } = await import('node:child_process');
    const remote = execSync('git remote get-url origin 2>/dev/null', { cwd: projectRoot, encoding: 'utf-8' }).trim();

    if (remote.includes('github.com')) {
      const match = remote.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
      if (match) {
        return { provider: 'github', owner: match[1], repo: match[2] };
      }
      return { provider: 'github', owner: null, repo: null };
    }

    if (remote.includes('gitlab.com')) {
      return { provider: 'gitlab', owner: null, repo: null };
    }

    if (remote.includes('bitbucket.org')) {
      return { provider: 'bitbucket', owner: null, repo: null };
    }
  } catch {
    // not a git repo or no remote
  }

  return { provider: 'unknown', owner: null, repo: null };
}

/**
 * Infer team domains from directories + frameworks
 */
function inferDomains(projectRoot, directories, frameworks, structure) {
  const domains = [];
  const fwNames = frameworks.map((f) => f.name);
  const fwCategories = frameworks.map((f) => f.category);

  // Map directory purposes to domains
  const purposeToDomain = {
    frontend: 'frontend',
    backend: 'backend',
    'ai-ml': 'ai-ml',
    mobile: 'mobile',
    infrastructure: 'infrastructure',
    data: 'data',
    microservices: 'infrastructure',
    'background-jobs': 'backend', // merged with backend
  };

  const seenDomains = new Set();

  for (const dir of structure.directories) {
    const domain = purposeToDomain[dir.purpose];
    if (domain && !seenDomains.has(domain)) {
      seenDomains.add(domain);
      domains.push({
        name: domain,
        paths: [`${dir.path}/`],
        frameworks: frameworks.filter((f) => {
          if (domain === 'frontend') return ['frontend', 'styling'].includes(f.category);
          if (domain === 'backend') return ['backend', 'orm', 'jobs'].includes(f.category);
          if (domain === 'ai-ml') return f.category === 'ai';
          return false;
        }).map((f) => f.name),
      });
    }
  }

  // If no domains detected but we have frameworks, create domains from those
  if (domains.length === 0) {
    if (fwCategories.includes('frontend') || fwCategories.includes('styling')) {
      domains.push({
        name: 'frontend',
        paths: ['src/'],
        frameworks: frameworks.filter((f) => ['frontend', 'styling'].includes(f.category)).map((f) => f.name),
      });
    }
    if (fwCategories.includes('backend') || fwCategories.includes('orm')) {
      domains.push({
        name: 'backend',
        paths: ['src/'],
        frameworks: frameworks.filter((f) => ['backend', 'orm', 'jobs'].includes(f.category)).map((f) => f.name),
      });
    }
    if (fwCategories.includes('ai')) {
      domains.push({
        name: 'ai-ml',
        paths: [],
        frameworks: frameworks.filter((f) => f.category === 'ai').map((f) => f.name),
      });
    }
  }

  // If still no domains, create a single dev-team
  if (domains.length === 0) {
    domains.push({
      name: 'dev',
      paths: ['src/'],
      frameworks: [],
    });
  }

  // If only one domain, rename to dev-team
  if (domains.length === 1) {
    domains[0].name = 'dev';
  }

  return domains;
}
