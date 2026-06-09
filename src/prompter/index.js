import * as readline from 'node:readline';
import { DEFAULT_CONFIG } from '../config/schema.js';
import * as log from '../utils/logger.js';
import { getQuestions } from './questions.js';

/**
 * Interactive question flow using readline.
 * No external dependencies.
 *
 * @param {import('../config/schema.js').StackProfile} stackProfile
 * @param {{ yes?: boolean, type?: string, teams?: string[] }} options
 * @returns {Promise<import('../config/schema.js').UserConfig>}
 */
export async function prompt(stackProfile, options = {}) {
  // Non-interactive mode
  if (options.yes) {
    log.info('Using defaults (--yes flag)');
    return {
      ...DEFAULT_CONFIG,
      cicd: inferCICD(stackProfile),
    };
  }

  // Apply CLI overrides
  const defaults = {
    ...DEFAULT_CONFIG,
    cicd: inferCICD(stackProfile),
  };

  if (options.type) {
    defaults.projectType = options.type;
  }

  const questions = getQuestions(stackProfile, defaults);
  const answers = {};

  log.step('2', 'Configure your agent organization\n');

  for (const question of questions) {
    // Check show condition
    if (question.show && !question.show(answers)) {
      continue;
    }

    if (question.type === 'select') {
      answers[question.id] = await askSelect(question);
    } else if (question.type === 'multiselect') {
      answers[question.id] = await askMultiSelect(question);
    } else if (question.type === 'confirm') {
      answers[question.id] = await askConfirm(question);
    } else if (question.type === 'input') {
      answers[question.id] = await askInput(question);
    }
  }

  return answers;
}

function inferCICD(stackProfile) {
  if (stackProfile.gitHosting.provider === 'github') return 'github';
  if (stackProfile.gitHosting.provider === 'gitlab') return 'gitlab';
  return 'github';
}

// ── Interactive prompt helpers ────────────────────────────

function createRL() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

async function askSelect(question) {
  const rl = createRL();
  try {
    return await new Promise((resolve) => {
      const choices = question.choices;
      console.log(`\n${log.colorize('bright', `? ${question.message}`)}`);
      choices.forEach((c, i) => {
        const marker = c === question.default ? '>' : ' ';
        console.log(`  ${marker} ${i + 1}. ${c}`);
      });

      rl.question(`  Enter number [${choices.indexOf(question.default) + 1}]: `, (answer) => {
        const num = parseInt(answer.trim(), 10);
        if (num >= 1 && num <= choices.length) {
          resolve(choices[num - 1]);
        } else {
          resolve(question.default);
        }
      });
    });
  } finally {
    rl.close();
  }
}

async function askMultiSelect(question) {
  const rl = createRL();
  try {
    return await new Promise((resolve) => {
      console.log(`\n${log.colorize('bright', `? ${question.message} (comma-separated numbers)`)}`);
      question.choices.forEach((c, i) => {
        const checked = c.checked ? '✓' : '○';
        console.log(`  ${checked} ${i + 1}. ${c.name}`);
      });

      const defaultChecked = question.choices
        .map((c, i) => (c.checked ? i + 1 : null))
        .filter(Boolean)
        .join(',');

      rl.question(`  Select [${defaultChecked}]: `, (answer) => {
        const input = answer.trim();
        if (!input) {
          // Use defaults
          const result = {};
          question.choices.forEach((c) => {
            result[c.name] = c.checked || false;
          });
          resolve(result);
          return;
        }

        const selected = new Set(
          input.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => n >= 1 && n <= question.choices.length)
        );

        const result = {};
        question.choices.forEach((c, i) => {
          result[c.name] = selected.has(i + 1);
        });
        resolve(result);
      });
    });
  } finally {
    rl.close();
  }
}

async function askConfirm(question) {
  const rl = createRL();
  try {
    return await new Promise((resolve) => {
      const defaultStr = question.default ? 'Y/n' : 'y/N';
      rl.question(`? ${question.message} [${defaultStr}]: `, (answer) => {
        const lower = answer.trim().toLowerCase();
        if (lower === 'y' || lower === 'yes') resolve(true);
        else if (lower === 'n' || lower === 'no') resolve(false);
        else resolve(question.default);
      });
    });
  } finally {
    rl.close();
  }
}

async function askInput(question) {
  const rl = createRL();
  try {
    return await new Promise((resolve) => {
      const prompt = question.default ? `? ${question.message} [${question.default}]: ` : `? ${question.message}: `;
      rl.question(prompt, (answer) => {
        resolve(answer.trim() || question.default || '');
      });
    });
  } finally {
    rl.close();
  }
}
