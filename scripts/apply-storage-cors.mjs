/**
 * Applies Google Cloud Storage CORS to the Firebase Storage bucket from .env.
 *
 * Config file (first match wins):
 *   1. ./cors.json (project root) — edit this for your origins
 *   2. ./scripts/storage-cors.json (fallback)
 *
 * If VITE_FIREBASE_PROJECT_ID is set in .env, https://<id>.web.app and .firebaseapp.com
 * are merged into origins automatically (written to a temp file for gcloud).
 *
 * Uses (in order):
 *   1. `gcloud storage buckets update` (Google Cloud SDK)
 *   2. `gsutil cors set`
 *
 * Usage: npm run storage:set-cors
 *        npm run storage:set-cors -- your-bucket.appspot.com
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { execSync, execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function parseEnvLine(text, key) {
  const m = text.match(new RegExp(`^\\s*${key}\\s*=\\s*([^#\\r\\n]+)`, 'm'))
  return m?.[1]?.trim().replace(/^["']|["']$/g, '') || ''
}

function findOnPath(cmd) {
  try {
    const which = process.platform === 'win32' ? `where ${cmd}` : `which ${cmd}`
    const out = execSync(which, { encoding: 'utf8' }).trim().split(/\r?\n/)[0]
    return out && existsSync(out) ? out : null
  } catch {
    return null
  }
}

/** Typical install locations when PATH was not updated (Windows). */
function googleCloudSdkBinCandidates() {
  const dirs = []
  if (process.env.CLOUDSDK_ROOT) dirs.push(path.join(process.env.CLOUDSDK_ROOT, 'bin'))
  const localAppData = process.env.LOCALAPPDATA
  if (localAppData) {
    dirs.push(path.join(localAppData, 'Google', 'Cloud SDK', 'google-cloud-sdk', 'bin'))
  }
  const pf = process.env.ProgramFiles
  const pfx86 = process.env['ProgramFiles(x86)']
  if (pf) dirs.push(path.join(pf, 'Google', 'Cloud SDK', 'google-cloud-sdk', 'bin'))
  if (pfx86) dirs.push(path.join(pfx86, 'Google', 'Cloud SDK', 'google-cloud-sdk', 'bin'))
  return dirs
}

/** On Windows, `where gcloud` may point at extensionless `gcloud`; the real launcher is `gcloud.cmd`. */
function resolveWindowsLauncher(p) {
  if (process.platform !== 'win32' || !p) return p
  if (/\.(cmd|bat|exe)$/i.test(p)) return p
  const cmd = `${p}.cmd`
  if (existsSync(cmd)) return cmd
  const bat = `${p}.bat`
  if (existsSync(bat)) return bat
  const dir = path.dirname(p)
  const base = path.basename(p)
  const tryCmd = path.join(dir, `${base}.cmd`)
  if (existsSync(tryCmd)) return tryCmd
  return p
}

function resolveExecutable(baseName) {
  const fromPath = findOnPath(baseName)
  if (fromPath) {
    const fixed = resolveWindowsLauncher(fromPath)
    if (existsSync(fixed)) return fixed
  }
  const win = process.platform === 'win32'
  for (const dir of googleCloudSdkBinCandidates()) {
    const withCmd = path.join(dir, `${baseName}.cmd`)
    const plain = path.join(dir, baseName)
    if (win && existsSync(withCmd)) return withCmd
    if (existsSync(plain)) return resolveWindowsLauncher(plain)
  }
  return null
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')

function applyCorsWithGcloud(gsUrl, corsFile) {
  const gcloud = resolveExecutable('gcloud')
  if (!gcloud) return false
  try {
    execFileSync(gcloud, ['storage', 'buckets', 'update', gsUrl, '--cors-file', corsFile], {
      stdio: 'inherit',
      cwd: root,
    })
    return true
  } catch (e) {
    console.warn('gcloud storage buckets update failed:', e?.message || e)
    return false
  }
}

function applyCorsWithGsutil(gsUrl, corsFile) {
  const gsutil = resolveExecutable('gsutil')
  if (!gsutil) return false
  try {
    execFileSync(gsutil, ['cors', 'set', corsFile, gsUrl], { stdio: 'inherit', cwd: root })
    return true
  } catch (e) {
    console.warn('gsutil cors set failed:', e?.message || e)
    return false
  }
}
const envPath = path.join(root, '.env')
const corsRoot = path.join(root, 'cors.json')
const corsScripts = path.join(__dirname, 'storage-cors.json')
const corsPath = existsSync(corsRoot) ? corsRoot : corsScripts

if (!existsSync(corsPath)) {
  console.error('Missing CORS config: create cors.json in the project root or add scripts/storage-cors.json')
  process.exit(1)
}

if (!existsSync(envPath)) {
  console.error(
    'Missing .env — add VITE_FIREBASE_STORAGE_BUCKET or pass bucket: npm run storage:set-cors -- your-project.appspot.com',
  )
  process.exit(1)
}

const envText = readFileSync(envPath, 'utf8')
let bucket = process.argv[2]?.trim() || parseEnvLine(envText, 'VITE_FIREBASE_STORAGE_BUCKET')

if (!bucket) {
  console.error('Could not read VITE_FIREBASE_STORAGE_BUCKET from .env. Pass bucket as first argument.')
  process.exit(1)
}

bucket = bucket.replace(/^gs:\/\//, '')

const projectId = parseEnvLine(envText, 'VITE_FIREBASE_PROJECT_ID')
let corsToApply = corsPath
if (projectId) {
  const cfg = JSON.parse(readFileSync(corsPath, 'utf8'))
  const origins = new Set(cfg[0].origin)
  origins.add(`https://${projectId}.web.app`)
  origins.add(`https://${projectId}.firebaseapp.com`)
  cfg[0].origin = [...origins]
  corsToApply = path.join(__dirname, '.storage-cors.generated.json')
  writeFileSync(corsToApply, JSON.stringify(cfg, null, 2))
}

const gsUrl = `gs://${bucket}`
const corsAbsolute = path.resolve(corsToApply)

console.log(`Applying CORS to ${gsUrl}`)
console.log(`Using config file: ${corsAbsolute}`)

let ok = applyCorsWithGcloud(gsUrl, corsAbsolute)
if (!ok) ok = applyCorsWithGsutil(gsUrl, corsAbsolute)

if (corsToApply !== corsPath) {
  try {
    unlinkSync(corsToApply)
  } catch {
    /* ignore */
  }
}

if (!ok) {
  console.error('\nNeither "gcloud" nor "gsutil" was found (or both commands failed).')
  console.error('1) Install Google Cloud SDK: https://cloud.google.com/sdk/docs/install')
  console.error('2) Open a NEW PowerShell window (PATH is refreshed on restart).')
  console.error('3) Run: gcloud auth login')
  console.error(
    '4) Windows: the launcher is usually gcloud.cmd in the same bin folder. This script now prefers .cmd.\n' +
      '   Typical paths:\n' +
      '   %LOCALAPPDATA%\\Google\\Cloud SDK\\google-cloud-sdk\\bin\n' +
      '   C:\\Program Files\\Google\\Cloud SDK\\google-cloud-sdk\\bin',
  )
  process.exit(1)
}

console.log('CORS updated. Hard-refresh the app (Ctrl+Shift+R) and retry.')
