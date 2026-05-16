/**
 * Local Flask reconstruction API (Vite proxies /__recon → http://127.0.0.1:5050).
 * Production: set VITE_RECON_API_BASE to your HTTPS origin that forwards to the same routes.
 */
const API = (() => {
  const custom = import.meta.env.VITE_RECON_API_BASE?.trim()
  if (custom) return custom.replace(/\/$/, '')
  return '/__recon'
})()

/** Max frames sent to the local COLMAP + mesh job (evenly spread over the clip). */
export const MAX_MULTIVIEW_IMAGES = 50

/**
 * Pick up to `maxViews` frames spread evenly across the timeline (best for SfM / multi-view).
 * Input frames should already be sharp (e.g. FrameExtractor blur filter).
 */
export function selectViewsForMultiViewReconstruction(frames, maxViews = MAX_MULTIVIEW_IMAGES) {
  if (!frames?.length) return []
  if (frames.length <= maxViews) return [...frames]
  const picked = []
  const last = frames.length - 1
  const n = maxViews
  for (let k = 0; k < n; k++) {
    const idx = Math.round((last * k) / (n - 1))
    picked.push(frames[idx])
  }
  return picked
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

/** Vite returns 502 when Flask is down; 503 often means COLMAP missing on the server. */
function apiErrorSuffix(status, data) {
  if (data?.hint) return ` ${data.hint}`
  if (status === 502) {
    return (
      ' The reconstruction server is not reachable. Start it with: npm run recon ' +
      '(or cd backend && python app.py, port 5050). Check http://127.0.0.1:5050/api/v1/health'
    )
  }
  if (status === 503) {
    return (
      ' Set RECON_COLMAP_EXECUTABLE in the project .env to your colmap.exe path, then restart npm run recon.'
    )
  }
  return ''
}

export async function createLocalReconJob(formData) {
  const res = await fetch(`${API}/api/v1/jobs`, {
    method: 'POST',
    body: formData,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const base = data.error || `Reconstruction API error ${res.status}`
    throw new Error(base + apiErrorSuffix(res.status, data))
  }
  return { jobId: data.job_id, mode: data.mode }
}

/**
 * Poll until succeeded or failed. onStatus receives status string (queued | preparing | running | …).
 */
export async function pollLocalReconJob(jobId, onStatus, intervalMs = 2000) {
  for (;;) {
    const res = await fetch(`${API}/api/v1/jobs/${jobId}`)
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const base = data.error || `Job poll failed ${res.status}`
      throw new Error(base + apiErrorSuffix(res.status, data))
    }
    onStatus?.(data.status)
    if (data.status === 'succeeded') return data
    if (data.status === 'failed') {
      throw new Error(data.error || 'Reconstruction failed')
    }
    await sleep(intervalMs)
  }
}

export async function fetchReconModelGlbBlob(jobId) {
  const res = await fetch(`${API}/api/v1/jobs/${jobId}/model.glb`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err.error || `Could not download model (${res.status})`) + apiErrorSuffix(res.status, err))
  }
  return res.blob()
}
