import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './hooks/useAuth'
import Navbar from './components/Navbar'
import Home from './pages/Home'
import ProductDetail from './pages/ProductDetail'
import Upload from './pages/Upload'
import Auth from './pages/Auth'
import Dashboard from './pages/Dashboard'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <div className="flex flex-col min-h-dvh bg-gray-950">
          <Navbar />
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/listing/:id" element={<ProductDetail />} />
            <Route path="/upload" element={<Upload />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/dashboard" element={<Dashboard />} />
          </Routes>
          <footer className="mt-auto border-t border-gray-800 py-6 text-center text-xs text-gray-600">
            Vid2Shop3D · Second-hand marketplace with AI-generated 3D models · Research prototype
          </footer>
        </div>
      </BrowserRouter>
    </AuthProvider>
  )
}
