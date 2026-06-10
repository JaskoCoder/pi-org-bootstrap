import * as readline from 'node:readline';
import { basename } from 'node:path';
import * as log from '../utils/logger.js';

/**
 * Interview-style onboarding for greenfield / empty projects.
 *
 * Feels like a conversation with a technical co-founder — each question
 * builds on the previous answers.  Thorough but not tedious.
 *
 * @param {import('../config/schema.js').StackProfile} stackProfile
 * @param {{ yes?: boolean }} options
 * @returns {Promise<{ stackProfile: import('../config/schema.js').StackProfile, userConfig: import('../config/schema.js').UserConfig }>}
 */
export async function interview(stackProfile, options = {}) {
  const dirName = basename(stackProfile._projectRoot || process.cwd());

  log.header('Interview Mode');
  console.log('  No existing codebase found — let\'s design your project from scratch!');
  console.log('  I\'ll ask you a few questions and build the perfect agent organization.\n');

  const a = {}; // interview answers accumulator

  // ── Phase A: Vision ────────────────────────────────────
  log.step('A', 'Vision — What are you building?\n');

  a.projectDescription = await askInput(
    'Describe your project in a few sentences',
    null,
    'A web application that helps users manage their tasks',
  );
  console.log('');  // breathing room

  a.projectType = await askSelect(
    'What type of project is this?',
    [
      'Full-stack web application',
      'API / backend service',
      'Mobile app',
      'Data pipeline / ML platform',
      'Desktop application',
      'CLI / developer tool',
      'Library / package',
      'Something else',
    ],
    'Full-stack web application',
  );
  console.log('');

  a.projectName = await askInput('Project name', null, dirName);
  console.log('');

  // ── Phase B: Tech Stack ────────────────────────────────
  log.step('B', 'Tech Stack — What technologies will you use?\n');

  a.languages = await askMultiSelect(
    'Languages (comma-separated numbers)',
    [
      'TypeScript / JavaScript',
      'Python',
      'Rust',
      'Go',
      'Java',
      'Ruby',
      'C#',
      'Other',
    ],
    ['TypeScript / JavaScript'],
  );
  console.log('');

  const hasTS = a.languages['TypeScript / JavaScript'];
  const hasPython = a.languages['Python'];

  // Frontend framework (if TS/JS)
  if (hasTS) {
    a.frontendFramework = await askSelect(
      'Frontend framework?',
      ['Next.js', 'React', 'Vue', 'Svelte', 'Angular', 'Nuxt', 'None'],
      'Next.js',
    );
    console.log('');

    a.backendFramework = await askSelect(
      'Backend framework?',
      ['Express', 'NestJS', 'Fastify', 'Hono', 'tRPC', 'None'],
      'Express',
    );
    console.log('');
  }

  // Python framework
  if (hasPython) {
    a.pythonFramework = await askSelect(
      'Python web framework?',
      ['Django', 'Flask', 'FastAPI', 'None'],
      'FastAPI',
    );
    console.log('');
  }

  a.database = await askSelect(
    'Database?',
    ['PostgreSQL', 'MySQL', 'SQLite', 'MongoDB', 'Redis', 'DynamoDB', 'None'],
    'PostgreSQL',
  );
  console.log('');

  a.orm = await askSelect(
    'ORM / database tool?',
    ['Prisma', 'Drizzle', 'TypeORM', 'SQLAlchemy', 'GORM', 'None'],
    'Prisma',
  );
  console.log('');

  if (hasTS) {
    a.styling = await askSelect(
      'Styling?',
      ['Tailwind CSS', 'CSS Modules', 'Styled Components', 'None'],
      'Tailwind CSS',
    );
    console.log('');
  }

  a.docker = await askConfirm('Will you use Docker?', true);
  console.log('');

  a.cicdPlatform = await askSelect(
    'CI/CD platform?',
    ['GitHub Actions', 'GitLab CI', 'CircleCI', 'Jenkins', 'None'],
    'GitHub Actions',
  );
  console.log('');

  // ── Phase C: Team & Roles ──────────────────────────────
  log.step('C', 'Team & Roles — How is your project structured?\n');

  a.projectStructure = await askSelect(
    'How is your project structured?',
    [
      'Monorepo (frontend/ + backend/ in one repo)',
      'Single frontend app',
      'Single backend service',
      'Microservices (multiple services/)',
      'Custom layout (I\'ll describe it)',
    ],
    'Monorepo (frontend/ + backend/ in one repo)',
  );
  console.log('');

  // Monorepo directory layout
  if (a.projectStructure.startsWith('Monorepo')) {
    a.monorepoDirs = await askSelect(
      'Main directories?',
      [
        'frontend/, backend/, shared/',
        'client/, server/',
        'web/, api/',
        'Custom (I\'ll specify)',
      ],
      'frontend/, backend/, shared/',
    );
    console.log('');
  }

  // Microservices
  if (a.projectStructure.startsWith('Microservices')) {
    a.microserviceCount = await askSelect(
      'How many services?',
      ['2-3', '4-6', '7+'],
      '2-3',
    );
    console.log('');
  }

  a.specializedDomains = await askMultiSelect(
    'Specialized domains beyond frontend/backend/infra?',
    [
      'AI/ML integration',
      'Mobile app',
      'Data pipelines / ETL',
      'DevOps / infrastructure',
      'Real-time / WebSockets',
      'Background jobs / queues',
      'None — just the basics',
    ],
    [],
  );
  console.log('');

  // ── Phase D: Workflow ──────────────────────────────────
  log.step('D', 'Workflow — How do you want to work?\n');

  a.interactionMode = await askSelect(
    'How should agents interact with you?',
    [
      'Head agent mode — I talk to an orchestrator who delegates to teams',
      'Direct mode — I talk to agents directly',
      'Both — orchestrator + direct access',
    ],
    'Head agent mode — I talk to an orchestrator who delegates to teams',
  );
  console.log('');

  a.tracking = await askSelect(
    'How do you want to track bugs and features?',
    [
      'GitHub Issues + PRs (recommended)',
      'GitLab Issues',
      'Local tracking only',
    ],
    'GitHub Issues + PRs (recommended)',
  );
  console.log('');

  a.wantSecurityOfficer = await askConfirm('Do you want a security officer agent?', true);
  console.log('');

  a.codeReviewRequired = await askConfirm('Do you want code review requirements?', true);
  console.log('');

  // ── Phase E: Agent Capabilities ────────────────────────
  log.step('E', 'Agent Capabilities — Which features do you need?\n');

  a.features = await askMultiSelect(
    'Select agent features (comma-separated numbers)',
    [
      'Memory system (agents remember across sessions)',
      'Context bus (cross-agent awareness)',
      'Smart dispatcher (file-path-aware routing)',
      'Release chain (changelog → version → deploy → health check)',
      'Tmux control (parallel agent sessions)',
      'UX design chain (UI/UX research → design → evaluate)',
      'Brain wiki (Obsidian knowledge base)',
      'Autonomous debug loop (agents debug issues autonomously)',
    ],
    [
      'Memory system (agents remember across sessions)',
      'Context bus (cross-agent awareness)',
      'Smart dispatcher (file-path-aware routing)',
      'Release chain (changelog → version → deploy → health check)',
      'Tmux control (parallel agent sessions)',
    ],
  );
  console.log('');

  // ── Build synthetic StackProfile + UserConfig ──────────
  const enrichedProfile = buildProfileFromInterview(a, stackProfile);
  const userConfig = buildUserConfigFromInterview(a);

  log.divider();
  log.success('Interview complete! Here\'s what I\'ll set up for you:');
  log.bullet(`Project: ${a.projectName}`);
  log.bullet(`Type: ${a.projectType}`);
  log.bullet(`Languages: ${enrichedProfile.languages.map((l) => l.name).join(', ')}`);
  log.bullet(`Frameworks: ${enrichedProfile.frameworks.map((f) => f.name).join(', ')}`);
  log.bullet(`Structure: ${enrichedProfile.structure.type}`);
  log.bullet(`Domains: ${enrichedProfile.domains.map((d) => d.name).join(', ')}`);
  log.bullet(`Agents: ${userConfig.interactionMode} mode`);
  log.newline();

  return { stackProfile: enrichedProfile, userConfig, interview: a };
}

