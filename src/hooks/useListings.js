import { useState, useEffect } from 'react'
import {
  collection,
  query,
  orderBy,
  limit,
  where,
  onSnapshot,
  updateDoc,
  doc,
  setDoc,
  serverTimestamp,
  getDoc,
} from 'firebase/firestore'
import { db, firebaseReady } from '../lib/firebase'
import { withTimeout } from '../lib/withTimeout'

export function useListings(filters = {}) {
  const [listings, setListings] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!firebaseReady || !db) {
      setLoading(false)
      return undefined
    }
    let q = query(collection(db, 'listings'), orderBy('createdAt', 'desc'), limit(50))
    if (filters.category) q = query(q, where('category', '==', filters.category))
    if (filters.sellerId) q = query(collection(db, 'listings'), where('sellerId', '==', filters.sellerId), orderBy('createdAt', 'desc'))

    const unsub = onSnapshot(
      q,
      (snap) => {
        setListings(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
        setLoading(false)
      },
      (err) => {
        setError(err.message)
        setLoading(false)
      }
    )
    return unsub
  }, [filters.category, filters.sellerId])

  return { listings, loading, error }
}

export function useListing(id) {
  const [listing, setListing] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    if (!firebaseReady || !db) {
      setLoading(false)
      return
    }
    getDoc(doc(db, 'listings', id)).then((snap) => {
      setListing(snap.exists() ? { id: snap.id, ...snap.data() } : null)
      setLoading(false)
    })
  }, [id])

  return { listing, loading }
}

/** New document ref with id (no server round-trip). Use after uploads, then {@link commitListingDraft}. */
export function newListingRef() {
  return doc(collection(db, 'listings'))
}

/** Create listing document. Pass `status: 'processing'` before long jobs, then {@link updateListing} to `ready`. */
export async function commitListingDraft(listingRef, data) {
  const { status: statusFromData, ...rest } = data
  const status = statusFromData ?? 'processing'
  await withTimeout(
    setDoc(listingRef, { ...rest, createdAt: serverTimestamp(), status }),
    90000,
    'Saving listing to Firestore',
  )
}

export async function updateListing(id, data) {
  await withTimeout(updateDoc(doc(db, 'listings', id), data), 90000, 'Updating listing in Firestore')
}

/** Mark listing failed after reconstruction/upload errors (keeps doc for debugging). */
export async function markListingReconstructionFailed(id, errorMessage) {
  const msg = String(errorMessage || 'Unknown error').slice(0, 2000)
  await updateListing(id, {
    status: 'failed',
    reconstructionError: msg,
    reconstructionFailedAt: serverTimestamp(),
  })
}
