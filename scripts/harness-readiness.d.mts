/** Extract a valid credential-free loopback origin from Harness startup output. */
export function readinessOrigin(output: string): string | undefined
/** Parse a loopback bootstrap endpoint; its credential must remain in memory. */
export function readinessEndpoint(output: string): URL | undefined