// ── Profile Builder ──────────────────────────────────────

/**
 * Convert interview answers into a synthetic StackProfile that produces
 * the same output as a real scan.
 */
export function buildProfileFromInterview(a, base) {
  const languages = [];
  const frameworks = [];

  // Languages
  if (a.languages['TypeScript / JavaScript']) {
    languages.push({ name: 'typescript', confidence: 0.95, evidence: ['Interview: user selected TypeScript/JavaScript'] });
    languages.push({ name: 'javascript', confidence: 0.85, evidence: ['Interview: user selected TypeScript/JavaScript'] });
  }
  if (a.languages['Python']) {
    languages.push({ name: 'python', confidence: 0.95, evidence: ['Interview: user selected Python'] });
  }
  if (a.languages['Rust']) {
    languages.push({ name: 'rust', confidence: 0.95, evidence: ['Interview: user selected Rust'] });
  }
  if (a.languages['Go']) {
    languages.push({ name: 'go', confidence: 0.95, evidence: ['Interview: user selected Go'] });
  }
  if (a.languages['Java']) {
    languages.push({ name: 'java', confidence: 0.95, evidence: ['Interview: user selected Java'] });
  }
  if (a.languages['Ruby']) {
    languages.push({ name: 'ruby', confidence: 0.95, evidence: ['Interview: user selected Ruby'] });
  }
  if (a.languages['C#']) {
    languages.push({ name: 'csharp', confidence: 0.95, evidence: ['Interview: user selected C#'] });
  }
  if (a.languages['Other']) {
    languages.push({ name: 'other', confidence: 0.5, evidence: ['Interview: user selected Other'] });
  }

  // Frontend frameworks
  if (a.frontendFramework && a.frontendFramework !== 'None') {
    const category = 'frontend';
    frameworks.push({ name: a.frontendFramework.toLowerCase(), category, evidence: [`Interview: user selected ${a.frontendFramework}`] });
  }

  // Backend frameworks
  if (a.backendFramework && a.backendFramework !== 'None') {
    frameworks.push({ name: a.backendFramework.toLowerCase(), category: 'backend', evidence: [`Interview: user selected ${a.backendFramework}`] });
  }

  if (a.pythonFramework && a.pythonFramework !== 'None') {
    frameworks.push({ name: a.pythonFramework.toLowerCase(), category: 'backend', evidence: [`Interview: user selected ${a.pythonFramework}`] });
  }

  // ORM
  if (a.orm && a.orm !== 'None') {
    frameworks.push({ name: a.orm.toLowerCase(), category: 'orm', evidence: [`Interview: user selected ${a.orm}`] });
  }

  // Styling
  if (a.styling && a.styling !== 'None') {
    const styleName = a.styling.toLowerCase().replace(/ /g, '-');
    frameworks.push({ name: styleName, category: 'styling', evidence: [`Interview: user selected ${a.styling}`] });
  }

  // Database
  const databases = [];
  if (a.database && a.database !== 'None') {
    databases.push({ type: a.database.toLowerCase(), evidence: [`Interview: user selected ${a.database}`] });
  }

  // Structure
  let structureType = 'single-app';
  const structureDirectories = [];

  if (a.projectStructure.startsWith('Monorepo')) {
    structureType = 'monorepo';
    if (a.monorepoDirs) {
      const dirs = a.monorepoDirs.split(',').map((d) => d.trim().replace('/', ''));
      for (const d of dirs) {
        structureDirectories.push({ path: `${d}/`, purpose: inferPurpose(d) });
      }
    } else {
      structureDirectories.push({ path: 'frontend/', purpose: 'frontend' });
      structureDirectories.push({ path: 'backend/', purpose: 'backend' });
    }
  } else if (a.projectStructure.startsWith('Microservices')) {
    structureType = 'microservices';
    const count = a.microserviceCount === '2-3' ? 3 : a.microserviceCount === '4-6' ? 5 : 7;
    for (let i = 0; i < count; i++) {
      structureDirectories.push({ path: `services/service-${i + 1}/`, purpose: 'backend' });
    }
  } else if (a.projectStructure.startsWith('Single frontend')) {
    structureType = 'single-app';
    structureDirectories.push({ path: 'src/', purpose: 'frontend' });
  } else if (a.projectStructure.startsWith('Single backend')) {
    structureType = 'single-app';
    structureDirectories.push({ path: 'src/', purpose: 'backend' });
  } else {
    structureType = 'single-app';
    structureDirectories.push({ path: 'src/', purpose: 'source' });
  }

  // Domains
  const domains = buildDomainsFromInterview(a, structureDirectories, frameworks);

  // CI/CD
  let ciProvider = null;
  if (a.cicdPlatform === 'GitHub Actions') ciProvider = 'github-actions';
  else if (a.cicdPlatform === 'GitLab CI') ciProvider = 'gitlab-ci';

  // Git hosting
  let gitProvider = 'unknown';
  if (a.tracking.includes('GitHub')) gitProvider = 'github';
  else if (a.tracking.includes('GitLab')) gitProvider = 'gitlab';

  return {
    ...base,
    isEmptyProject: false, // we've now populated it
    languages,
    frameworks,
    structure: {
      type: structureType,
      directories: structureDirectories,
      hasTests: false,
      testFrameworks: [],
      hasDocker: a.docker,
      hasCI: !!ciProvider,
      ciProvider,
    },
    databases,
    packageManager: a.languages['TypeScript / JavaScript'] ? 'npm' : a.languages['Python'] ? 'pip' : null,
    gitHosting: { provider: gitProvider, owner: null, repo: a.projectName },
    domains,
  };
}

