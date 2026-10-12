#!/usr/bin/env node
/**
 * One-command local setup for a fresh clone.
 *
 *   node scripts/setup.mjs --db-url "postgresql://postgres:<password>@localhost:5432/dvs_factory"
 *   node scripts/setup.mjs --db-url "..." --install     # also install deps, migrate and seed
 *
 * - Creates backend/.env and perception-service/.env from their .env.example
 *   templates (existing .env files are kept unless --force is given).
 * - Generates fresh JWT secrets, an admin password and a perception-service
 *   account, and writes the same service credentials into both files.
 * - Demo logins for the other roles use the role name as password
 *   (development only; the seed never creates them when NODE_ENV=production).
 * - Warns when the Git LFS model files were cloned as pointer files.
 *
 * No dependencies: runs on plain Node 20+.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, openSync, readSync, closeSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const DEFAULT_DB_URL = 'postgresql://postgres:postgres@localhost:5432/dvs_factory';
const secret = (bytes = 64) => randomBytes(bytes).toString('hex');
const password = () => `Dvs-${randomBytes(12).toString('base64url')}`;

const log = (msg = '') => console.log(msg);
const warn = (msg) => console.log(`  ! ${msg}`);
const ok = (msg) => console.log(`  ✓ ${msg}`);

/** Set KEY=value on its existing line (keeping comments elsewhere) or append it. */
function setKey(text, key, value) {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  return re.test(text) ? text.replace(re, () => line) : `${text.replace(/\s*$/, '')}\n${line}\n`;
}

function readKey(text, key) {
  const m = text.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return m ? m[1].replace(/\s+#.*$/, '').trim().replace(/^["']|["']$/g, '') : undefined;
}

function writeEnv(dir, build) {
  const target = join(root, dir, '.env');
  const template = join(root, dir, '.env.example');
  if (existsSync(target) && !flag('force')) {
    ok(`${dir}/.env already exists — kept (use --force to regenerate)`);
    return readFileSync(target, 'utf8');
  }
  const text = build(readFileSync(template, 'utf8'));
  writeFileSync(target, text);
  ok(`${dir}/.env created`);
  return text;
}

function run(cmd, cmdArgs, cwd) {
  log(`\n> ${cmd} ${cmdArgs.join(' ')}   (in ${cwd})`);
  const res = spawnSync(cmd, cmdArgs, { cwd: join(root, cwd), stdio: 'inherit', shell: process.platform === 'win32' });
  if (res.status !== 0) {
    console.error(`\n✗ "${cmd} ${cmdArgs.join(' ')}" failed in ${cwd}. Fix the error above and re-run.`);
    process.exit(res.status ?? 1);
  }
}

function isLfsPointer(file) {
  if (!existsSync(file)) return true;
  const fd = openSync(file, 'r');
  const buf = Buffer.alloc(64);
  readSync(fd, buf, 0, 64, 0);
  closeSync(fd);
  return buf.toString('utf8').startsWith('version https://git-lfs');
}

// ── Checks ───────────────────────────────────────────────────────────────────
log('DVS Industries — local setup\n');
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < 20) warn(`Node ${process.versions.node} found; Node 20+ is required.`);
else ok(`Node ${process.versions.node}`);

const lfsModels = ['fight_r3d18_v1.pt', 'fight_r3d18_v2.pt'].map((f) => join(root, 'perception-service', 'models', f));
if (lfsModels.some(isLfsPointer)) {
  warn('Fight models are Git LFS pointer files, not real weights. Run:');
  warn('    git lfs install && git lfs pull');
} else {
  ok('Git LFS model files present');
}

// ── backend/.env ─────────────────────────────────────────────────────────────
const dbUrl = option('db-url') ?? process.env.DATABASE_URL ?? DEFAULT_DB_URL;
const generated = { admin: password(), serviceEmail: 'perception@dvsindustry.com', servicePassword: password() };

const backendEnv = writeEnv('backend', (t) => {
  let text = t;
  text = setKey(text, 'DATABASE_URL', dbUrl);
  text = setKey(text, 'DIRECT_URL', dbUrl);
  text = setKey(text, 'JWT_SECRET', secret());
  text = setKey(text, 'REFRESH_TOKEN_SECRET', secret());
  text = setKey(text, 'SEED_ADMIN_PASSWORD', generated.admin);
  text = setKey(text, 'SEED_PERCEPTION_SERVICE_EMAIL', generated.serviceEmail);
  text = setKey(text, 'SEED_PERCEPTION_SERVICE_PASSWORD', generated.servicePassword);
  for (const role of ['supplier', 'client', 'production', 'store']) {
    text = setKey(text, `SEED_${role.toUpperCase()}_PASSWORD`, role);
  }
  return text;
});

// ── perception-service/.env (service credentials must match the backend) ────
writeEnv('perception-service', (t) => {
  let text = t;
  text = setKey(text, 'DASHBOARD_SERVICE_EMAIL', readKey(backendEnv, 'SEED_PERCEPTION_SERVICE_EMAIL') ?? '');
  text = setKey(text, 'DASHBOARD_SERVICE_PASSWORD', readKey(backendEnv, 'SEED_PERCEPTION_SERVICE_PASSWORD') ?? '');
  return text;
});

if (readKey(backendEnv, 'DATABASE_URL') === DEFAULT_DB_URL) {
  warn(`DATABASE_URL is the default ${DEFAULT_DB_URL}`);
  warn('If your PostgreSQL password/port differ, edit backend/.env (DATABASE_URL and DIRECT_URL).');
}

// ── Optional install + database ──────────────────────────────────────────────
if (flag('install')) {
  run('npm', ['install'], 'backend');
  run('npx', ['prisma', 'generate'], 'backend');
  run('npx', ['prisma', 'migrate', 'deploy'], 'backend');
  run('npm', ['run', 'db:seed'], 'backend');
  run('npm', ['install'], 'frontend');
  const python = process.platform === 'win32' ? 'python' : 'python3';
  run(python, ['-m', 'pip', 'install', '-r', 'requirements.txt'], 'perception-service');
}

// ── Summary ──────────────────────────────────────────────────────────────────
log('\nLogins (after `npm run db:seed` in backend/):');
log(`  Administrator  ${readKey(backendEnv, 'SEED_ADMIN_EMAIL') ?? 'admin@dvsindustry.com'} / ${readKey(backendEnv, 'SEED_ADMIN_PASSWORD')}`);
for (const role of ['production', 'store', 'supplier', 'client']) {
  const email = readKey(backendEnv, `SEED_${role.toUpperCase()}_EMAIL`) ?? `${role}.test@dvsindustry.local`;
  log(`  ${role.padEnd(13)}  ${email} / ${readKey(backendEnv, `SEED_${role.toUpperCase()}_PASSWORD`) ?? '(not set)'}`);
}
log('\nNext steps:');
if (!flag('install')) {
  log('  cd backend && npm install && npx prisma generate && npx prisma migrate deploy && npm run db:seed');
  log('  cd frontend && npm install');
  log('  cd perception-service && pip install -r requirements.txt');
}
log('  backend:    npm run dev                      -> http://localhost:3000');
log('  frontend:   npm run dev                      -> http://localhost:5173');
log('  cameras:    python main.py --camera CAM-01   (webcam; see perception-service/README.md)');
