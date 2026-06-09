/**
 * Logging utility with color support for terminal output.
 */

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

let _verbose = false;

export function setVerbose(v) {
  _verbose = v;
}

export function header(text) {
  const line = '━'.repeat(Math.max(text.length + 2, 40));
  console.log(`\n${COLORS.bright}${COLORS.cyan}${line}${COLORS.reset}`);
  console.log(`${COLORS.bright}${COLORS.cyan} ${text}${COLORS.reset}`);
  console.log(`${COLORS.bright}${COLORS.cyan}${line}${COLORS.reset}\n`);
}

export function success(text) {
  console.log(`${COLORS.green}✓${COLORS.reset} ${text}`);
}

export function error(text) {
  console.error(`${COLORS.red}✗${COLORS.reset} ${text}`);
}

export function warn(text) {
  console.log(`${COLORS.yellow}⚠${COLORS.reset} ${text}`);
}

export function info(text) {
  console.log(`${COLORS.blue}ℹ${COLORS.reset} ${text}`);
}

export function step(phase, text) {
  console.log(`\n${COLORS.bright}[Phase ${phase}]${COLORS.reset} ${text}`);
}

export function bullet(text) {
  console.log(`  ${COLORS.gray}•${COLORS.reset} ${text}`);
}

export function verbose(text) {
  if (_verbose) {
    console.log(`${COLORS.dim}  → ${text}${COLORS.reset}`);
  }
}

export function plain(text) {
  console.log(text);
}

export function newline() {
  console.log('');
}

export function divider() {
  console.log(`${COLORS.dim}${'─'.repeat(50)}${COLORS.reset}`);
}

/**
 * Apply a color to text
 */
export function colorize(color, text) {
  const code = COLORS[color] || '';
  return `${code}${text}${COLORS.reset}`;
}

/**
 * Create a simple progress indicator
 */
export function progress(current, total, label) {
  const pct = Math.round((current / total) * 100);
  const bar = '█'.repeat(Math.floor(pct / 5)) + '░'.repeat(20 - Math.floor(pct / 5));
  process.stdout.write(`\r  ${COLORS.cyan}${bar}${COLORS.reset} ${pct}% ${label || ''}`);
  if (current === total) process.stdout.write('\n');
}
