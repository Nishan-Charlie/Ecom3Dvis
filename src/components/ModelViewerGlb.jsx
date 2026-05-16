import '@google/model-viewer'

/**
 * Google `<model-viewer>` — loads `src` with a plain request; configure Storage CORS like any other URL.
 * @param {string} src - Firestore `modelUrl` (HTTPS)
 * @param {string} [className]
 */
export default function ModelViewerGlb({ src, className = '' }) {
  if (!src) return null
  return (
    <div className={`bg-gray-900 rounded-xl overflow-hidden ${className}`}>
      {/* Custom element: https://modelviewer.dev */}
      <model-viewer
        src={src}
        alt="3D model"
        camera-controls
        shadow-intensity="1"
        exposure="1"
        style={{ width: '100%', height: '100%', minHeight: 'min(100vw, 560px)' }}
        className="block w-full h-full"
      />
    </div>
  )
}
