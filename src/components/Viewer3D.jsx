import { Suspense, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, useGLTF, Html, Environment, ContactShadows, PresentationControls } from '@react-three/drei'

function Model({ url }) {
  const { scene } = useGLTF(url)
  return <primitive object={scene} />
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

export default function Viewer3D({ modelUrl, className = '' }) {
  const [autoRotate, setAutoRotate] = useState(true)

  if (!modelUrl) {
    return (
      <div className={`flex items-center justify-center bg-gray-900 rounded-xl ${className}`}>
        <p className="text-gray-500 text-sm">No 3D model available</p>
      </div>
    )
  }

  return (
    <div className={`relative bg-gray-900 rounded-xl overflow-hidden ${className}`}>
      <Canvas
        camera={{ position: [0, 0, 3], fov: 45 }}
        gl={{ antialias: true, alpha: false }}
        style={{ background: '#111827' }}
      >
        <ambientLight intensity={0.6} />
        <directionalLight position={[5, 5, 5]} intensity={1} castShadow />
        <Suspense fallback={<LoadingSpinner />}>
          <PresentationControls
            global
            zoom={0.8}
            rotation={[0, -Math.PI / 4, 0]}
            polar={[-Math.PI / 4, Math.PI / 4]}
            azimuth={[-Math.PI / 4, Math.PI / 4]}
          >
            <Model url={modelUrl} />
          </PresentationControls>
          <ContactShadows position={[0, -1.4, 0]} opacity={0.4} scale={5} blur={2} />
          <Environment preset="city" />
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

      {/* Controls hint */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-black/50 backdrop-blur-sm text-gray-400 text-xs px-3 py-1.5 rounded-full pointer-events-none">
        Drag to rotate · Scroll to zoom
      </div>

      <button
        onClick={() => setAutoRotate((v) => !v)}
        className="absolute top-3 right-3 bg-black/50 backdrop-blur-sm text-white text-xs px-3 py-1.5 rounded-full hover:bg-black/70 transition-colors"
      >
        {autoRotate ? 'Pause' : 'Auto-rotate'}
      </button>
    </div>
  )
}
