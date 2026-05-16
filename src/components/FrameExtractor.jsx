import { useState, useRef, useEffect } from 'react'

// Sampling mode definitions (RQ2: frame density comparison)
const SAMPLING_MODES = {
  dense: { fps: 5, label: 'Dense (5 fps)', description: 'Most frames, best coverage' },
  medium: { fps: 2, label: 'Medium (2 fps)', description: 'Balanced quality/speed' },
  sparse: { fps: 1, label: 'Sparse (1 fps)', description: 'Fewest frames, fastest' },
}

/** Caps cost: native decode is fast; these limit work per clip. */
const SAMPLE_CAPS = {
  dense: { maxWidth: 960, maxFrames: 120 },
  medium: { maxWidth: 960, maxFrames: 80 },
  sparse: { maxWidth: 854, maxFrames: 55 },
}

function laplacianVariance(imageData) {
  const { data, width, height } = imageData
  const kernel = [0, 1, 0, 1, -4, 1, 0, 1, 0]
  let sum = 0
  let sumSq = 0
  let count = 0

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let lap = 0
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const idx = ((y + ky) * width + (x + kx)) * 4
          const gray = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]
          lap += gray * kernel[(ky + 1) * 3 + (kx + 1)]
        }
      }
      sum += lap
      sumSq += lap * lap
      count++
    }
  }

  const mean = sum / count
  return sumSq / count - mean * mean
}

function isSharp(imageData, threshold = 100) {
  return laplacianVariance(imageData) >= threshold
}

function seekVideo(video, time) {
  const duration = video.duration
  if (!Number.isFinite(duration) || duration <= 0) {
    return Promise.reject(new Error('Invalid video duration'))
  }
  const target = Math.min(Math.max(0, time), Math.max(0, duration - 1e-3))
  return new Promise((resolve, reject) => {
    if (Math.abs(video.currentTime - target) < 0.02) {
      requestAnimationFrame(() => resolve())
      return
    }
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('error', onErr)
      resolve()
    }
    const onErr = () => {
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('error', onErr)
      reject(new Error('Video seek failed'))
    }
    video.addEventListener('seeked', onSeeked, { once: true })
    video.addEventListener('error', onErr, { once: true })
    video.currentTime = target
  })
}

function canvasToJpegBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Could not encode frame as JPEG'))),
      'image/jpeg',
      quality,
    )
  })
}

/**
 * Sample frames using the browser video decoder + canvas (hardware-backed).
 * Much faster than ffmpeg.wasm for typical MP4/WebM.
 */
async function sampleFramesFromVideo(videoFile, { fps, maxFrames, maxWidth, blurThreshold, onProgress }) {
  const objectUrl = URL.createObjectURL(videoFile)
  const video = document.createElement('video')
  video.src = objectUrl
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'

  await new Promise((resolve, reject) => {
    const ok = () => {
      video.removeEventListener('loadedmetadata', ok)
      video.removeEventListener('error', bad)
      resolve()
    }
    const bad = () => {
      video.removeEventListener('loadedmetadata', ok)
      video.removeEventListener('error', bad)
      reject(new Error('Could not load video. Use MP4 (H.264) or WebM that plays in this browser.'))
    }
    if (video.readyState >= 1) queueMicrotask(ok)
    else {
      video.addEventListener('loadedmetadata', ok, { once: true })
      video.addEventListener('error', bad, { once: true })
    }
  })

  const duration = video.duration
  if (!Number.isFinite(duration) || duration <= 0) {
    URL.revokeObjectURL(objectUrl)
    throw new Error('Could not read video duration.')
  }

  const vw = video.videoWidth
  const vh = video.videoHeight
  if (!vw || !vh) {
    URL.revokeObjectURL(objectUrl)
    throw new Error('Could not read video dimensions.')
  }

  const scale = Math.min(1, maxWidth / vw)
  const cw = Math.max(1, Math.round(vw * scale))
  const ch = Math.max(1, Math.round(vh * scale))
  const canvas = document.createElement('canvas')
  canvas.width = cw
  canvas.height = ch
  const ctx = canvas.getContext('2d', { willReadFrequently: true })

  const thumb = document.createElement('canvas')
  thumb.width = 128
  thumb.height = 128
  const tctx = thumb.getContext('2d', { willReadFrequently: true })

  const interval = 1 / fps
  const planned = Math.ceil(duration * fps)
  const totalSamples = Math.min(maxFrames, planned)

  const accepted = []
  const rejectedNames = []

  try {
    for (let i = 0; i < totalSamples; i++) {
      const sampleT = Math.min(duration - 1e-3, i * interval)
      await seekVideo(video, sampleT)
      ctx.drawImage(video, 0, 0, cw, ch)
      tctx.drawImage(canvas, 0, 0, 128, 128)
      const imageData = tctx.getImageData(0, 0, 128, 128)
      const sharp = isSharp(imageData, blurThreshold)
      const name = `frame_${String(i + 1).padStart(4, '0')}.jpg`

      if (sharp) {
        const blob = await canvasToJpegBlob(canvas, 0.88)
        accepted.push({ name, blob, dataUrl: URL.createObjectURL(blob) })
      } else {
        rejectedNames.push(name)
      }

      onProgress?.(Math.round(((i + 1) / totalSamples) * 100))
      if (i % 2 === 0) await new Promise((r) => requestAnimationFrame(r))
    }
  } finally {
    URL.revokeObjectURL(objectUrl)
    video.removeAttribute('src')
    video.load()
  }

  return {
    total: totalSamples,
    accepted,
    rejected: rejectedNames.length,
  }
}

