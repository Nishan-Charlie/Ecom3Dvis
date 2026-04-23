import { useState, useCallback } from 'react'
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'

// Sampling mode definitions (RQ2: frame density comparison)
export const SAMPLING_MODES = {
  dense: { fps: 5, label: 'Dense (5 fps)', description: 'Most frames, best coverage' },
  medium: { fps: 2, label: 'Medium (2 fps)', description: 'Balanced quality/speed' },
  sparse: { fps: 1, label: 'Sparse (1 fps)', description: 'Fewest frames, fastest' },
}

// Laplacian variance blur detection (OpenCV.js approach replicated in JS)
// Returns variance of Laplacian approximated via convolution
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

async function getImageData(blob) {
  return new Promise((resolve) => {
    const img = new Image()
    const url = URL.createObjectURL(blob)
    img.onload = () => {
      // Downscale for speed (128×128 is enough for blur detection)
      const canvas = document.createElement('canvas')
      canvas.width = 128
      canvas.height = 128
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, 128, 128)
      resolve(ctx.getImageData(0, 0, 128, 128))
      URL.revokeObjectURL(url)
    }
    img.src = url
  })
}

let ffmpegInstance = null

async function getFFmpeg(onLog) {
  if (ffmpegInstance) return ffmpegInstance
  const ff = new FFmpeg()
  ff.on('log', ({ message }) => onLog?.(message))
  await ff.load({
    coreURL: await toBlobURL('https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.js', 'text/javascript'),
    wasmURL: await toBlobURL('https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.wasm', 'application/wasm'),
  })
  ffmpegInstance = ff
  return ff
}

export default function FrameExtractor({ videoFile, onFramesReady }) {
  const [mode, setMode] = useState('medium')
  const [blurThreshold, setBlurThreshold] = useState(100)
  const [status, setStatus] = useState('idle') // idle | loading_ffmpeg | extracting | filtering | done | error
  const [progress, setProgress] = useState(0)
  const [log, setLog] = useState('')
  const [stats, setStats] = useState(null)

  const addLog = useCallback((msg) => setLog((l) => `${l}\n${msg}`), [])

  async function run() {
    if (!videoFile) return
    setStatus('loading_ffmpeg')
    setLog('')
    setStats(null)

    try {
      const ff = await getFFmpeg(addLog)
      setStatus('extracting')

      const fps = SAMPLING_MODES[mode].fps
      await ff.writeFile('input.mp4', await fetchFile(videoFile))

      // Extract frames as JPEG
      await ff.exec([
        '-i', 'input.mp4',
        '-vf', `fps=${fps}`,
        '-q:v', '2',
        'frame_%04d.jpg',
      ])

      // Collect extracted frame files
      const files = await ff.listDir('/')
      const frameFiles = files.filter((f) => f.name.startsWith('frame_') && f.name.endsWith('.jpg'))
      frameFiles.sort((a, b) => a.name.localeCompare(b.name))

      setProgress(10)

      // Quality filter
      setStatus('filtering')
      const accepted = []
      const rejected = []

      for (let i = 0; i < frameFiles.length; i++) {
        const frameData = await ff.readFile(frameFiles[i].name)
        const blob = new Blob([frameData], { type: 'image/jpeg' })
        const imgData = await getImageData(blob)
        const sharp = isSharp(imgData, blurThreshold)

        if (sharp) {
          accepted.push({ name: frameFiles[i].name, blob, dataUrl: URL.createObjectURL(blob) })
        } else {
          rejected.push(frameFiles[i].name)
        }

        setProgress(10 + Math.round((i / frameFiles.length) * 85))
      }

      setProgress(100)
      setStats({
        total: frameFiles.length,
        accepted: accepted.length,
        rejected: rejected.length,
        mode,
        fps,
      })
      setStatus('done')
      onFramesReady?.(accepted)

      // Cleanup
      for (const f of frameFiles) {
        await ff.deleteFile(f.name).catch(() => {})
      }
      await ff.deleteFile('input.mp4').catch(() => {})
    } catch (err) {
      console.error(err)
      addLog(`ERROR: ${err.message}`)
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
          <div className="flex justify-between text-sm">
            <span className="text-gray-400 capitalize">{status.replace('_', ' ')}</span>
            <span className="text-violet-400">{progress}%</span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2">
            <div
              className="bg-violet-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {stats && (
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="bg-gray-800 rounded-lg p-3">
            <p className="text-2xl font-bold text-white">{stats.total}</p>
            <p className="text-xs text-gray-500">Total frames</p>
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
        disabled={!videoFile || status === 'loading_ffmpeg' || status === 'extracting' || status === 'filtering'}
        className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-3 rounded-xl transition-colors"
      >
        {status === 'loading_ffmpeg' ? 'Loading ffmpeg.wasm…'
          : status === 'extracting' ? 'Extracting frames…'
          : status === 'filtering' ? 'Filtering blurry frames…'
          : 'Extract Frames'}
      </button>
    </div>
  )
}
