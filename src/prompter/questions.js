/**
 * Question definitions for the interactive prompter.
 */

/**
 * Get questions based on stack profile and defaults.
 */
export function getQuestions(stackProfile, defaults) {
  return [
    {
      id: 'projectType',
      type: 'select',
      message: 'Project type',
      choices: ['Full-stack web application', 'API / backend service', 'Library / package', 'Mobile app', 'Data pipeline / ML project', 'Other'],
      default: inferProjectType(stackProfile),
    },
    {
      id: 'teamStructure',
      type: 'select',
      message: 'Team structure',
      choices: ['Auto-detect from directories', 'Monolith (single team)', 'Frontend + Backend split', 'Custom (specify teams)'],
      default: 'Auto-detect from directories',
    },
    {
      id: 'features',
      type: 'multiselect',
      message: 'Agent features',
      choices: [
        { name: 'memory', checked: true },
        { name: 'contextBus', checked: true },
        { name: 'smartDispatcher', checked: true },
        { name: 'releaseChain', checked: true },
        { name: 'tmuxControl', checked: true },
        { name: 'uxDesignChain', checked: false },
        { name: 'brainWiki', checked: false },
      ],
    },
    {
      id: 'security',
      type: 'multiselect',
      message: 'Security features',
      choices: [
        { name: 'securityOfficer', checked: true },
      ],
    },
    {
      id: 'cicd',
      type: 'select',
      message: 'CI/CD integration',
      choices: ['GitHub Issues + PRs', 'GitLab Issues', 'None'],
      default: inferCICDDisplay(stackProfile),
    },
    {
      id: 'interactionMode',
      type: 'select',
      message: 'Agent interaction mode',
      choices: ['Head agent mode (orchestrator delegates)', 'Direct mode (user talks to agents)', 'Both (head agent + direct access)'],
      default: 'Head agent mode (orchestrator delegates)',
    },
  ];
}

function inferProjectType(stackProfile) {
  const fwCategories = stackProfile.frameworks.map((f) => f.category);
  if (fwCategories.includes('frontend') && fwCategories.includes('backend')) return 'Full-stack web application';
  if (fwCategories.includes('frontend')) return 'Full-stack web application';
  if (fwCategories.includes('backend')) return 'API / backend service';
  if (fwCategories.includes('ml') || fwCategories.includes('data')) return 'Data pipeline / ML project';
  return 'Full-stack web application';
}

function inferCICDDisplay(stackProfile) {
  if (stackProfile.gitHosting.provider === 'github') return 'GitHub Issues + PRs';
  if (stackProfile.gitHosting.provider === 'gitlab') return 'GitLab Issues';
  return 'GitHub Issues + PRs';
}
