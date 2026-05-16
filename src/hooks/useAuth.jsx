import { useState, useEffect, createContext, useContext } from 'react'
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  updateProfile,
} from 'firebase/auth'
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore'
import { auth, db, firebaseReady } from '../lib/firebase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!firebaseReady || !auth) {
      setLoading(false)
      return undefined
    }
    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser)
      // Do not tie route guards to Firestore: getDoc can hang or fail while Auth is fine.
      setLoading(false)

      if (!firebaseUser) {
        setProfile(null)
        return
      }

      ;(async () => {
        try {
          const snap = await getDoc(doc(db, 'users', firebaseUser.uid))
          setProfile(snap.exists() ? snap.data() : null)
        } catch (e) {
          console.error('Failed to load user profile from Firestore', e)
          setProfile(null)
        }
      })()
    })
    return unsub
  }, [])

  async function register(email, password, displayName, role = 'buyer') {
    if (!auth || !db) throw new Error('Firebase is not configured. Add a .env file and restart the dev server.')
    const cred = await createUserWithEmailAndPassword(auth, email, password)
    await updateProfile(cred.user, { displayName })
    const userDoc = { uid: cred.user.uid, email, displayName, role, createdAt: serverTimestamp() }
    await setDoc(doc(db, 'users', cred.user.uid), userDoc)
    setProfile(userDoc)
    return cred.user
  }

  async function login(email, password) {
    if (!auth) throw new Error('Firebase is not configured. Add a .env file and restart the dev server.')
    return signInWithEmailAndPassword(auth, email, password)
  }

  async function logout() {
    if (!auth) return
    await signOut(auth)
    setProfile(null)
  }

  return (
    <AuthContext.Provider value={{ user, profile, loading, register, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
