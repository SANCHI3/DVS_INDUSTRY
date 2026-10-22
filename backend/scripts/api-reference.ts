/**
 * Writes docs/API.md: every endpoint with the roles allowed to call it,
 * read from the live router so it cannot drift from the code.
 *
 *   npm run docs:api
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import type { Router } from 'express';

interface Layer {
  name?: string;
  handle: ((...args: unknown[]) => unknown) & { allowedRoles?: string[]; stack?: Layer[] };
  route?: { path: string; methods: Record<string, boolean>; stack: Layer[] };
}

interface Endpoint {
  method: string;
  path: string;
  access: string;
}

function describeAccess(layers: Layer[], authenticated: boolean): string {
  const roles = layers.find((l) => l.handle.allowedRoles !== undefined)?.handle.allowedRoles;
  if (roles !== undefined) return roles.join(', ');
  const ownAuth = layers.some(
    (l) => l.name === 'authenticate' || l.name === 'requireServiceAccount',
  );
  return authenticated || ownAuth ? 'Any signed-in user' : 'Public';
}

function collect(router: Router, prefix: string): Endpoint[] {
  const out: Endpoint[] = [];
  let authenticated = false; // router.use(authenticate) covers the routes after it
  for (const layer of router.stack as unknown as Layer[]) {
    if (layer.route === undefined) {
      if (layer.name === 'authenticate') authenticated = true;
      continue;
    }
    for (const method of Object.keys(layer.route.methods)) {
      out.push({
        method: method.toUpperCase(),
        path: prefix + (layer.route.path === '/' ? '' : layer.route.path),
        access: describeAccess(layer.route.stack, authenticated),
      });
    }
  }
  return out;
}

async function main(): Promise<void> {
  const indexSource = fs.readFileSync(path.join(__dirname, '../src/routes/index.ts'), 'utf8');
  const imports = new Map(
    [...indexSource.matchAll(/import (\w+) from '([^']+)';/g)].map((m) => [m[1]!, m[2]!]),
  );
  const mounts = [...indexSource.matchAll(/router\.use\(`\$\{API_PREFIX\}(\/[\w-]+)`, (\w+)\)/g)];
  const { API_PREFIX } = await import('../src/constants');

  const sections: string[] = [];
  let total = 0;
  for (const [, mountPath, name] of mounts) {
    const file = imports.get(name!);
    if (file === undefined) continue;
    const mod = (await import(path.join(__dirname, '../src/routes', file))) as { default: Router };
    const endpoints = collect(mod.default, `${API_PREFIX}${mountPath}`);
    total += endpoints.length;
    sections.push(
      `## ${mountPath!.slice(1)}\n\n| Method | Path | Who may call it |\n|---|---|---|\n` +
        endpoints.map((e) => `| ${e.method} | \`${e.path}\` | ${e.access} |`).join('\n'),
    );
  }

  const doc = `# API reference

Generated from the router by \`npm run docs:api\` (backend). Do not edit by hand.

${total} endpoints. All live under \`${API_PREFIX}\`; responses use the envelope
\`{ success, data, message?, meta? }\` or \`{ success: false, error: { code, message } }\`.
Signed-in calls send \`Authorization: Bearer <access token>\`; the refresh token
is an httpOnly cookie used by \`POST ${API_PREFIX}/auth/refresh\`. Every response
carries an \`X-Request-Id\` header that matches the server logs.

Also served: \`GET ${API_PREFIX}/health\` (public) and \`GET /uploads/profiles/<file>\`
(profile photos, public).

${sections.join('\n\n')}
`;
  const out = path.join(__dirname, '../../docs/API.md');
  fs.writeFileSync(out, doc);
  console.log(`Wrote ${path.relative(process.cwd(), out)} (${total} endpoints)`);
  process.exit(0);
}

void main();
