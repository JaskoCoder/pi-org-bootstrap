#!/usr/bin/env node

import { bootstrap } from '../src/index.js';

const args = process.argv.slice(2);
const command = args[0];

if (!command || command === 'help' || command === '--help') {
  console.log(`
pi-org-bootstrap — Self-assembling autonomous agent framework

Usage:
  npx pi-org-bootstrap init          Interactive bootstrap
  npx pi-org-bootstrap init --yes    Non-interactive (use defaults)
  npx pi-org-bootstrap status        Show bootstrap state
  npx pi-org-bootstrap help          Show this help

Options:
  --yes          Accept all defaults, skip interactive prompts
  --force        Force overwrite existing configuration
  --type TYPE    Set project type directly (fullstack-web, api, library, mobile, data-ml, other)
  --teams LIST   Comma-separated team names (skip auto-detection)
`);
  process.exit(0);
}

if (command === 'status') {
  const { showStatus } = await import('../src/status.js');
  await showStatus(process.cwd());
  process.exit(0);
}

if (command === 'init') {
  const options = {
    yes: args.includes('--yes'),
    force: args.includes('--force'),
    type: args.find((a, i) => args[i - 1] === '--type'),
    teams: args.find((a, i) => args[i - 1] === '--teams')?.split(','),
  };

  try {
    await bootstrap(process.cwd(), options);
  } catch (err) {
    console.error(`\n❌ Bootstrap failed: ${err.message}`);
    process.exit(1);
  }
  process.exit(0);
}

console.error(`Unknown command: ${command}`);
console.error('Run `npx pi-org-bootstrap help` for usage.');
process.exit(1);
