import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ref } from 'firebase/storage'
import { storage } from '../lib/firebase'
import { uploadBlobResumable } from '../lib/storageUpload'
import { useAuth } from '../hooks/useAuth'
import { newListingRef, commitListingDraft, updateListing, markListingReconstructionFailed } from '../hooks/useListings'
import FrameExtractor from '../components/FrameExtractor'

import { checkServerAvailable, startLocalReconstruction, connectJobSocket } from '../lib/localPipeline'

import {
  createLocalReconJob,
  pollLocalReconJob,
  fetchReconModelGlbBlob,
  MAX_MULTIVIEW_IMAGES,
  selectViewsForMultiViewReconstruction,
} from '../lib/localReconstruct'


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
  {
    value: 'single',
    label: 'Single view (flat card)',
    desc: 'One frame → textured quad in GLB. Looks 2D from the side; use only for a quick placeholder.',
  },
  {
    value: 'multi',
    label: 'Multi-view 3D (recommended)',
    desc: `Up to ${MAX_MULTIVIEW_IMAGES} sharp, evenly spread frames → COLMAP + Poisson mesh GLB. Requires npm run recon + COLMAP.`,
  },
  {
    value: 'local_gpu',
    label: 'Local GPU (NeRF)',
    desc: 'Full NeRF pipeline on your machine (python server.py on port 8000). 3–6 min, no API costs.',
  },
]

const MAX_VIDEO_BYTES = 120 * 1024 * 1024 // 120 MB
const MAX_VIDEO_DURATION_SEC = 60
const MAX_VIDEO_WIDTH = 1920
const MAX_VIDEO_HEIGHT = 1080

function readVideoMetadata(file) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    const objectUrl = URL.createObjectURL(file)
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      const metadata = {
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
      }
      URL.revokeObjectURL(objectUrl)
      resolve(metadata)
    }
    video.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('Unable to read video metadata. Please choose another video file.'))
    }
    video.src = objectUrl
  })
}

/** Smaller uploads to Firebase Storage (full-res frames from canvas can be several MB). */
async function compressJpegForUpload(blob, maxEdge = 1280, quality = 0.82) {
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    await new Promise((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('Could not read thumbnail image'))
      img.src = url
    })
    const w = img.naturalWidth || img.width
    const h = img.naturalHeight || img.height
    if (!w || !h) throw new Error('Invalid thumbnail dimensions')
    const scale = Math.min(1, maxEdge / Math.max(w, h))
    const tw = Math.max(1, Math.round(w * scale))
    const th = Math.max(1, Math.round(h * scale))
    const canvas = document.createElement('canvas')
    canvas.width = tw
    canvas.height = th
    canvas.getContext('2d').drawImage(img, 0, 0, tw, th)
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Thumbnail encode failed'))),
        'image/jpeg',
        quality,
      )
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

