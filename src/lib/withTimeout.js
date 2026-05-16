/**
 * Race `promise` against a timer so hung network / blocked SDK calls surface as errors.
 */
export async function withTimeout(promise, ms, label) {
  let tid
  const timeout = new Promise((_, reject) => {
    tid = setTimeout(
      () =>
        reject(
          new Error(
            `${label} timed out after ${Math.round(ms / 1000)}s. Check your network, VPN, ad blockers, and that Firebase / API keys in .env are correct.`,
          ),
        ),
      ms,
    )
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(tid)
  }
}
