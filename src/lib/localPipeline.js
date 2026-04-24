const LOCAL_API = 'http://localhost:8000'

export async function checkServerAvailable() {
  try {
    const res = await fetch(`${LOCAL_API}/api/health`, {
      signal: AbortSignal.timeout(3000),
    })
    return res.ok
  } catch {
    return false
  }
}

export async function startLocalReconstruction({ videoFile, productName, sellerUid, listingId }) {
  const formData = new FormData()
  formData.append('video', videoFile)
  formData.append('product_name', productName)
  formData.append('seller_uid', sellerUid)
  formData.append('listing_id', listingId)

  const res = await fetch(`${LOCAL_API}/api/start`, {
    method: 'POST',
    body: formData,
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail ?? `Server error ${res.status}`)
  }
  return res.json()
}

export function connectJobSocket(jobId, onUpdate, onError) {
  const ws = new WebSocket(`ws://localhost:8000/ws/${jobId}`)

  ws.onmessage = (e) => {
    const data = JSON.parse(e.data)
    if (!data.ping) onUpdate(data)
  }

  ws.onerror = () => {
    onError?.('Cannot connect to local server. Make sure server.py is running.')
  }

  return ws
}
