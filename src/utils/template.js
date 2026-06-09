/**
 * Simple template engine using {{variable}} syntax.
 * No external dependencies — pure string interpolation.
 */

/**
 * Render a template string by replacing {{key}} with values.
 * Supports nested paths like {{user.name}}.
 *
 * @param {string} template - Template string with {{key}} placeholders
 * @param {Record<string, any>} data - Key-value pairs for replacement
 * @returns {string} Rendered string
 */
export function render(template, data) {
  return template.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
    const trimmed = key.trim();
    const value = resolvePath(data, trimmed);
    if (value === undefined || value === null) return '';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (Array.isArray(value)) return value.join(', ');
    return String(value);
  });
}

/**
 * Render a template with conditional blocks.
 * {{#if condition}}...{{/if}} and {{#each items}}...{{/each}}
 *
 * Limited but sufficient for our agent templates.
 */
export function renderAdvanced(template, data) {
  let result = template;

  // Handle {{#each items}}...{{/each}}
  result = result.replace(
    /\{\{#each\s+(\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g,
    (match, key, body) => {
      const items = data[key];
      if (!Array.isArray(items)) return '';
      return items
        .map((item, index) => {
          const itemData = { ...data, this: item, '@index': index };
          return renderAdvanced(body, itemData);
        })
        .join('');
    }
  );

  // Handle {{#if condition}}...{{/if}}
  result = result.replace(
    /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (match, key, body) => {
      const value = resolvePath(data, key);
      if (value) {
        return renderAdvanced(body, data);
      }
      return '';
    }
  );

  // Handle simple {{variable}} replacements
  result = render(result, data);

  return result;
}

/**
 * Resolve a dot-separated path from an object
 */
function resolvePath(obj, path) {
  return path.split('.').reduce((current, key) => {
    if (current === null || current === undefined) return undefined;
    // Handle array index access
    if (/^\d+$/.test(key) && Array.isArray(current)) {
      return current[parseInt(key, 10)];
    }
    return current[key];
  }, obj);
}
