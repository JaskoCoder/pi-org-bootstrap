import { join } from 'node:path';
import { pathExists, readJSON, isFile, isDirectory, listFiles } from '../../utils/fs.js';

/**
 * Detect Node.js stack from package.json, tsconfig.json, etc.
 */
export async function detect(projectRoot) {
  const result = {
    detected: false,
    runtime: null,
    languages: [],
    frameworks: [],
    packageManager: null,
    hasTypeScript: false,
    testFrameworks: [],
    evidence: [],
  };

  const pkgPath = join(projectRoot, 'package.json');
  const hasPackageJson = await pathExists(pkgPath);

  if (!hasPackageJson) {
    // Check for .ts/.js files at root level
    const hasJsFiles = await hasFileGlob(projectRoot, '.js');
    const hasTsFiles = await hasFileGlob(projectRoot, '.ts');
    if (!hasJsFiles && !hasTsFiles) return result;
    result.detected = true;
    result.runtime = 'node';
    result.languages.push('javascript');
    if (hasTsFiles) {
      result.languages.push('typescript');
      result.hasTypeScript = true;
    }
    return result;
  }

  result.detected = true;
  result.evidence.push('package.json');

  // Parse package.json
  const pkg = await readJSON(pkgPath);
  const allDeps = {
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
  };

  // Detect runtime
  if (allDeps.bun || pkg.packageManager?.startsWith('bun')) {
    result.runtime = 'bun';
  } else {
    result.runtime = 'node';
  }

  // Detect TypeScript
  const tsconfigPath = join(projectRoot, 'tsconfig.json');
  result.hasTypeScript = await pathExists(tsconfigPath);
  result.languages = result.hasTypeScript ? ['typescript', 'javascript'] : ['javascript'];

  // Detect package manager
  if (await pathExists(join(projectRoot, 'pnpm-lock.yaml'))) {
    result.packageManager = 'pnpm';
  } else if (await pathExists(join(projectRoot, 'yarn.lock'))) {
    result.packageManager = 'yarn';
  } else if (await pathExists(join(projectRoot, 'bun.lockb'))) {
    result.packageManager = 'bun';
  } else {
    result.packageManager = 'npm';
  }

  // Framework detection map
  const frameworkMap = {
    // Frontend
    next: { name: 'next.js', category: 'frontend' },
    react: { name: 'react', category: 'frontend' },
    vue: { name: 'vue', category: 'frontend' },
    svelte: { name: 'svelte', category: 'frontend' },
    '@angular/core': { name: 'angular', category: 'frontend' },
    '@sveltejs/kit': { name: 'sveltekit', category: 'frontend' },
    nuxt: { name: 'nuxt', category: 'frontend' },

    // Backend
    express: { name: 'express', category: 'backend' },
    fastify: { name: 'fastify', category: 'backend' },
    '@nestjs/core': { name: 'nest', category: 'backend' },
    koa: { name: 'koa', category: 'backend' },
    hapi: { name: 'hapi', category: 'backend' },
    '@hapi/hapi': { name: 'hapi', category: 'backend' },

    // ORM
    prisma: { name: 'prisma', category: 'orm' },
    drizzleOrm: { name: 'drizzle', category: 'orm' },
    typeorm: { name: 'typeorm', category: 'orm' },
    sequelize: { name: 'sequelize', category: 'orm' },
    mongoose: { name: 'mongoose', category: 'orm' },

    // Styling
    tailwindcss: { name: 'tailwindcss', category: 'styling' },

    // Jobs
    bullmq: { name: 'bullmq', category: 'jobs' },
    bull: { name: 'bull', category: 'jobs' },

    // Testing
    vitest: { name: 'vitest', category: 'testing' },
    jest: { name: 'jest', category: 'testing' },
    mocha: { name: 'mocha', category: 'testing' },

    // AI
    '@tambo-ai/react': { name: 'tambo', category: 'ai' },
    openai: { name: 'openai', category: 'ai' },
  };

  for (const [dep, info] of Object.entries(frameworkMap)) {
    if (allDeps[dep]) {
      result.frameworks.push({
        ...info,
        version: allDeps[dep],
        evidence: [`package.json dependency: ${dep}`],
      });
    }
  }

  // Check for Prisma schema file
  const prismaSchema = join(projectRoot, 'prisma', 'schema.prisma');
  if (await pathExists(prismaSchema)) {
    if (!result.frameworks.find((f) => f.name === 'prisma')) {
      result.frameworks.push({
        name: 'prisma',
        category: 'orm',
        evidence: ['prisma/schema.prisma exists'],
      });
    }
  }

  // Check for Tailwind config
  const tailwindConfigs = ['tailwind.config.js', 'tailwind.config.ts', 'tailwind.config.mjs'];
  for (const tc of tailwindConfigs) {
    if (await pathExists(join(projectRoot, tc))) {
      if (!result.frameworks.find((f) => f.name === 'tailwindcss')) {
        result.frameworks.push({
          name: 'tailwindcss',
          category: 'styling',
          evidence: [`${tc} exists`],
        });
      }
      break;
    }
  }

  // Detect test frameworks
  const testDeps = ['vitest', 'jest', 'mocha', 'ava', 'tape'];
  for (const td of testDeps) {
    if (allDeps[td]) {
      result.testFrameworks.push(td);
    }
  }

  return result;
}

async function hasFileGlob(dir, ext) {
  try {
    const { readdir: ls } = await import('node:fs/promises');
    const files = await ls(dir);
    return files.some((f) => f.endsWith(ext));
  } catch {
    return false;
  }
}
