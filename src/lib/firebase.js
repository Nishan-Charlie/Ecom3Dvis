import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { initializeFirestore, memoryLocalCache } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'

/** Vite/dotenv sometimes leaves quotes in values — breaks Storage bucket resolution. */
function envStr(key) {
  const v = import.meta.env[key]
  if (v == null || v === '') return undefined
  return String(v).trim().replace(/^["']|["']$/g, '')
}

const firebaseConfig = {
  apiKey: envStr('VITE_FIREBASE_API_KEY'),
  authDomain: envStr('VITE_FIREBASE_AUTH_DOMAIN'),
  projectId: envStr('VITE_FIREBASE_PROJECT_ID'),
  storageBucket: envStr('VITE_FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: envStr('VITE_FIREBASE_MESSAGING_SENDER_ID'),
  appId: envStr('VITE_FIREBASE_APP_ID'),
}

const missingKeys = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_APP_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
].filter((key) => !envStr(key))

/** False when `.env` is missing or incomplete — app shows setup instructions instead of crashing. */
export const firebaseReady = missingKeys.length === 0

export const firebaseSetupError =
  missingKeys.length > 0
    ? `Missing in .env: ${missingKeys.join(', ')}. Copy .env.example → .env, add Firebase keys, restart npm run dev.`
    : null

let app = null
/** @type {import('firebase/auth').Auth | null} */
let auth = null
/** @type {import('firebase/firestore').Firestore | null} */
let db = null
/** @type {import('firebase/storage').FirebaseStorage | null} */
let storage = null

if (firebaseReady) {
  app = initializeApp(firebaseConfig)
  auth = getAuth(app)
  db = initializeFirestore(app, {
    localCache: memoryLocalCache(),
    experimentalAutoDetectLongPolling: true,
  })
  const storageBucket = firebaseConfig.storageBucket
  storage = storageBucket
    ? getStorage(app, `gs://${storageBucket.replace(/^gs:\/\//, '')}`)
    : getStorage(app)
} else {
  console.error(`[firebase] ${firebaseSetupError}`)
}

export { auth, db, storage }
export default app
