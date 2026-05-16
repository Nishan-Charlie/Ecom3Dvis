import { uploadBytesResumable, getDownloadURL } from 'firebase/storage'

function storageErrorMessage(err) {
  const code = err?.code || ''
  const msg = err?.message || String(err)
  if (code === 'storage/unauthorized') {
    return `${msg} — In Firebase Console → Storage → Rules, allow authenticated users to write (e.g. request.auth != null).`
  }
  if (code === 'storage/canceled') {
    return 'Upload was canceled (often due to timeout or leaving the page).'
  }
  if (code === 'storage/retry-limit-exceeded' || code === 'storage/unknown') {
    return `${msg} — Check network, VPN, and ad blockers; confirm Storage is enabled and your project is on a plan that includes Storage (new buckets often need the Blaze plan).`
  }
  return msg
}

/**
 * Resumable upload with progress; surfaces real Firebase errors instead of hanging silently.
 */
export async function uploadBlobResumable(storageRef, blob, { onProgress, timeoutMs = 600000, contentType } = {}) {
  return new Promise((resolve, reject) => {
    onProgress?.(0)
    const metadata = contentType ? { contentType } : undefined
    const task = uploadBytesResumable(storageRef, blob, metadata)
    const timer = setTimeout(() => {
      try {
        task.cancel()
      } catch {
        /* ignore */
      }
      reject(
        new Error(
          `Upload timed out after ${Math.round(timeoutMs / 1000)}s. Check: (1) Firebase Console → Storage is enabled and bucket name matches .env, (2) Storage rules allow your signed-in user, (3) network / VPN / ad blockers.`,
        ),
      )
    }, timeoutMs)

    task.on(
      'state_changed',
      (snapshot) => {
        if (!onProgress) return
        if (snapshot.totalBytes > 0) {
          const pct = Math.round((100 * snapshot.bytesTransferred) / snapshot.totalBytes)
          onProgress(pct)
        } else {
          onProgress(0)
        }
      },
      (err) => {
        clearTimeout(timer)
        reject(new Error(storageErrorMessage(err)))
      },
      async () => {
        clearTimeout(timer)
        try {
          const url = await getDownloadURL(task.snapshot.ref)
          resolve(url)
        } catch (err) {
          reject(new Error(storageErrorMessage(err)))
        }
      },
    )
  })
}
