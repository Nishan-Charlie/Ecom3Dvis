import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useListings } from '../hooks/useListings'
import ProductCard from '../components/ProductCard'

const CATEGORIES = ['all', 'electronics', 'clothing', 'furniture', 'toys', 'books', 'ceramics']

export default function Home() {
  const [category, setCategory] = useState('all')
  const { listings, loading } = useListings(category !== 'all' ? { category } : {})

  return (
    <div className="flex-1">
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-gray-950 via-violet-950/20 to-gray-950 py-20 px-6 text-center">
        <div className="relative max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 bg-violet-500/10 border border-violet-500/20 text-violet-300 text-xs font-medium px-3 py-1.5 rounded-full mb-6">
            <span className="w-1.5 h-1.5 bg-violet-400 rounded-full animate-pulse" />
            AI-Powered 3D Reconstruction
          </div>
          <h1 className="text-5xl md:text-6xl font-bold text-white tracking-tight mb-4">
            See Every Angle.
            <br />
            <span className="text-violet-400">Buy with Confidence.</span>
          </h1>
          <p className="text-gray-400 text-lg mb-8 max-w-xl mx-auto">
            Shop second-hand goods with interactive 3D models generated from short seller videos.
            No more guessing what's hidden in a photo.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Link
              to="/auth?mode=register&role=seller"
              className="bg-violet-600 hover:bg-violet-500 text-white font-semibold px-6 py-3 rounded-xl transition-colors"
            >
              Sell an Item
            </Link>
            <a href="#listings" className="text-gray-300 hover:text-white font-medium px-6 py-3 rounded-xl border border-gray-700 hover:border-gray-600 transition-colors">
              Browse Listings
            </a>
          </div>
        </div>

        {/* How it works */}
        <div className="mt-16 max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            { step: '1', title: 'Seller Records Video', desc: 'A 30-second clip rotating around the item using any smartphone.' },
            { step: '2', title: 'AI Reconstructs 3D', desc: 'Our pipeline extracts frames, filters blurry ones, and calls TripoSR or 3D Gaussian Splatting.' },
            { step: '3', title: 'Buyer Inspects in 3D', desc: 'Rotate, zoom, and pan the interactive model right in the browser — no app needed.' },
          ].map((item) => (
            <div key={item.step} className="bg-gray-900/60 border border-gray-800 rounded-2xl p-6 text-left">
              <div className="w-8 h-8 rounded-full bg-violet-600 text-white text-sm font-bold flex items-center justify-center mb-3">
                {item.step}
              </div>
              <h3 className="font-semibold text-white mb-1">{item.title}</h3>
              <p className="text-gray-400 text-sm">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Listings */}
      <section id="listings" className="max-w-7xl mx-auto px-4 md:px-8 py-12">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-white">Browse Listings</h2>
          <span className="text-gray-500 text-sm">{listings.length} items</span>
        </div>

        {/* Category filter */}
        <div className="flex gap-2 overflow-x-auto pb-2 mb-6 scrollbar-thin">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium transition-all ${
                category === cat
                  ? 'bg-violet-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
              }`}
            >
              {cat === 'all' ? 'All Categories' : cat.charAt(0).toUpperCase() + cat.slice(1)}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden animate-pulse">
                <div className="aspect-square bg-gray-800" />
                <div className="p-4 space-y-2">
                  <div className="h-4 bg-gray-800 rounded w-3/4" />
                  <div className="h-3 bg-gray-800 rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : listings.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-gray-500 text-lg mb-2">No listings yet</p>
            <p className="text-gray-600 text-sm">Be the first to sell an item with a 3D model!</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {listings.map((listing) => (
              <ProductCard key={listing.id} listing={listing} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
