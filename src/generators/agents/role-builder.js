import { DOMAIN_TEAM_MAP, TOOL_SETS } from '../../config/schema.js';
import * as log from '../../utils/logger.js';

/**
 * Build agent roles from StackProfile + UserConfig.
 *
 * @param {import('../../config/schema.js').StackProfile} stackProfile
 * @param {import('../../config/schema.js').UserConfig} userConfig
 * @returns {import('../../config/schema.js').Role[]}
 */
export function buildRoles(stackProfile, userConfig) {
  const roles = [];

  // ── Universal Roles (always generated) ──────────────

  roles.push({
    name: 'dispatcher',
    category: 'orchestration',
    description: 'Central coordinator — triages issues, assigns tasks, manages workflow',
    tools: TOOL_SETS.orchestration,
    scope: null,
    isUniversal: true,
  });

  roles.push({
    name: 'tech-lead',
    category: 'architecture',
    description: 'Architect — designs solutions, reviews architecture, defines standards',
    tools: TOOL_SETS.architecture,
    scope: null,
    isUniversal: true,
  });

  roles.push({
    name: 'reviewer',
    category: 'quality',
    description: 'Quality gate — reviews all code changes before merge',
    tools: TOOL_SETS.quality,
    scope: null,
    isUniversal: true,
  });

  if (userConfig.features.securityOfficer !== false) {
    roles.push({
      name: 'security-officer',
      category: 'security',
      description: 'Security audit — vulnerability scanning, can block deployments',
      tools: TOOL_SETS.security,
      scope: null,
      isUniversal: true,
    });
  }

  // ── Domain-Specific Roles (from stack detection) ────

  const domains = stackProfile.domains;

  for (const domain of domains) {
    const teamName = DOMAIN_TEAM_MAP[domain.name] || `${domain.name}-team`;
    const tools = TOOL_SETS['build-team'];

    roles.push({
      name: teamName,
      category: 'build-team',
      description: generateTeamDescription(domain),
      tools,
      scope: {
        owns: domain.paths,
        frameworks: domain.frameworks,
        languages: extractLanguages(domain, stackProfile),
      },
      isUniversal: false,
    });
  }

  // ── Pi Meta Roles (if head agent or both mode) ──────

  if (userConfig.interactionMode !== 'direct') {
    const piMetaNames = ['pi-extensions', 'pi-agents', 'pi-skills', 'pi-config'];
    const piDescriptions = {
      'pi-extensions': 'Pi extensions — manages head agent, command center, and custom extensions',
      'pi-agents': 'Pi agent configuration — manages agent role definitions and tool access',
      'pi-skills': 'Pi skills — manages skill files, triggers, and skill discovery',
      'pi-config': 'Pi configuration — manages settings, providers, and themes',
    };

    for (const name of piMetaNames) {
      roles.push({
        name,
        category: 'pi-meta',
        description: piDescriptions[name],
        tools: TOOL_SETS['pi-meta'],
        scope: null,
        isUniversal: false,
      });
    }
  }

  // ── Optional Roles (based on features) ──────────────

  if (userConfig.features.uxDesignChain) {
    roles.push({
      name: 'ux-researcher',
      category: 'design',
      description: 'UX researcher — conducts user research, creates personas and journey maps',
      tools: TOOL_SETS.design,
      scope: null,
      isUniversal: false,
    });
    roles.push({
      name: 'ui-designer',
      category: 'design',
      description: 'UI designer — creates component designs, layouts, and design system entries',
      tools: TOOL_SETS.design,
      scope: null,
      isUniversal: false,
    });
    roles.push({
      name: 'ux-evaluator',
      category: 'design',
      description: 'UX evaluator — heuristic evaluation, accessibility checks, WCAG compliance',
      tools: TOOL_SETS.design,
      scope: null,
      isUniversal: false,
    });
  }

  if (userConfig.features.brainWiki) {
    roles.push({
      name: 'brain-orchestrator',
      category: 'orchestration',
      description: 'Brain wiki orchestrator — manages knowledge base, syncs wiki, maintains mental model',
      tools: TOOL_SETS.orchestration,
      scope: null,
      isUniversal: false,
    });
  }

  return roles;
}

/**
 * Generate a descriptive team description from domain info
 */
function generateTeamDescription(domain) {
  const teamName = DOMAIN_TEAM_MAP[domain.name] || `${domain.name}-team`;
  const fwStr = domain.frameworks.length > 0 ? domain.frameworks.join(', ') : null;
  const pathStr = domain.paths.join(', ');

  const nameMap = {
    'frontend-team': 'Frontend engineers',
    'backend-team': 'Backend engineers',
    'api-team': 'API engineers',
    'infra-devops': 'Infrastructure engineers',
    'ai-ml-team': 'AI/ML engineers',
    'mobile-team': 'Mobile engineers',
    'data-team': 'Data engineers',
    'dev-team': 'Engineers',
  };

  const title = nameMap[teamName] || `${domain.name} engineers`;

  if (fwStr) {
    return `${title} — ${fwStr}`;
  }
  if (pathStr) {
    return `${title} — owns ${pathStr}`;
  }
  return title;
}

/**
 * Extract languages relevant to a domain
 */
function extractLanguages(domain, stackProfile) {
  return stackProfile.languages.map((l) => l.name);
}
