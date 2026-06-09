import { join } from 'node:path';
import { pathExists, readText } from '../../utils/fs.js';

/**
 * Detect Python stack from requirements.txt, pyproject.toml, etc.
 */
export async function detect(projectRoot) {
  const result = {
    detected: false,
    runtime: null,
    frameworks: [],
    testFrameworks: [],
    evidence: [],
  };

  // Check for Python project files
  const indicators = [
    'requirements.txt',
    'pyproject.toml',
    'setup.py',
    'Pipfile',
    'poetry.lock',
    'setup.cfg',
  ];

  let found = false;
  for (const indicator of indicators) {
    if (await pathExists(join(projectRoot, indicator))) {
      found = true;
      result.evidence.push(indicator);
    }
  }

  if (!found) return result;

  result.detected = true;
  result.runtime = 'python3';

  // Parse requirements.txt
  const reqPath = join(projectRoot, 'requirements.txt');
  if (await pathExists(reqPath)) {
    const content = await readText(reqPath);
    parseRequirements(content, result);
  }

  // Parse pyproject.toml (basic — no TOML parser dependency)
  const pyprojectPath = join(projectRoot, 'pyproject.toml');
  if (await pathExists(pyprojectPath)) {
    const content = await readText(pyprojectPath);
    parsePyproject(content, result);
  }

  return result;
}

const FRAMEWORK_MAP = {
  // Web frameworks
  django: { name: 'django', category: 'backend' },
  flask: { name: 'flask', category: 'backend' },
  fastapi: { name: 'fastapi', category: 'backend' },
  starlette: { name: 'starlette', category: 'backend' },
  sanic: { name: 'sanic', category: 'backend' },
  aiohttp: { name: 'aiohttp', category: 'backend' },

  // ORM
  sqlalchemy: { name: 'sqlalchemy', category: 'orm' },
  'django-orm': { name: 'django-orm', category: 'orm' },
  tortoise: { name: 'tortoise-orm', category: 'orm' },

  // Data / ML
  pandas: { name: 'pandas', category: 'data' },
  numpy: { name: 'numpy', category: 'data' },
  torch: { name: 'pytorch', category: 'ml' },
  pytorch: { name: 'pytorch', category: 'ml' },
  tensorflow: { name: 'tensorflow', category: 'ml' },
  scikit: { name: 'scikit-learn', category: 'ml' },
  'scikit-learn': { name: 'scikit-learn', category: 'ml' },

  // Testing
  pytest: { name: 'pytest', category: 'testing' },
  unittest: { name: 'unittest', category: 'testing' },
};

function parseRequirements(content, result) {
  const lines = content.split('\n').map((l) => l.trim().toLowerCase());
  for (const line of lines) {
    if (!line || line.startsWith('#')) continue;
    // Extract package name (strip version specifiers)
    const pkg = line.split(/[=<>!\[]|~/)[0].trim().replace(/^-e\s+/, '').split('/').pop();
    if (!pkg) continue;

    const mapped = FRAMEWORK_MAP[pkg];
    if (mapped && !result.frameworks.find((f) => f.name === mapped.name)) {
      result.frameworks.push({
        ...mapped,
        evidence: [`requirements.txt: ${pkg}`],
      });
    }
  }
}

function parsePyproject(content, result) {
  const lower = content.toLowerCase();
  for (const [key, info] of Object.entries(FRAMEWORK_MAP)) {
    if (lower.includes(key) && !result.frameworks.find((f) => f.name === info.name)) {
      result.frameworks.push({
        ...info,
        evidence: [`pyproject.toml: ${key}`],
      });
    }
  }
}
