import { useState, useEffect } from 'react'
import {
  collection,
  query,
  orderBy,
  limit,
  where,
  onSnapshot,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp,
  getDoc,
} from 'firebase/firestore'
import { db } from '../lib/firebase'

export function useListings(filters = {}) {
  const [listings, setListings] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
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
    getDoc(doc(db, 'listings', id)).then((snap) => {
      setListing(snap.exists() ? { id: snap.id, ...snap.data() } : null)
      setLoading(false)
    })
  }, [id])

  return { listing, loading }
}

export async function createListing(data) {
  return addDoc(collection(db, 'listings'), { ...data, createdAt: serverTimestamp(), status: 'processing' })
}

export async function updateListing(id, data) {
  return updateDoc(doc(db, 'listings', id), data)
}