/**
 * Build domains from interview answers.
 */
function buildDomainsFromInterview(a, structureDirectories, frameworks) {
  const domains = [];
  const seen = new Set();

  // Domains from structure
  for (const dir of structureDirectories) {
    const domain = purposeToDomain(dir.purpose);
    if (domain && !seen.has(domain)) {
      seen.add(domain);
      domains.push({
        name: domain,
        paths: [dir.path],
        frameworks: frameworks
          .filter((f) => {
            if (domain === 'frontend') return ['frontend', 'styling'].includes(f.category);
            if (domain === 'backend') return ['backend', 'orm'].includes(f.category);
            return false;
          })
          .map((f) => f.name),
      });
    }
  }

  // Specialized domains
  if (a.specializedDomains['AI/ML integration'] && !seen.has('ai-ml')) {
    domains.push({ name: 'ai-ml', paths: ['ai/'], frameworks: [] });
  }
  if (a.specializedDomains['Mobile app'] && !seen.has('mobile')) {
    domains.push({ name: 'mobile', paths: ['mobile/'], frameworks: [] });
  }
  if (a.specializedDomains['Data pipelines / ETL'] && !seen.has('data')) {
    domains.push({ name: 'data', paths: ['data/'], frameworks: [] });
  }
  if (a.specializedDomains['DevOps / infrastructure'] || a.docker) {
    if (!seen.has('infrastructure')) {
      domains.push({ name: 'infrastructure', paths: ['.github/', 'docker/'], frameworks: [] });
    }
  }

  // If no domains at all, create dev-team
  if (domains.length === 0) {
    domains.push({ name: 'dev', paths: ['src/'], frameworks: [] });
  }

  // If only one domain, rename to dev
  if (domains.length === 1) {
    domains[0].name = 'dev';
  }

  return domains;
}

