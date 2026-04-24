import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { storage } from '../lib/firebase'
import { useAuth } from '../hooks/useAuth'
import { createListing, updateListing } from '../hooks/useListings'
import FrameExtractor from '../components/FrameExtractor'
import { reconstructTripoSR, reconstructGaussianSplatting } from '../lib/replicate'
import { checkServerAvailable, startLocalReconstruction, connectJobSocket } from '../lib/localPipeline'

const STEPS = ['Details', 'Video', 'Frames', 'Reconstruct', 'Done']

const STAGE_LABELS = {
  queued: 'Queued…',
  extracting_frames: 'Extracting frames…',
  removing_background: 'Removing background…',
  estimating_cameras: 'Estimating camera poses…',
  reconstructing: 'Running NeRF reconstruction…',
  cleaning_mesh: 'Cleaning mesh…',
  exporting: 'Exporting GLB…',
  uploading: 'Uploading to Firebase…',
  done: 'Done!',
  failed: 'Failed',
}

const CATEGORIES = ['electronics', 'clothing', 'furniture', 'toys', 'books', 'ceramics']
const CONDITIONS = [
  { value: 'new', label: 'New' },
  { value: 'like_new', label: 'Like New' },
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
  { value: 'poor', label: 'Poor' },
]
const RECON_METHODS = [
  { value: 'triposr', label: 'TripoSR', desc: 'Fast (10–20s). Single best frame. Uses Replicate API.' },
  { value: '3dgs', label: '3D Gaussian Splatting', desc: 'High quality (1–3 min). Multi-view. Uses Replicate API.' },
  { value: 'local_gpu', label: 'Local GPU', desc: 'Full NeRF pipeline on your machine — 3–6 min. Run server.py first. No API costs.' },
]