export default function Upload() {
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  const videoInputRef = useRef()

  const sellerDisplayName =
    profile?.displayName || user?.displayName || user?.email?.split('@')[0] || 'Seller'

  const [step, setStep] = useState(0)

  // Step 0 — listing details
  const [form, setForm] = useState({ title: '', description: '', price: '', category: 'electronics', condition: 'good' })

  // Step 1 — video
  const [videoFile, setVideoFile] = useState(null)
  const [videoPreview, setVideoPreview] = useState(null)
  const [videoError, setVideoError] = useState('')

  // Step 2 — frames
  const [frames, setFrames] = useState([])

  // Step 3 — reconstruct (default multi-view when you have orbited the object)
  const [methodChoice, setMethodChoice] = useState('multi')
  /** Single frame can only run the billboard path; otherwise use the user's choice. */
  const method = frames.length < 2 ? 'single' : methodChoice

  const [reconStatus, setReconStatus] = useState('idle') // idle | uploading | running | done | error
  const [reconProgress, setReconProgress] = useState(null)
  const [reconPhaseLabel, setReconPhaseLabel] = useState('')
  const [reconError, setReconError] = useState(null)
  const [listingId, setListingId] = useState(null)
  // Local GPU pipeline extras
  const [localStage, setLocalStage] = useState(null)
  const [localProgressPct, setLocalProgressPct] = useState(0)

  async function handleVideoSelect(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setVideoError('')
    setFrames([])

    if (file.size > MAX_VIDEO_BYTES) {
      setVideoFile(null)
      if (videoPreview) URL.revokeObjectURL(videoPreview)
      setVideoPreview(null)
      setVideoError(`Video is too large (${(file.size / (1024 * 1024)).toFixed(1)} MB). Use a file under 120 MB.`)
      return
    }

    try {
      const metadata = await readVideoMetadata(file)

      if (metadata.duration > MAX_VIDEO_DURATION_SEC) {
        setVideoFile(null)
        if (videoPreview) URL.revokeObjectURL(videoPreview)
        setVideoPreview(null)
        setVideoError(`Video is too long (${Math.round(metadata.duration)}s). Use a video under 60 seconds.`)
        return
      }

      if (metadata.width > MAX_VIDEO_WIDTH || metadata.height > MAX_VIDEO_HEIGHT) {
        setVideoFile(null)
        if (videoPreview) URL.revokeObjectURL(videoPreview)
        setVideoPreview(null)
        setVideoError(`Video resolution is ${metadata.width}x${metadata.height}. Use up to 1920x1080 for reliable extraction.`)
        return
      }

      if (videoPreview) URL.revokeObjectURL(videoPreview)
      setVideoFile(file)
      setVideoPreview(URL.createObjectURL(file))
    } catch (err) {
      setVideoFile(null)
      if (videoPreview) URL.revokeObjectURL(videoPreview)
      setVideoPreview(null)
      setVideoError(err.message || 'Invalid video file.')
    }
  }

  async function handleReconstruct() {
    if (!frames.length) return
    if (method === 'multi' && frames.length < 2) {
      setReconError('Multi-view reconstruction needs at least two frames. Extract more frames or use single view.')
      return
    }
    setReconError(null)
    setReconProgress(null)

    let createdListingId = null
    try {
      const listingRef = newListingRef()
      createdListingId = listingRef.id
      setListingId(listingRef.id)

      const viewsUsed =
        method === 'single' ? 1 : selectViewsForMultiViewReconstruction(frames, MAX_MULTIVIEW_IMAGES).length

      const reconstructionMethod = method === 'single' ? 'single' : '3dgs'

      await commitListingDraft(listingRef, {
        title: form.title,
        description: form.description,
        price: parseFloat(form.price),
        category: form.category,
        condition: form.condition,
        sellerId: user.uid,
        sellerName: sellerDisplayName,
        samplingMode: null,
        reconstructionMethod,
        status: 'processing',
        frameStats: {
          total: frames.length,
          accepted: frames.length,
          usedForReconstruction: viewsUsed,
          blurThreshold: 100,
        },
      })

      const startMs = Date.now()
      setReconStatus('running')
      setReconPhaseLabel(
        method === 'single'
          ? 'Running local reconstruction (single view)…'
          : 'Running local COLMAP + mesh (this can take several minutes)…',
      )

      const formData = new FormData()
      formData.append('mode', method === 'single' ? 'single' : 'multi')

      if (method === 'single') {
        const jpeg = await compressJpegForUpload(frames[0].blob, 1280, 0.85)
        formData.append('images', new File([jpeg], 'frame_0.jpg', { type: 'image/jpeg' }))
      } else {
        const views = selectViewsForMultiViewReconstruction(frames, MAX_MULTIVIEW_IMAGES)
        setReconPhaseLabel(
          views.length < frames.length
            ? `Using ${views.length} of ${frames.length} evenly spaced views for COLMAP…`
            : `Using ${views.length} views for COLMAP…`,
        )
        for (let i = 0; i < views.length; i++) {
          const jpeg = await compressJpegForUpload(views[i].blob, 1280, 0.82)
          formData.append('images', new File([jpeg], `frame_${i}.jpg`, { type: 'image/jpeg' }))
        }
      }

      const { jobId } = await createLocalReconJob(formData)
      await pollLocalReconJob(jobId, (status) => {
        setReconProgress(status)
        setReconPhaseLabel(
          status === 'queued'
            ? 'Job queued on local server…'
            : status === 'preparing'
              ? 'Saving images on server…'
              : status === 'running'
                ? method === 'single'
                  ? 'Building textured billboard mesh…'
                  : 'COLMAP + Poisson mesh (see server log if this stalls)…'
                : status,
        )
      })

      const glbBlob = await fetchReconModelGlbBlob(jobId)
      const processingTimeMs = Date.now() - startMs

      setReconStatus('uploading')
      setReconProgress(null)
      setReconPhaseLabel('Uploading thumbnail and GLB to Storage…')

      let thumbnailUrl = ''
      try {
        const thumbBlob = await compressJpegForUpload(frames[0].blob, 800, 0.72)
        const thumbRef = ref(storage, `listings/${listingRef.id}/thumbnail.jpg`)
        thumbnailUrl = await uploadBlobResumable(thumbRef, thumbBlob, {
          timeoutMs: 600000,
          onProgress: (pct) => setReconPhaseLabel(`Uploading thumbnail… ${pct}%`),
        })
      } catch (thumbErr) {
        console.error(thumbErr)
        setReconPhaseLabel('Thumbnail upload failed — continuing with model only.')
      }

      const modelRef = ref(storage, `listings/${listingRef.id}/model.glb`)
      const modelUrl = await uploadBlobResumable(modelRef, glbBlob, {
        contentType: 'model/gltf-binary',
        timeoutMs: 600000,
        onProgress: (pct) => setReconPhaseLabel(`Uploading GLB… ${pct}%`),
      })

      setReconPhaseLabel('Saving listing…')
      await updateListing(listingRef.id, {
        ...(thumbnailUrl ? { thumbnailUrl } : {}),
        modelUrl,
        status: 'ready',
        processingTimeMs,
        frameStats: {
          total: frames.length,
          accepted: frames.length,
          usedForReconstruction: viewsUsed,
          blurThreshold: 100,
        },
      })

      setReconPhaseLabel('')
      setReconStatus('done')
      setStep(4)
    } catch (err) {
      console.error(err)
      setReconPhaseLabel('')
      setReconError(err.message)
      setReconStatus('error')
      if (createdListingId) {
        try {
          await markListingReconstructionFailed(createdListingId, err.message || String(err))
        } catch {
          /* Firestore update may fail if the processing doc was never written */
        }
      }
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
      const listingRef = newListingRef()
      docId = listingRef.id
      setListingId(listingRef.id)

      await commitListingDraft(listingRef, {
        title: form.title,
        description: form.description,
        price: parseFloat(form.price),
        category: form.category,
        condition: form.condition,
        sellerId: user.uid,
        sellerName: sellerDisplayName,
        reconstructionMethod: 'local_gpu',
        samplingMode: null,
        frameStats: frames.length
          ? { total: frames.length, accepted: frames.length, usedForReconstruction: frames.length, blurThreshold: 70 }
          : null,
        status: 'processing',
      })

      if (frames.length > 0) {
        const thumbBlob = await compressJpegForUpload(frames[0].blob, 800, 0.72)
        const thumbRef = ref(storage, `listings/${listingRef.id}/thumbnail.jpg`)
        const thumbnailUrl = await uploadBlobResumable(thumbRef, thumbBlob, { timeoutMs: 600000 })
        await updateListing(listingRef.id, { thumbnailUrl })
      }

      setReconStatus('running')
      setLocalStage('queued')
      setLocalProgressPct(0)

      await startLocalReconstruction({
        videoFile,
        productName: form.title,
        sellerUid: user.uid,
        listingId: listingRef.id,
      })

      await new Promise((resolve, reject) => {
        const ws = connectJobSocket(
          listingRef.id,
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
              <li>Use up to 1080p, under 60s, and below 120 MB</li>
            </ul>
          </div>

          <div
            className="border-2 border-dashed border-gray-700 hover:border-violet-500 rounded-2xl p-8 text-center cursor-pointer transition-colors"
            onClick={() => videoInputRef.current?.click()}
          >
            {videoPreview ? (
              <video
                src={videoPreview}
                className="max-h-48 mx-auto rounded-xl"
                controls
                controlsList="nodownload noremoteplayback"
                disablePictureInPicture
                onContextMenu={(e) => e.preventDefault()}
              />
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

          {videoError && (
            <p className="text-red-300 text-sm bg-red-900/20 border border-red-800 rounded-xl px-3 py-2">
              {videoError}
            </p>
          )}

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
            Frames are sampled in your browser with the built-in video decoder (fast), then filtered for blur using Laplacian variance.
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
          <p className="text-sm text-gray-400">
            Choose a reconstruction method and generate the 3D model. You have{' '}
            <span className="text-violet-300 font-medium">{frames.length}</span> sharp frame
            {frames.length !== 1 ? 's' : ''} from the video.
            {frames.length >= 2 && method === 'multi' && (
              <span className="block mt-1 text-gray-500">
                Multi-view will send up to {Math.min(frames.length, MAX_MULTIVIEW_IMAGES)} evenly spaced views to the
                server.
              </span>
            )}
          </p>

          <div className="grid gap-3">
            {RECON_METHODS.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => setMethodChoice(m.value)}
                disabled={m.value === 'multi' && frames.length < 2}
                className={`p-4 rounded-xl border text-left transition-all ${
                  method === m.value
                    ? 'border-violet-500 bg-violet-500/10'
                    : 'border-gray-700 bg-gray-800 hover:border-gray-600'
                } ${m.value === 'multi' && frames.length < 2 ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <p className={`font-medium text-sm ${method === m.value ? 'text-violet-300' : 'text-white'}`}>{m.label}</p>
                <p className="text-xs text-gray-500 mt-0.5">{m.desc}</p>
              </button>
            ))}
          </div>


          {(reconStatus === 'uploading' || reconStatus === 'running') && reconPhaseLabel && (
            <div className="bg-gray-800/80 border border-gray-700 rounded-xl px-4 py-3 text-sm text-gray-300">
              {reconPhaseLabel}
            </div>
          )}

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
