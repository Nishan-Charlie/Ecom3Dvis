import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './hooks/useAuth'
import Navbar from './components/Navbar'
import Home from './pages/Home'
import ProductDetail from './pages/ProductDetail'
import Upload from './pages/Upload'
import Auth from './pages/Auth'
import Dashboard from './pages/Dashboard'
import ProtectedRoute from './components/ProtectedRoute'
import { firebaseReady, firebaseSetupError } from './lib/firebase'

export default function App() {
  if (!firebaseReady) {
    return (
      <div className="min-h-dvh bg-gray-950 text-gray-100 flex items-center justify-center p-6">
        <div className="max-w-lg w-full bg-gray-900 border border-amber-700/50 rounded-2xl p-6 space-y-4">
          <h1 className="text-xl font-bold text-amber-300">Firebase not configured</h1>
          <p className="text-sm text-gray-400 leading-relaxed">{firebaseSetupError}</p>
          <ol className="text-sm text-gray-300 list-decimal list-inside space-y-1">
            <li>Copy <code className="text-violet-300">.env.example</code> to <code className="text-violet-300">.env</code></li>
            <li>Add your Firebase web app keys from the Firebase Console</li>
            <li>Restart: <code className="text-violet-300">npm run dev</code></li>
          </ol>
        </div>
      </div>
    )
  }

  return (
    <AuthProvider>
      <BrowserRouter>
        <div className="flex flex-col min-h-dvh bg-gray-950">
          <Navbar />
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/listing/:id" element={<ProductDetail />} />
            <Route
              path="/upload"
              element={(
                <ProtectedRoute>
                  <Upload />
                </ProtectedRoute>
              )}
            />
            <Route path="/auth" element={<Auth />} />
            <Route
              path="/dashboard"
              element={(
                <ProtectedRoute>
                  <Dashboard />
                </ProtectedRoute>
              )}
            />
          </Routes>
          <footer className="mt-auto border-t border-gray-800 py-6 text-center text-xs text-gray-600">
            Vid2Shop3D · Second-hand marketplace with AI-generated 3D models · Research prototype
          </footer>
        </div>
      </BrowserRouter>
    </AuthProvider>
  )
}