export default function Upload() {
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  const videoInputRef = useRef()

  const [step, setStep] = useState(0)

  // Step 0 — listing details
  const [form, setForm] = useState({ title: '', description: '', price: '', category: 'electronics', condition: 'good' })

  // Step 1 — video
  const [videoFile, setVideoFile] = useState(null)
  const [videoPreview, setVideoPreview] = useState(null)

  // Step 2 — frames
  const [frames, setFrames] = useState([])

  // Step 3 — reconstruct
  const [method, setMethod] = useState('triposr')
  const [reconStatus, setReconStatus] = useState('idle') // idle | uploading | running | done | error
  const [reconProgress, setReconProgress] = useState(null)
  const [reconError, setReconError] = useState(null)
  const [listingId, setListingId] = useState(null)
  // Local GPU pipeline extras
  const [localStage, setLocalStage] = useState(null)
  const [localProgressPct, setLocalProgressPct] = useState(0)

  if (!user || profile?.role !== 'seller') {
    return (
      <div className="flex-1 flex items-center justify-center flex-col gap-3 px-6 text-center">
        <p className="text-gray-300 text-lg">You need a seller account to list items.</p>
        <a href="/auth?mode=register&role=seller" className="text-violet-400 hover:underline">Create a seller account</a>
      </div>
    )
  }

  function handleVideoSelect(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setVideoFile(file)
    setVideoPreview(URL.createObjectURL(file))
    setFrames([])
  }

  async function handleReconstruct() {
    if (!frames.length) return
    setReconStatus('uploading')
    setReconError(null)

    try {
      // 1. Create listing doc in Firestore
      const docRef = await createListing({
        title: form.title,
        description: form.description,
        price: parseFloat(form.price),
        category: form.category,
        condition: form.condition,
        sellerId: user.uid,
        sellerName: profile.displayName,
        samplingMode: null,
        reconstructionMethod: method,
        frameStats: null,
      })
      setListingId(docRef.id)

      // 2. Upload thumbnail (first accepted frame)
      const thumbRef = ref(storage, `listings/${docRef.id}/thumbnail.jpg`)
      await uploadBytes(thumbRef, frames[0].blob)
      const thumbnailUrl = await getDownloadURL(thumbRef)
      await updateListing(docRef.id, { thumbnailUrl })

      // 3. Upload frames for 3DGS (if needed)
      let imageUrls = []
      if (method === '3dgs') {
        setReconStatus('uploading')
        imageUrls = await Promise.all(
          frames.map(async (f, i) => {
            const fr = ref(storage, `listings/${docRef.id}/frames/frame_${i}.jpg`)
            await uploadBytes(fr, f.blob)
            return getDownloadURL(fr)
          })
        )
      }

      // 4. Call Replicate API
      setReconStatus('running')
      const startMs = Date.now()

      let output
      if (method === 'triposr') {
        // Convert blob to data URL for TripoSR
        const reader = new FileReader()
        const dataUrl = await new Promise((res) => {
          reader.onloadend = () => res(reader.result)
          reader.readAsDataURL(frames[0].blob)
        })
        output = await reconstructTripoSR(dataUrl, (pred) => {
          setReconProgress(pred.status)
        })
      } else {
        output = await reconstructGaussianSplatting(imageUrls, (pred) => {
          setReconProgress(pred.status)
        })
      }

      const processingTimeMs = Date.now() - startMs

      // 5. Save model URL and metadata to Firestore
      const modelUrl = Array.isArray(output) ? output[0] : output
      await updateListing(docRef.id, {
        modelUrl,
        status: 'ready',
        processingTimeMs,
        frameStats: {
          total: frames.length,
          accepted: frames.length,
          blurThreshold: 100,
        },
      })

      setReconStatus('done')
      setStep(4)
    } catch (err) {
      console.error(err)
      setReconError(err.message)
      setReconStatus('error')
      if (listingId) await updateListing(listingId, { status: 'failed' })
    }
  }

  async function handleLocalReconstruct() {
    if (!videoFile) return
    setReconStatus('uploading')
    setReconError(null)

    const available = await checkServerAvailable()
    if (!available) {
      setReconError('Local server is not running. Start it with: python server.py')
      setReconStatus('error')
      return
    }

    let docId = null
    try {
      // 1. Create listing doc
      const docRef = await createListing({
        title: form.title,
        description: form.description,
        price: parseFloat(form.price),
        category: form.category,
        condition: form.condition,
        sellerId: user.uid,
        sellerName: profile.displayName,
        reconstructionMethod: 'local_gpu',
        samplingMode: null,
        frameStats: null,
      })
      docId = docRef.id
      setListingId(docRef.id)

      // 2. Upload thumbnail from extracted frames (if available)
      if (frames.length > 0) {
        const thumbRef = ref(storage, `listings/${docRef.id}/thumbnail.jpg`)
        await uploadBytes(thumbRef, frames[0].blob)
        const thumbnailUrl = await getDownloadURL(thumbRef)
        await updateListing(docRef.id, { thumbnailUrl })
      }

      // 3. Send video to local server and open WebSocket
      setReconStatus('running')
      setLocalStage('queued')
      setLocalProgressPct(0)

      await startLocalReconstruction({
        videoFile,
        productName: form.title,
        sellerUid: user.uid,
        listingId: docRef.id,
      })

      await new Promise((resolve, reject) => {
        const ws = connectJobSocket(
          docRef.id,
          (update) => {
            setLocalStage(update.stage)
            setLocalProgressPct(update.progress ?? 0)
            if (update.stage === 'done') {
              ws.close()
              resolve()
            } else if (update.stage === 'failed') {
              ws.close()
              reject(new Error(update.error ?? 'Reconstruction failed on local server'))
            }
          },
          (errMsg) => {
            reject(new Error(errMsg))
          }
        )
      })

      setReconStatus('done')
      setStep(4)
    } catch (err) {
      console.error(err)
      setReconError(err.message)
      setReconStatus('error')
      if (docId) await updateListing(docId, { status: 'failed' })
    }
  }

  return (
    <div className="flex-1 max-w-2xl mx-auto px-4 md:px-8 py-12 w-full">
      <h1 className="text-2xl font-bold text-white mb-2">List an Item</h1>
      <p className="text-gray-400 text-sm mb-8">Walk through the steps to create a 3D listing.</p>

      {/* Step indicator */}
      <div className="flex items-center gap-1 mb-10">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center flex-1">
            <div className={`w-7 h-7 rounded-full text-xs font-bold flex items-center justify-center shrink-0 ${
              i < step ? 'bg-violet-600 text-white'
              : i === step ? 'bg-violet-600 text-white ring-2 ring-violet-400 ring-offset-2 ring-offset-gray-950'
              : 'bg-gray-800 text-gray-500'
            }`}>
              {i < step ? '✓' : i + 1}
            </div>
            {i < STEPS.length - 1 && (
              <div className={`flex-1 h-px mx-1 ${i < step ? 'bg-violet-600' : 'bg-gray-800'}`} />
            )}
          </div>
        ))}
      </div>

      {/* Step 0: Details */}
      {step === 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-white">Item Details</h2>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Title *</label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Sony WH-1000XM4 Headphones"
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white placeholder-gray-600 focus:outline-none focus:border-violet-500 text-sm"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              rows={3}
              placeholder="Describe the item's condition, any defects, accessories included…"
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white placeholder-gray-600 focus:outline-none focus:border-violet-500 text-sm resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Price (£) *</label>
              <input
                type="number"
                min={0}
                step={0.01}
                value={form.price}
                onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                placeholder="0.00"
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white placeholder-gray-600 focus:outline-none focus:border-violet-500 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Category *</label>
              <select
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-violet-500 text-sm"
              >
                {CATEGORIES.map((c) => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-2">Condition *</label>
            <div className="flex gap-2 flex-wrap">
              {CONDITIONS.map((c) => (
                <button
                  key={c.value}
                  onClick={() => setForm((f) => ({ ...f, condition: c.value }))}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                    form.condition === c.value
                      ? 'bg-violet-600 text-white'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={() => setStep(1)}
            disabled={!form.title || !form.price}
            className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-colors mt-2"
          >
            Continue
          </button>
        </div>
      )}

      {/* Step 1: Video upload */}
      {step === 1 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-white">Upload Video</h2>
          <div className="bg-gray-900 border border-violet-500/20 rounded-2xl p-4 space-y-2">
            <p className="text-sm font-medium text-violet-300">Recording guidelines</p>
            <ul className="text-sm text-gray-400 space-y-1 list-disc list-inside">
              <li>30-second clip rotating 360° around the item</li>
              <li>Steady movement, plain background</li>
              <li>Good lighting — avoid reflections and shadows</li>
              <li>Keep the item centred throughout</li>
            </ul>
          </div>

          <div
            className="border-2 border-dashed border-gray-700 hover:border-violet-500 rounded-2xl p-8 text-center cursor-pointer transition-colors"
            onClick={() => videoInputRef.current?.click()}
          >
            {videoPreview ? (
              <video src={videoPreview} className="max-h-48 mx-auto rounded-xl" controls />
            ) : (
              <div className="space-y-2">
                <svg className="w-12 h-12 mx-auto text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.069A1 1 0 0121 8.87v6.26a1 1 0 01-1.447.899L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                <p className="text-gray-400 text-sm">Click to select a video file</p>
                <p className="text-gray-600 text-xs">MP4, MOV, WebM — max 200 MB</p>
              </div>
            )}
            <input ref={videoInputRef} type="file" accept="video/*" onChange={handleVideoSelect} className="hidden" />
          </div>

          <div className="flex gap-3">
            <button onClick={() => setStep(0)} className="flex-1 bg-gray-800 hover:bg-gray-700 text-white py-3 rounded-xl transition-colors">Back</button>
            <button
              onClick={() => setStep(2)}
              disabled={!videoFile}
              className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-colors"
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Frame extraction */}
      {step === 2 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-white">Extract Frames</h2>
          <p className="text-sm text-gray-400">
            ffmpeg.wasm runs in your browser to extract frames and filter blurry ones using Laplacian variance.
          </p>
          <FrameExtractor
            videoFile={videoFile}
            onFramesReady={(accepted) => setFrames(accepted)}
          />
          {frames.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm text-gray-400">{frames.length} frames ready — preview:</p>
              <div className="flex gap-2 overflow-x-auto pb-2">
                {frames.slice(0, 12).map((f, i) => (
                  <img key={i} src={f.dataUrl} alt="" className="h-16 w-16 object-cover rounded-lg shrink-0 border border-gray-700" />
                ))}
                {frames.length > 12 && (
                  <div className="h-16 w-16 bg-gray-800 rounded-lg flex items-center justify-center text-gray-500 text-xs shrink-0">
                    +{frames.length - 12}
                  </div>
                )}
              </div>
            </div>
          )}
          <div className="flex gap-3">
            <button onClick={() => setStep(1)} className="flex-1 bg-gray-800 hover:bg-gray-700 text-white py-3 rounded-xl transition-colors">Back</button>
            <button
              onClick={() => setStep(3)}
              disabled={frames.length === 0}
              className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-colors"
            >
              Continue ({frames.length} frames)
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Reconstruct */}
      {step === 3 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-white">3D Reconstruction</h2>
          <p className="text-sm text-gray-400">Choose a reconstruction method and generate the 3D model.</p>

          <div className="grid gap-3">
            {RECON_METHODS.map((m) => (
              <button
                key={m.value}
                onClick={() => setMethod(m.value)}
                className={`p-4 rounded-xl border text-left transition-all ${
                  method === m.value
                    ? 'border-violet-500 bg-violet-500/10'
                    : 'border-gray-700 bg-gray-800 hover:border-gray-600'
                }`}
              >
                <p className={`font-medium text-sm ${method === m.value ? 'text-violet-300' : 'text-white'}`}>{m.label}</p>
                <p className="text-xs text-gray-500 mt-0.5">{m.desc}</p>
              </button>
            ))}
          </div>

          {/* Replicate API progress */}
          {reconStatus === 'running' && method !== 'local_gpu' && reconProgress && (
            <div className="bg-gray-800 rounded-xl px-4 py-3 flex items-center gap-3">
              <div className="w-5 h-5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin shrink-0" />
              <p className="text-sm text-gray-300 capitalize">{reconProgress.replace('_', ' ')}…</p>
            </div>
          )}

          {/* Local GPU progress */}
          {reconStatus === 'running' && method === 'local_gpu' && (
            <div className="bg-gray-800 rounded-xl px-4 py-3 space-y-2">
              <div className="flex items-center gap-3">
                <div className="w-5 h-5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin shrink-0" />
                <p className="text-sm text-gray-300">{STAGE_LABELS[localStage] ?? 'Processing…'}</p>
                <span className="ml-auto text-xs text-gray-500">{localProgressPct}%</span>
              </div>
              <div className="w-full h-1.5 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-violet-500 rounded-full transition-all duration-500"
                  style={{ width: `${localProgressPct}%` }}
                />
              </div>
            </div>
          )}

          {reconError && (
            <div className="bg-red-900/30 border border-red-700 rounded-xl px-4 py-3 text-sm text-red-300">
              {reconError}
            </div>
          )}

          {method === 'local_gpu' && reconStatus === 'idle' && (
            <p className="text-xs text-gray-500 bg-gray-800/60 border border-gray-700 rounded-xl px-3 py-2">
              Make sure <span className="text-gray-300 font-mono">python server.py</span> is running in the
              reconstruction-tool folder before clicking Generate.
            </p>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => setStep(2)}
              disabled={reconStatus === 'uploading' || reconStatus === 'running'}
              className="flex-1 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-white py-3 rounded-xl transition-colors"
            >
              Back
            </button>
            <button
              onClick={method === 'local_gpu' ? handleLocalReconstruct : handleReconstruct}
              disabled={reconStatus === 'uploading' || reconStatus === 'running'}
              className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-colors"
            >
              {reconStatus === 'uploading' ? 'Uploading…'
                : reconStatus === 'running' ? 'Reconstructing…'
                : 'Generate 3D Model'}
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Done */}
      {step === 4 && (
        <div className="text-center space-y-6 py-8">
          <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto">
            <svg className="w-8 h-8 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white mb-2">Listing Created!</h2>
            <p className="text-gray-400">Your 3D model has been generated and your listing is live.</p>
          </div>
          <div className="flex gap-3 justify-center">
            {listingId && (
              <button
                onClick={() => navigate(`/listing/${listingId}`)}
                className="bg-violet-600 hover:bg-violet-500 text-white font-semibold px-6 py-3 rounded-xl transition-colors"
              >
                View Listing
              </button>
            )}
            <button
              onClick={() => navigate('/dashboard')}
              className="bg-gray-800 hover:bg-gray-700 text-white px-6 py-3 rounded-xl transition-colors"
            >
              Go to Dashboard
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
