/** Extract only a loopback origin; current Harness readiness URLs carry credentials. */
export function readinessOrigin(output) {
  return readinessEndpoint(output)?.origin
}

/** The bootstrap credential stays in caller memory and must never be logged. */
export function readinessEndpoint(output) {
  const match = output.match(/^dsh web: (http:\/\/\S+)/m)
  if (!match || match[1].length > 4_096) return undefined
  try {
    const url = new URL(match[1])
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password ||
      url.port === '' || Number(url.port) < 1 || url.pathname !== '/') return undefined
    return url
  } catch { return undefined }
}
