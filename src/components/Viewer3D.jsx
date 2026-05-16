import { Suspense, useLayoutEffect, useState, Component } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, useGLTF, Html, Environment, PresentationControls } from '@react-three/drei'
import * as THREE from 'three'
import ModelViewerGlb from './ModelViewerGlb'

/** PBR GLBs often use high metalness; tone down so lit mesh is visible. */
function normalizeLoadedMaterials(scene) {
  scene.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
    for (const mat of mats) {
      if (mat.metalness !== undefined) mat.metalness = 0
      if (mat.roughness !== undefined) mat.roughness = 0.85
      if (mat.envMapIntensity !== undefined) mat.envMapIntensity = 0.6
      mat.needsUpdate = true
    }
  })
}

/** Loads GLB from Firestore `modelUrl` (HTTPS) via Drei → same as GLTFLoader under the hood. */
function Model({ url }) {
  const { scene } = useGLTF(url)
  useLayoutEffect(() => {
    normalizeLoadedMaterials(scene)
  }, [scene])
  return <primitive object={scene} />
}

class ViewerErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('Viewer3D:', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <Html center>
          <div className="max-w-xs rounded-xl bg-gray-950/95 border border-red-900/50 px-4 py-3 text-left text-xs text-red-200 shadow-xl">
            <p className="font-semibold text-red-100 mb-1">3D preview failed</p>
            <p className="text-red-300/90 break-words">{this.state.error.message}</p>
            <p className="text-gray-500 mt-2">
              If this mentions CORS or Failed to fetch, run <code className="text-gray-400">npm run storage:set-cors</code>{' '}
              so your Storage bucket allows your app origin, or try <code className="text-gray-400">engine=&quot;model-viewer&quot;</code>.
            </p>
          </div>
        </Html>
      )
    }
    return this.props.children
  }
}

function LoadingSpinner() {
  return (
    <Html center>
      <div className="flex flex-col items-center gap-3 text-gray-300">
        <div className="w-10 h-10 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm">Loading 3D model…</p>
      </div>
    </Html>
  )
}

function ViewerR3f({ modelUrl, className }) {
  const [autoRotate, setAutoRotate] = useState(true)

  return (
    <div className={`relative bg-gray-900 rounded-xl overflow-hidden ${className}`}>
      <Canvas
        camera={{ position: [0, 0, 3], fov: 45 }}
        gl={{ antialias: true, alpha: false }}
        style={{ background: '#111827' }}
        onCreated={({ gl }) => {
          THREE.ColorManagement.enabled = true
          gl.setClearColor('#111827')
        }}
      >
        <color attach="background" args={['#111827']} />
        <ambientLight intensity={0.85} />
        <directionalLight position={[4, 6, 5]} intensity={1.1} />
        <directionalLight position={[-3, 2, -4]} intensity={0.35} />
        <Suspense fallback={<LoadingSpinner />}>
          <ViewerErrorBoundary key={modelUrl}>
            <PresentationControls
              global
              zoom={0.8}
              rotation={[0, -Math.PI / 4, 0]}
              polar={[-Math.PI / 4, Math.PI / 4]}
              azimuth={[-Math.PI / 4, Math.PI / 4]}
            >
              <Model url={modelUrl} />
            </PresentationControls>
            <Environment preset="city" />
          </ViewerErrorBoundary>
        </Suspense>
        <OrbitControls
          autoRotate={autoRotate}
          autoRotateSpeed={1.5}
          enablePan={false}
          minDistance={1}
          maxDistance={8}
          onStart={() => setAutoRotate(false)}
        />
      </Canvas>

      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-black/50 backdrop-blur-sm text-gray-400 text-xs px-3 py-1.5 rounded-full pointer-events-none">
        Drag to rotate · Scroll to zoom
      </div>

      <button
        type="button"
        onClick={() => setAutoRotate((v) => !v)}
        className="absolute top-3 right-3 bg-black/50 backdrop-blur-sm text-white text-xs px-3 py-1.5 rounded-full hover:bg-black/70 transition-colors"
      >
        {autoRotate ? 'Pause' : 'Auto-rotate'}
      </button>
    </div>
  )
}

/**
 * @param {string} modelUrl - Firestore field: full HTTPS URL to the .glb
 * @param {string} [className]
 * @param {'r3f' | 'model-viewer'} [engine='r3f'] - `r3f` uses useGLTF (Three.js). `model-viewer` uses Google's web component.
 */
export default function Viewer3D({ modelUrl, className = '', engine = 'r3f' }) {
  if (!modelUrl) {
    return (
      <div className={`flex items-center justify-center bg-gray-900 rounded-xl ${className}`}>
        <p className="text-gray-500 text-sm">No 3D model available</p>
      </div>
    )
  }

  if (engine === 'model-viewer') {
    return <ModelViewerGlb src={modelUrl} className={className} />
  }

  return <ViewerR3f modelUrl={modelUrl} className={className} />
}
