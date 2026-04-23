import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

export default function Navbar() {
  const { user, profile, logout } = useAuth()
  const navigate = useNavigate()

  async function handleLogout() {
    await logout()
    navigate('/')
  }

  return (
    <nav className="sticky top-0 z-50 bg-gray-950/90 backdrop-blur border-b border-gray-800 px-4 md:px-8 py-3 flex items-center justify-between">
      <Link to="/" className="flex items-center gap-2 font-bold text-xl text-white tracking-tight">
        <span className="text-violet-400">Vid2Shop</span>
        <span className="text-gray-400 font-light">3D</span>
      </Link>

      <div className="flex items-center gap-3">
        {user ? (
          <>
            {profile?.role === 'seller' && (
              <Link
                to="/upload"
                className="bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                + List Item
              </Link>
            )}
            <Link
              to="/dashboard"
              className="text-gray-300 hover:text-white text-sm transition-colors"
            >
              Dashboard
            </Link>
            <button
              onClick={handleLogout}
              className="text-gray-400 hover:text-white text-sm transition-colors"
            >
              Sign Out
            </button>
            <div className="w-8 h-8 rounded-full bg-violet-700 flex items-center justify-center text-sm font-semibold text-white">
              {(profile?.displayName || user.email)?.[0]?.toUpperCase()}
            </div>
          </>
        ) : (
          <>
            <Link to="/auth" className="text-gray-300 hover:text-white text-sm transition-colors">
              Sign In
            </Link>
            <Link
              to="/auth?mode=register"
              className="bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              Get Started
            </Link>
          </>
        )}
      </div>
    </nav>
  )
}