/**
 * Build UserConfig from interview answers.
 */
function buildUserConfigFromInterview(a) {
  // Normalize project type
  let projectType = 'fullstack-web';
  if (a.projectType.includes('API') || a.projectType.includes('backend')) projectType = 'api';
  else if (a.projectType.includes('Mobile')) projectType = 'mobile';
  else if (a.projectType.includes('Data') || a.projectType.includes('ML')) projectType = 'data-ml';
  else if (a.projectType.includes('Desktop')) projectType = 'desktop';
  else if (a.projectType.includes('CLI') || a.projectType.includes('developer')) projectType = 'cli';
  else if (a.projectType.includes('Library')) projectType = 'library';

  // Normalize interaction mode
  let interactionMode = 'head-agent';
  if (a.interactionMode.includes('Direct')) interactionMode = 'direct';
  else if (a.interactionMode.includes('Both')) interactionMode = 'both';

  // Normalize cicd
  let cicd = 'github';
  if (a.tracking.includes('GitLab')) cicd = 'gitlab';
  else if (a.tracking.includes('Local')) cicd = 'none';

  // Normalize features
  const features = {
    memory: !!a.features['Memory system (agents remember across sessions)'],
    contextBus: !!a.features['Context bus (cross-agent awareness)'],
    smartDispatcher: !!a.features['Smart dispatcher (file-path-aware routing)'],
    releaseChain: !!a.features['Release chain (changelog → version → deploy → health check)'],
    tmuxControl: !!a.features['Tmux control (parallel agent sessions)'],
    uxDesignChain: !!a.features['UX design chain (UI/UX research → design → evaluate)'],
    brainWiki: !!a.features['Brain wiki (Obsidian knowledge base)'],
    securityOfficer: a.wantSecurityOfficer,
  };

  return {
    projectType,
    teamStructure: 'interview',
    customTeams: [],
    features,
    security: { securityOfficer: a.wantSecurityOfficer },
    cicd,
    interactionMode,
    codeReviewRequired: a.codeReviewRequired,
  };
}

