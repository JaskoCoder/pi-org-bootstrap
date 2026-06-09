import { join } from 'node:path';
import { pathExists, readText, listFiles } from '../../utils/fs.js';

/**
 * Detect CI/CD setup from .github/workflows/, Jenkinsfile, etc.
 */
export async function detect(projectRoot) {
  const result = {
    detected: false,
    provider: null,
    stages: [],
    evidence: [],
  };

  // GitHub Actions
  const workflowsDir = join(projectRoot, '.github', 'workflows');
  if (await pathExists(workflowsDir)) {
    result.detected = true;
    result.provider = 'github-actions';
    result.evidence.push('.github/workflows/');

    const files = await listFiles(workflowsDir, '.yml');
    const yamlFiles = await listFiles(workflowsDir, '.yaml');
    const allFiles = [...files, ...yamlFiles];

    for (const file of allFiles) {
      try {
        const content = await readText(join(workflowsDir, file));
        const stages = parseGitHubActions(content, file);
        result.stages.push(...stages);
      } catch {
        // skip unreadable files
      }
    }
  }

  // GitLab CI
  const gitlabCIPath = join(projectRoot, '.gitlab-ci.yml');
  if (await pathExists(gitlabCIPath)) {
    result.detected = true;
    result.provider = 'gitlab-ci';
    result.evidence.push('.gitlab-ci.yml');

    try {
      const content = await readText(gitlabCIPath);
      result.stages.push(...parseGitLabCI(content));
    } catch {
      // skip
    }
  }

  // Jenkinsfile
  const jenkinsfilePath = join(projectRoot, 'Jenkinsfile');
  if (await pathExists(jenkinsfilePath)) {
    result.detected = true;
    result.provider = 'jenkins';
    result.evidence.push('Jenkinsfile');
  }

  // CircleCI
  const circleCIPath = join(projectRoot, '.circleci', 'config.yml');
  if (await pathExists(circleCIPath)) {
    result.detected = true;
    result.provider = 'circleci';
    result.evidence.push('.circleci/config.yml');
  }

  return result;
}

/**
 * Parse GitHub Actions workflow stages (basic).
 * No YAML parser — uses regex to find job names.
 */
function parseGitHubActions(content, filename) {
  const stages = [];
  const nameMatch = content.match(/^name\s*:\s*(.+)$/m);
  const workflowName = nameMatch ? nameMatch[1].trim().replace(/['"]/g, '') : filename.replace(/\.(yml|yaml)$/, '');

  // Find job names
  const lines = content.split('\n');
  let inJobs = false;

  for (const line of lines) {
    if (/^jobs\s*:/.test(line.trim())) {
      inJobs = true;
      continue;
    }
    if (inJobs && /^\s{2}(\w[\w-]*)\s*:/.test(line)) {
      const match = line.match(/^\s{2}(\w[\w-]*)\s*:/);
      if (match) {
        stages.push({
          name: match[1],
          workflow: workflowName,
        });
      }
    }
    // Exit jobs section
    if (inJobs && /^[a-z]/.test(line) && !line.startsWith(' ') && !line.startsWith('#') && !line.startsWith('jobs')) {
      break;
    }
  }

  return stages;
}

/**
 * Parse GitLab CI stages (basic).
 */
function parseGitLabCI(content) {
  const stages = [];
  // Match stages: - name
  const stagesMatch = content.match(/stages\s*:\s*\n((?:\s*-\s*.+\n?)+)/);
  if (stagesMatch) {
    const stageList = stagesMatch[1]
      .split('\n')
      .map((l) => l.replace(/^\s*-\s*/, '').trim())
      .filter(Boolean);
    for (const s of stageList) {
      stages.push({ name: s, workflow: 'gitlab-ci' });
    }
  }
  return stages;
}
