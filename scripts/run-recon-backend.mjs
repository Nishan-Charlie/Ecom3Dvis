/**
 * Starts the Flask reconstruction API on port 5050 (matches vite.config.js proxy).
 * Uses backend/.venv when present; loads project-root .env (RECON_COLMAP_EXECUTABLE).
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.join(__dirname, '..')
const backend = path.join(projectRoot, 'backend')
const appPy = path.join(backend, 'app.py')

function loadEnvFile(filePath) {
  const out = {}
  if (!existsSync(filePath)) return out
  for (const raw of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || !line.includes('=')) continue
    const eq = line.indexOf('=')
    const key = line.slice(0, eq).trim()
    if (!key) continue
    let val = line.slice(eq + 1).trim()
    if (val.length >= 2 && val[0] === val.at(-1) && (val[0] === '"' || val[0] === "'")) {
      val = val.slice(1, -1)
    }
    out[key] = val
  }
  return out
}

if (!existsSync(appPy)) {
  console.error('Missing backend/app.py — run from project root.')
  process.exit(1)
}

const win = process.platform === 'win32'
const venvPy = win
  ? path.join(backend, '.venv', 'Scripts', 'python.exe')
  : path.join(backend, '.venv', 'bin', 'python')
const python = existsSync(venvPy) ? venvPy : 'python'

const dotenv = {
  ...loadEnvFile(path.join(projectRoot, '.env')),
  ...loadEnvFile(path.join(backend, '.env')),
}
const childEnv = { ...process.env, ...dotenv }

const colmap = childEnv.RECON_COLMAP_EXECUTABLE?.trim()
if (colmap) {
  if (existsSync(colmap)) {
    console.log(`COLMAP: ${colmap}`)
  } else {
    console.warn(`Warning: RECON_COLMAP_EXECUTABLE is set but not found:\n  ${colmap}`)
  }
} else {
  console.warn(
    'Warning: RECON_COLMAP_EXECUTABLE not set. Multi-view jobs need COLMAP.\n' +
      '  Add to project .env: RECON_COLMAP_EXECUTABLE=C:\\path\\to\\colmap.exe',
  )
}

console.log(`Starting reconstruction API: ${python} app.py (cwd: ${backend})`)

const child = spawn(python, ['app.py'], {
  cwd: backend,
  stdio: 'inherit',
  shell: false,
  env: childEnv,
})

child.on('exit', (code) => process.exit(code ?? 0))
child.on('error', (err) => {
  console.error(err.message)
  console.error('\nTip: cd backend && python -m venv .venv && .\\.venv\\Scripts\\pip install -r requirements.txt')
  process.exit(1)
})
