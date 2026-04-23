const API = 'https://api.replicate.com/v1'
const TOKEN = import.meta.env.VITE_REPLICATE_API_TOKEN

// TripoSR: fast single-image → mesh (10-20s)
const TRIPOSR_MODEL = 'stability-ai/triposr'
const TRIPOSR_VERSION = '3e8b8b9b3e8b9b3e8b8b9b3e8b9b3e8b8b9b3e8b9b3e8b8b9b3e8b9b3e8b8b'

// 3D Gaussian Splatting: quality multi-view (1-3 min)
const GAUSSIAN_MODEL = 'camenduru/gaussian-splatting'

async function createPrediction(model, input) {
  const res = await fetch(`${API}/predictions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'Prefer': 'wait',
    },
    body: JSON.stringify({ model, input }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail ?? `Replicate error ${res.status}`)
  }
  return res.json()
}

async function getPrediction(id) {
  const res = await fetch(`${API}/predictions/${id}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  })
  if (!res.ok) throw new Error(`Replicate get error ${res.status}`)
  return res.json()
}

function pollUntilDone(predictionId, onProgress, intervalMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setInterval(async () => {
      try {
        const pred = await getPrediction(predictionId)
        onProgress?.(pred)
        if (pred.status === 'succeeded') {
          clearInterval(timer)
          resolve(pred.output)
        } else if (pred.status === 'failed' || pred.status === 'canceled') {
          clearInterval(timer)
          reject(new Error(`Prediction ${pred.status}: ${pred.error}`))
        }
      } catch (err) {
        clearInterval(timer)
        reject(err)
      }
    }, intervalMs)
  })
}

export async function reconstructTripoSR(imageDataUrl, onProgress) {
  const pred = await createPrediction(TRIPOSR_MODEL, { image: imageDataUrl })
  if (pred.status === 'succeeded') return pred.output
  return pollUntilDone(pred.id, onProgress)
}

export async function reconstructGaussianSplatting(imageUrls, onProgress) {
  const pred = await createPrediction(GAUSSIAN_MODEL, { images: imageUrls })
  if (pred.status === 'succeeded') return pred.output
  return pollUntilDone(pred.id, onProgress, 6000)
}
