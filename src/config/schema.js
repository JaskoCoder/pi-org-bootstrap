/**
 * Configuration schemas and types for pi-org-bootstrap.
 */

/**
 * @typedef {Object} StackProfile
 * @property {Array<{name: string, confidence: number, evidence: string[]}>} languages
 * @property {Array<{name: string, category: string, version?: string, evidence: string[]}>} frameworks
 * @property {Object} structure
 * @property {string} structure.type - "monorepo" | "single-app" | "microservices"
 * @property {Array<{path: string, purpose: string}>} structure.directories
 * @property {boolean} structure.hasTests
 * @property {string[]} structure.testFrameworks
 * @property {boolean} structure.hasDocker
 * @property {boolean} structure.hasCI
 * @property {string|null} structure.ciProvider
 * @property {Array<{type: string, evidence: string[]}>} databases
 * @property {string|null} packageManager
 * @property {{provider: string, owner?: string, repo?: string}} gitHosting
 * @property {Array<{name: string, paths: string[], frameworks: string[]}>} domains
 */

/**
 * @typedef {Object} UserConfig
 * @property {string} projectType
 * @property {string} teamStructure
 * @property {Array<{name: string, path: string, description: string}>} customTeams
 * @property {Object} features
 * @property {boolean} features.memory
 * @property {boolean} features.contextBus
 * @property {boolean} features.smartDispatcher
 * @property {boolean} features.releaseChain
 * @property {boolean} features.tmuxControl
 * @property {boolean} features.uxDesignChain
 * @property {boolean} features.brainWiki
 * @property {Object} security
 * @property {boolean} security.securityOfficer
 * @property {string} cicd
 * @property {string} interactionMode
 */

/**
 * @typedef {Object} Role
 * @property {string} name
 * @property {string} category - "orchestration" | "architecture" | "quality" | "security" | "build-team" | "pi-meta" | "design"
 * @property {string} description
 * @property {string} tools
 * @property {Object|null} scope
 * @property {string[]} scope.owns
 * @property {string[]} scope.frameworks
 * @property {string[]} scope.languages
 * @property {boolean} isUniversal
 */

/**
 * @typedef {Object} BootstrapConfig
 * @property {string} version
 * @property {string} generatedAt
 * @property {string} bootstrapVersion
 * @property {Object} scan
 * @property {Object} config
 * @property {Object} generated
 */

/**
 * Default user configuration (used with --yes)
 */
export const DEFAULT_CONFIG = {
  projectType: 'fullstack-web',
  teamStructure: 'auto-detect',
  customTeams: [],
  features: {
    memory: true,
    contextBus: true,
    smartDispatcher: true,
    releaseChain: true,
    tmuxControl: true,
    uxDesignChain: false,
    brainWiki: false,
  },
  security: {
    securityOfficer: true,
  },
  cicd: 'github',
  interactionMode: 'head-agent',
};

/**
 * Domain name → team name mapping
 */
export const DOMAIN_TEAM_MAP = {
  frontend: 'frontend-team',
  backend: 'backend-team',
  api: 'api-team',
  'ai-ml': 'ai-ml-team',
  mobile: 'mobile-team',
  data: 'data-team',
  infrastructure: 'infra-devops',
  dev: 'dev-team',
};

/**
 * Tool sets by team category
 */
export const TOOL_SETS = {
  'build-team': 'read,bash,edit,write',
  orchestration: 'read,bash,write,delegate,delegate_parallel,send_mail,check_mail,pipeline_status,pipeline_run,sprint_plan,update_agent_memory',
  architecture: 'read,bash',
  quality: 'read,bash',
  security: 'read,bash',
  'pi-meta': 'read,bash,edit,write',
  design: 'read,bash',
};
