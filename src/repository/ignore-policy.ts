interface IgnoreRule { pattern: string; anchored: boolean; directory: boolean }

/** Positive root rules only; bounded glob matching avoids regex backtracking. */
export function parseRootIgnorePolicy(text: string) {
  const rules: IgnoreRule[] = []
  let unsupported = 0
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    if (line.startsWith('!') || /[\\\[\]]/.test(line) || /\s/.test(line) || line.length > 256 || rules.length >= 128) { unsupported++; continue }
    const anchored = line.startsWith('/')
    const directory = line.endsWith('/')
    const pattern = line.replace(/^\//, '').replace(/\/$/, '')
    if (!pattern || pattern.split('/').some(part => !part || part === '.' || part === '..')) { unsupported++; continue }
    rules.push({ pattern, anchored: anchored || pattern.includes('/'), directory })
  }
  return { unsupported, ignored(relativePath: string, directory = false) {
    const parts = relativePath.split('/')
    return rules.some(rule => parts.some((_part, index) => {
      if (rule.directory && index === parts.length - 1 && !directory) return false
      const candidate = rule.anchored ? parts.slice(0, index + 1).join('/') : parts[index]
      return globMatches(rule.pattern, candidate)
    }))
  } }
}

function globMatches(pattern: string, value: string): boolean {
  const memo = new Map<string, boolean>()
  function match(p: number, v: number): boolean {
    const key = `${p}:${v}`
    if (memo.has(key)) return memo.get(key)!
    let result: boolean
    if (p === pattern.length) result = v === value.length
    else if (pattern[p] === '*' && pattern[p + 1] === '*') {
      if (pattern[p + 2] === '/') result = match(p + 3, v) || consumeDirectories(p, v)
      else result = match(p + 2, v) || v < value.length && match(p, v + 1)
    } else if (pattern[p] === '*') result = match(p + 1, v) || v < value.length && value[v] !== '/' && match(p, v + 1)
    else result = v < value.length && (pattern[p] === '?' ? value[v] !== '/' : pattern[p] === value[v]) && match(p + 1, v + 1)
    memo.set(key, result)
    return result
  }
  function consumeDirectories(p: number, v: number): boolean {
    const key = `directory:${p}:${v}`
    if (memo.has(key)) return memo.get(key)!
    const result = v < value.length && (value[v] === '/' && match(p + 3, v + 1) || consumeDirectories(p, v + 1))
    memo.set(key, result)
    return result
  }
  return value.length <= 1024 && match(0, 0)
}