// ── Helpers ──────────────────────────────────────────────

function purposeToDomain(purpose) {
  const map = {
    frontend: 'frontend',
    backend: 'backend',
    infrastructure: 'infrastructure',
    mobile: 'mobile',
    'ai-ml': 'ai-ml',
    data: 'data',
    source: null, // depends on context
  };
  return map[purpose] || null;
}

function inferPurpose(dirName) {
  const lower = dirName.toLowerCase();
  const purposeMap = {
    frontend: 'frontend',
    client: 'frontend',
    web: 'frontend',
    app: 'frontend',
    backend: 'backend',
    server: 'backend',
    api: 'backend',
    shared: 'shared',
    infra: 'infrastructure',
    deploy: 'infrastructure',
    docker: 'infrastructure',
    mobile: 'mobile',
    ai: 'ai-ml',
    ml: 'ai-ml',
    data: 'data',
  };
  return purposeMap[lower] || 'other';
}

// ── readline prompt helpers ──────────────────────────────

function createRL() {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}

async function askSelect(message, choices, defaultVal) {
  const rl = createRL();
  try {
    return await new Promise((resolve) => {
      console.log(`${log.colorize('bright', `? ${message}`)}`);
      choices.forEach((c, i) => {
        const marker = c === defaultVal ? '>' : ' ';
        console.log(`  ${marker} ${i + 1}. ${c}`);
      });

      const defaultIdx = choices.indexOf(defaultVal) + 1;
      rl.question(`  Enter number [${defaultIdx}]: `, (answer) => {
        const num = parseInt(answer.trim(), 10);
        if (num >= 1 && num <= choices.length) {
          resolve(choices[num - 1]);
        } else {
          resolve(defaultVal);
        }
      });
    });
  } finally {
    rl.close();
  }
}

async function askMultiSelect(message, choices, defaultChecked) {
  const rl = createRL();
  try {
    return await new Promise((resolve) => {
      console.log(`\n${log.colorize('bright', `? ${message}`)}`);

      choices.forEach((c, i) => {
        const isChecked = defaultChecked.includes(c);
        const marker = isChecked ? '✓' : '○';
        console.log(`  ${marker} ${i + 1}. ${c}`);
      });

      const defaultNums = choices
        .map((c, i) => (defaultChecked.includes(c) ? i + 1 : null))
        .filter(Boolean)
        .join(',');

      rl.question(`  Select [${defaultNums}]: `, (answer) => {
        const input = answer.trim();
        if (!input) {
          const result = {};
          choices.forEach((c) => {
            result[c] = defaultChecked.includes(c);
          });
          resolve(result);
          return;
        }

        const selected = new Set(
          input.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => n >= 1 && n <= choices.length),
        );

        const result = {};
        choices.forEach((c, i) => {
          result[c] = selected.has(i + 1);
        });
        resolve(result);
      });
    });
  } finally {
    rl.close();
  }
}

async function askConfirm(message, defaultVal) {
  const rl = createRL();
  try {
    return await new Promise((resolve) => {
      const defaultStr = defaultVal ? 'Y/n' : 'y/N';
      rl.question(`? ${message} [${defaultStr}]: `, (answer) => {
        const lower = answer.trim().toLowerCase();
        if (lower === 'y' || lower === 'yes') resolve(true);
        else if (lower === 'n' || lower === 'no') resolve(false);
        else resolve(defaultVal);
      });
    });
  } finally {
    rl.close();
  }
}

async function askInput(message, defaultVal, placeholder) {
  const rl = createRL();
  try {
    return await new Promise((resolve) => {
      const prompt = defaultVal
        ? `? ${message} [${defaultVal}]: `
        : placeholder
          ? `? ${message}: `
          : `? ${message}: `;

      if (placeholder && !defaultVal) {
        console.log(`${log.colorize('dim', `  (${placeholder})`)}`);
      }

      rl.question(prompt, (answer) => {
        resolve(answer.trim() || defaultVal || '');
      });
    });
  } finally {
    rl.close();
  }
}
