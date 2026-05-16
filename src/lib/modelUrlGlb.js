/**
 * GLB from Firestore `modelUrl` (full HTTPS URL from `getDownloadURL` or the Console).
 *
 * Pass that string directly to:
 * - `<model-viewer src={modelUrl} />` (see `ModelViewerGlb.jsx`), or
 * - `useGLTF(modelUrl)` / `GLTFLoader` (see `Viewer3D.jsx`).
 *
 * The loader uses `fetch(url)`. Your **Firebase Storage bucket must allow CORS** for your
 * web app origin (e.g. `http://localhost:5173`), or the browser will block the request.
 * Run: `npm run storage:set-cors` (Google Cloud SDK required).
 */

/** @param {unknown} url */
export function isHttpModelUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url.trim())
}
