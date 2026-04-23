import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useListings, updateListing } from '../hooks/useListings'
import { deleteDoc, doc } from 'firebase/firestore'
import { db } from '../lib/firebase'

const STATUS_COLORS = {
  processing: 'text-yellow-400',
  ready: 'text-emerald-400',
  failed: 'text-red-400',
}

export default function Dashboard() {
  const { user, profile, logout } = useAuth()
  const navigate = useNavigate()

  const { listings, loading } = useListings(user ? { sellerId: user.uid } : {})

  if (!user) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-gray-400">Please <Link to="/auth" className="text-violet-400 underline">sign in</Link> to view your dashboard.</p>
      </div>
    )
  }

  async function handleDelete(id) {
    if (!confirm('Delete this listing?')) return
    await deleteDoc(doc(db, 'listings', id))
  }

  const stats = {
    total: listings.length,
    ready: listings.filter((l) => l.status === 'ready').length,
    processing: listings.filter((l) => l.status === 'processing').length,
    failed: listings.filter((l) => l.status === 'failed').length,
  }

  return (
    <div className="flex-1 max-w-5xl mx-auto px-4 md:px-8 py-12 w-full">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-gray-400 text-sm mt-1">
            {profile?.displayName} · {profile?.role ?? 'buyer'}
          </p>
        </div>
        {profile?.role === 'seller' && (
          <Link
            to="/upload"
            className="bg-violet-600 hover:bg-violet-500 text-white font-medium px-5 py-2.5 rounded-xl transition-colors text-sm"
          >
            + New Listing
          </Link>
        )}
      </div>

      {/* Stats */}
      {profile?.role === 'seller' && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          {[
            { label: 'Total listings', value: stats.total, cls: 'text-white' },
            { label: '3D Ready', value: stats.ready, cls: 'text-emerald-400' },
            { label: 'Processing', value: stats.processing, cls: 'text-yellow-400' },
            { label: 'Failed', value: stats.failed, cls: 'text-red-400' },
          ].map((s) => (
            <div key={s.label} className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
              <p className={`text-2xl font-bold ${s.cls}`}>{s.value}</p>
              <p className="text-gray-500 text-xs mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Listings table */}
      {profile?.role === 'seller' && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-800">
            <h2 className="font-semibold text-white">Your Listings</h2>
          </div>

          {loading ? (
            <div className="p-8 text-center text-gray-500">Loading…</div>
          ) : listings.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-gray-500 mb-3">No listings yet</p>
              <Link to="/upload" className="text-violet-400 hover:underline text-sm">Create your first listing →</Link>
            </div>
          ) : (
            <div className="divide-y divide-gray-800">
              {listings.map((l) => (
                <div key={l.id} className="flex items-center gap-4 px-6 py-4 hover:bg-gray-800/50 transition-colors">
                  {l.thumbnailUrl ? (
                    <img src={l.thumbnailUrl} alt="" className="w-12 h-12 rounded-xl object-cover bg-gray-800 shrink-0" />
                  ) : (
                    <div className="w-12 h-12 rounded-xl bg-gray-800 shrink-0" />
                  )}

                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium truncate">{l.title}</p>
                    <p className="text-gray-500 text-xs mt-0.5 capitalize">{l.category} · {l.condition?.replace('_', ' ')}</p>
                  </div>

                  <p className="text-violet-400 font-semibold text-sm shrink-0">£{l.price?.toFixed(2)}</p>

                  <span className={`text-xs font-medium shrink-0 ${STATUS_COLORS[l.status] ?? 'text-gray-400'}`}>
                    {l.status ?? 'unknown'}
                  </span>

                  <div className="flex items-center gap-2 shrink-0">
                    <Link
                      to={`/listing/${l.id}`}
                      className="text-xs text-gray-400 hover:text-white transition-colors"
                    >
                      View
                    </Link>
                    <button
                      onClick={() => handleDelete(l.id)}
                      className="text-xs text-red-500 hover:text-red-400 transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Buyer view */}
      {profile?.role === 'buyer' && (
        <div className="text-center py-12">
          <p className="text-gray-400 mb-4">Browse the marketplace to find items.</p>
          <Link to="/" className="bg-violet-600 hover:bg-violet-500 text-white px-6 py-3 rounded-xl font-medium transition-colors">
            Browse Listings
          </Link>
        </div>
      )}
    </div>
  )
}
