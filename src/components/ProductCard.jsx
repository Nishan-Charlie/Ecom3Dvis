import { Link } from 'react-router-dom'

const STATUS_BADGE = {
  processing: { label: 'Processing', cls: 'bg-yellow-500/20 text-yellow-300' },
  ready: { label: '3D Ready', cls: 'bg-emerald-500/20 text-emerald-300' },
  failed: { label: 'Failed', cls: 'bg-red-500/20 text-red-300' },
}

export default function ProductCard({ listing }) {
  const badge = STATUS_BADGE[listing.status] ?? STATUS_BADGE.processing

  return (
    <Link
      to={`/listing/${listing.id}`}
      className="group bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden hover:border-violet-600 transition-all duration-200 hover:shadow-lg hover:shadow-violet-900/20 flex flex-col"
    >
      {/* Thumbnail / preview */}
      <div className="relative aspect-square bg-gray-800 overflow-hidden">
        {listing.thumbnailUrl ? (
          <img
            src={listing.thumbnailUrl}
            alt={listing.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-600">
            <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
          </div>
        )}
        <span className={`absolute top-2 right-2 text-xs font-medium px-2 py-1 rounded-full ${badge.cls}`}>
          {badge.label}
        </span>
        {listing.modelUrl && (
          <div className="absolute bottom-2 left-2 bg-black/60 backdrop-blur-sm text-white text-xs px-2 py-1 rounded-full flex items-center gap-1">
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path d="M10 2a8 8 0 100 16A8 8 0 0010 2z" />
            </svg>
            View in 3D
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-4 flex flex-col gap-2 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-white font-medium text-sm leading-tight line-clamp-2 group-hover:text-violet-300 transition-colors">
            {listing.title}
          </h3>
          <span className="text-violet-400 font-semibold text-sm whitespace-nowrap">
            £{listing.price?.toFixed(2)}
          </span>
        </div>

        <p className="text-gray-500 text-xs line-clamp-2">{listing.description}</p>

        <div className="mt-auto flex items-center justify-between text-xs text-gray-600">
          <span className="bg-gray-800 px-2 py-0.5 rounded-full capitalize">{listing.category}</span>
          <span className="capitalize">{listing.condition}</span>
        </div>
      </div>
    </Link>
  )
}
