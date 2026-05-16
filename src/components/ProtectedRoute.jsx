import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-gray-400">Checking authentication...</p>
      </div>
    )
  }

  if (!user) {
    const redirectTo = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/auth?mode=login&next=${redirectTo}`} replace />
  }

  return children
}