export default function FrameExtractor({ videoFile, onFramesReady }) {
  const [mode, setMode] = useState('dense')
  const [blurThreshold, setBlurThreshold] = useState(70)
  const [status, setStatus] = useState('idle') // idle | preparing | extracting | done | error
  const [progress, setProgress] = useState(0)
  const [lastError, setLastError] = useState('')
  const [stats, setStats] = useState(null)
  const [statusHint, setStatusHint] = useState('')
  const [elapsedSec, setElapsedSec] = useState(0)
  const longWorkRef = useRef(null)
  const workStartedAtRef = useRef(0)

  const workInProgress = status === 'preparing' || status === 'extracting'

  useEffect(() => {
    if (!workInProgress) {
      if (longWorkRef.current) {
        clearInterval(longWorkRef.current)
        longWorkRef.current = null
      }
      workStartedAtRef.current = 0
      return
    }
    workStartedAtRef.current = Date.now()
    longWorkRef.current = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - workStartedAtRef.current) / 1000))
    }, 500)
    return () => {
      if (longWorkRef.current) {
        clearInterval(longWorkRef.current)
        longWorkRef.current = null
      }
    }
  }, [workInProgress])

  async function run() {
    if (!videoFile) return
    setStatus('preparing')
    setProgress(0)
    setLastError('')
    setStats(null)
    setStatusHint('Opening video with the browser decoder (usually a few seconds)…')

    try {
      const caps = SAMPLE_CAPS[mode] || SAMPLE_CAPS.medium
      const fps = SAMPLING_MODES[mode].fps

      setStatus('extracting')
      setStatusHint(
        `Sampling up to ${caps.maxFrames} frames at ${fps} fps, then discarding blurry ones (Laplacian variance).`,
      )

      const { total, accepted, rejected } = await sampleFramesFromVideo(videoFile, {
        fps,
        maxFrames: caps.maxFrames,
        maxWidth: caps.maxWidth,
        blurThreshold,
        onProgress: setProgress,
      })

      setProgress(100)
      if (total > 0 && accepted.length === 0) {
        setStatusHint(
          'Every sampled frame looked blurry at this threshold. Lower “Blur Threshold” or pick Sparse, then run Extract again.',
        )
      } else {
        setStatusHint('')
      }

      setStats({
        total,
        accepted: accepted.length,
        rejected,
        mode,
        fps,
      })
      setStatus('done')
      onFramesReady?.(accepted)
    } catch (err) {
      console.error(err)
      setStatusHint('')
      setLastError(err?.message || String(err))
      setStatus('error')
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium text-gray-300 mb-2">Frame Sampling Mode</p>
        <div className="grid grid-cols-3 gap-2">
          {Object.entries(SAMPLING_MODES).map(([key, val]) => (
            <button
              key={key}
              onClick={() => setMode(key)}
              className={`p-3 rounded-xl border text-left transition-all ${
                mode === key
                  ? 'border-violet-500 bg-violet-500/10 text-violet-300'
                  : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600'
              }`}
            >
              <p className="font-medium text-sm">{val.label}</p>
              <p className="text-xs mt-0.5 opacity-70">{val.description}</p>
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-sm font-medium text-gray-300 flex justify-between">
          Blur Threshold
          <span className="text-violet-400">{blurThreshold}</span>
        </label>
        <input
          type="range"
          min={20}
          max={300}
          value={blurThreshold}
          onChange={(e) => setBlurThreshold(Number(e.target.value))}
          className="w-full mt-1 accent-violet-500"
        />
        <p className="text-xs text-gray-500 mt-1">
          Frames with Laplacian variance below this are discarded as blurry
        </p>
      </div>

      {status !== 'idle' && (
        <div className="bg-gray-800 rounded-xl p-3 space-y-2">
          <div className="flex justify-between text-sm gap-2">
            <span className={`capitalize ${status === 'error' ? 'text-red-400' : 'text-gray-400'}`}>
              {status.replaceAll('_', ' ')}
            </span>
            <span className="text-violet-400 shrink-0 tabular-nums">
              {progress}%
              {workInProgress && (
                <span className="text-gray-500 font-normal ml-2">{elapsedSec}s</span>
              )}
            </span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all duration-300 ${status === 'error' ? 'bg-red-500' : 'bg-violet-500'}`}
              style={{ width: `${progress}%` }}
            />
          </div>
          {statusHint && status !== 'error' && (
            <p className="text-xs text-gray-500 leading-relaxed">{statusHint}</p>
          )}
          {status === 'error' && lastError && (
            <p className="text-xs text-red-300/90 whitespace-pre-wrap break-words">{lastError}</p>
          )}
        </div>
      )}

      {stats && (
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="bg-gray-800 rounded-lg p-3">
            <p className="text-2xl font-bold text-white">{stats.total}</p>
            <p className="text-xs text-gray-500">Sampled frames</p>
          </div>
          <div className="bg-emerald-900/30 border border-emerald-800/50 rounded-lg p-3">
            <p className="text-2xl font-bold text-emerald-400">{stats.accepted}</p>
            <p className="text-xs text-gray-500">Accepted</p>
          </div>
          <div className="bg-red-900/30 border border-red-800/50 rounded-lg p-3">
            <p className="text-2xl font-bold text-red-400">{stats.rejected}</p>
            <p className="text-xs text-gray-500">Blurry (rejected)</p>
          </div>
        </div>
      )}

      <button
        onClick={run}
        disabled={!videoFile || workInProgress}
        className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-3 rounded-xl transition-colors"
      >
        {status === 'preparing' ? 'Opening video…'
          : status === 'extracting' ? 'Sampling frames…'
          : 'Extract Frames'}
      </button>
    </div>
  )
}
