/**
 * Phase 0.2 — Internal route path consistency guard
 *
 * Ensures that all user-facing internal navigation uses /plan (not /planner).
 * Allowed legacy identifiers that are NOT user-facing URLs:
 *   - components/planner/  (directory name)
 *   - page:planner         (permission key)
 *   - planner.json         (i18n namespace file)
 *   - localStorage keys containing "planner"
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const SRC = path.resolve(__dirname, '..');

/** Recursively collect all .ts/.tsx files under a directory */
function collectFiles(dir: string, files: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip node_modules and snapshot dirs
      if (entry.name === 'node_modules' || entry.name === '__snapshots__') continue;
      collectFiles(full, files);
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Patterns that represent user-facing /planner references.
 * We match string literals passed to `to=`, `navigate({ to: ... })`, href, etc.
 * We deliberately exclude:
 *   - import paths  (import ... from '...planner...')
 *   - directory refs in comments
 *   - permission strings like 'page:planner'
 *   - localStorage keys
 *   - i18n namespace strings like 'planner.json' / 'planner'
 */
const USER_FACING_PLANNER_RE = /(?:to\s*[:=]\s*['"`]\/planner|href\s*=\s*['"`]\/planner)/g;

/** Allowed files that may legitimately contain /planner for non-URL purposes */
const ALLOWED_FILES = [
  'routeConsistency.test.ts', // this file itself
];

describe('route path consistency', () => {
  const allFiles = collectFiles(SRC);

  it('no user-facing link or navigation uses /planner', () => {
    const violations: string[] = [];

    for (const file of allFiles) {
      const name = path.basename(file);
      if (ALLOWED_FILES.includes(name)) continue;

      const content = fs.readFileSync(file, 'utf-8');
      const matches = content.match(USER_FACING_PLANNER_RE);
      if (matches) {
        const rel = path.relative(SRC, file);
        violations.push(`${rel}: found ${matches.join(', ')}`);
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `Found /planner in user-facing navigation. Use /plan instead:\n` +
        violations.map(v => `  • ${v}`).join('\n'),
      );
    }

    expect(violations).toHaveLength(0);
  });

  it('/plan route is defined in routes/index.tsx', () => {
    const routesFile = path.join(SRC, 'routes', 'index.tsx');
    const content = fs.readFileSync(routesFile, 'utf-8');
    expect(content).toContain("path: '/plan'");
  });

  it('Layout.tsx navigation links use /plan', () => {
    const layoutFile = path.join(SRC, 'components', 'Layout.tsx');
    const content = fs.readFileSync(layoutFile, 'utf-8');
    // Both NavLink and MenuLink for the planner page must point to /plan
    const planLinks = (content.match(/to="\/plan"/g) || []).length;
    expect(planLinks).toBeGreaterThanOrEqual(2); // header nav + drawer nav
  });
});
