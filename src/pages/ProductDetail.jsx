import { useParams, Link } from 'react-router-dom'
import { useListing } from '../hooks/useListings'
import Viewer3D from '../components/Viewer3D'

const CONDITION_LABELS = {
  new: { label: 'New', cls: 'text-emerald-400 bg-emerald-400/10' },
  like_new: { label: 'Like New', cls: 'text-sky-400 bg-sky-400/10' },
  good: { label: 'Good', cls: 'text-yellow-400 bg-yellow-400/10' },
  fair: { label: 'Fair', cls: 'text-orange-400 bg-orange-400/10' },
  poor: { label: 'Poor', cls: 'text-red-400 bg-red-400/10' },
}

export default function ProductDetail() {
  const { id } = useParams()
  const { listing, loading } = useListing(id)

  if (loading) {
    return (
      <div className="flex-1 max-w-6xl mx-auto px-4 md:px-8 py-12 grid md:grid-cols-2 gap-8">
        <div className="aspect-square bg-gray-900 rounded-2xl animate-pulse" />
        <div className="space-y-4">
          {[80, 40, 60, 100].map((w, i) => (
            <div key={i} className={`h-6 bg-gray-800 rounded animate-pulse`} style={{ width: `${w}%` }} />
          ))}
        </div>
      </div>
    )
  }

  if (!listing) {
    return (
      <div className="flex-1 flex items-center justify-center flex-col gap-4">
        <p className="text-gray-400 text-lg">Listing not found</p>
        <Link to="/" className="text-violet-400 hover:underline">Back to marketplace</Link>
      </div>
    )
  }

  const cond = CONDITION_LABELS[listing.condition] ?? { label: listing.condition, cls: 'text-gray-400 bg-gray-700' }

  return (
    <div className="flex-1 max-w-6xl mx-auto px-4 md:px-8 py-12">
      <Link to="/" className="flex items-center gap-1.5 text-gray-400 hover:text-white text-sm mb-8 transition-colors w-fit">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to listings
      </Link>

      <div className="grid md:grid-cols-2 gap-8 lg:gap-12">
        {/* 3D Viewer / Thumbnail */}
        <div className="space-y-3">
          {listing.modelUrl ? (
            <Viewer3D modelUrl={listing.modelUrl} className="w-full aspect-square" />
          ) : listing.thumbnailUrl ? (
            <img src={listing.thumbnailUrl} alt={listing.title} className="w-full aspect-square object-cover rounded-2xl bg-gray-900" />
          ) : (
            <div className="w-full aspect-square bg-gray-900 rounded-2xl flex items-center justify-center">
              <p className="text-gray-500 text-sm">No preview available</p>
            </div>
          )}

          {/* Model method badge */}
          {listing.reconstructionMethod && (
            <div className="flex items-center gap-2 text-xs text-gray-500 justify-center">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              3D via {listing.reconstructionMethod === 'triposr' ? 'TripoSR' : '3D Gaussian Splatting'}
              {listing.samplingMode && (
                <span>· {listing.samplingMode} sampling</span>
              )}
            </div>
          )}
        </div>

        {/* Product info */}
        <div className="space-y-6">
          <div>
            <div className="flex items-start justify-between gap-3 mb-2">
              <h1 className="text-2xl font-bold text-white leading-tight">{listing.title}</h1>
              <span className={`text-sm font-medium px-2.5 py-1 rounded-full whitespace-nowrap ${cond.cls}`}>
                {cond.label}
              </span>
            </div>
            <p className="text-3xl font-bold text-violet-400">£{listing.price?.toFixed(2)}</p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <span className="bg-gray-800 text-gray-300 text-xs px-3 py-1.5 rounded-full capitalize">
              {listing.category}
            </span>
            {listing.status === 'ready' && listing.modelUrl && (
              <span className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs px-3 py-1.5 rounded-full">
                Interactive 3D Model
              </span>
            )}
          </div>

          <p className="text-gray-300 leading-relaxed">{listing.description}</p>

          {/* CTA */}
          <div className="space-y-3 pt-2">
            <button className="w-full bg-violet-600 hover:bg-violet-500 text-white font-semibold py-3.5 rounded-xl transition-colors">
              Contact Seller
            </button>
            <button className="w-full bg-gray-800 hover:bg-gray-700 text-white font-medium py-3.5 rounded-xl transition-colors">
              Save to Wishlist
            </button>
          </div>

          {/* Seller info */}
          {listing.sellerName && (
            <div className="border-t border-gray-800 pt-4">
              <p className="text-xs text-gray-500 mb-1">Listed by</p>
              <p className="text-gray-300 text-sm font-medium">{listing.sellerName}</p>
            </div>
          )}

          {/* Research metadata */}
          {(listing.processingTimeMs || listing.frameStats) && (
            <details className="border border-gray-800 rounded-xl">
              <summary className="cursor-pointer px-4 py-3 text-sm text-gray-400 select-none">
                Research metadata
              </summary>
              <div className="px-4 pb-4 space-y-2 text-xs text-gray-500">
                {listing.processingTimeMs && (
                  <p>Processing time: <span className="text-gray-300">{(listing.processingTimeMs / 1000).toFixed(1)}s</span></p>
                )}
                {listing.frameStats && (
                  <>
                    <p>Total frames extracted: <span className="text-gray-300">{listing.frameStats.total}</span></p>
                    <p>Frames accepted (sharp): <span className="text-gray-300">{listing.frameStats.accepted}</span></p>
                    <p>Blur threshold: <span className="text-gray-300">{listing.frameStats.blurThreshold}</span></p>
                  </>
                )}
              </div>
            </details>
          )}
        </div>
      </div>
    </div>
  )
}
