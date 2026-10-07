import type { HarnessTool } from './public.ts'

type JsonOutput = null | boolean | number | string | JsonOutput[] | { [key: string]: JsonOutput }

/** Omit absent DTO fields; reject values that the native tool registry cannot preserve. */
export function jsonOutput(value: unknown): JsonOutput {
  const ancestors = new Set<object>()
  return visit(value, 0)

  function visit(value: unknown, depth: number): JsonOutput {
    if (depth > 128) throw new TypeError('Harness output exceeds the JSON nesting limit')
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
    if (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)) return value
    if (typeof value !== 'object' || value === null || ancestors.has(value)) throw new TypeError('Harness output contains a non-JSON value or cycle')
    const prototype = Object.getPrototypeOf(value)
    if (Array.isArray(value) && prototype !== Array.prototype) throw new TypeError('Harness output must contain plain arrays')
    if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) throw new TypeError('Harness output must contain plain DTO objects')
    ancestors.add(value)
    try {
      if (Array.isArray(value)) {
        if (Reflect.ownKeys(value).length !== value.length + 1) throw new TypeError('Harness output array has holes or extra properties')
        const result: JsonOutput[] = []
        for (let index = 0; index < value.length; index++) result.push(visit(dataProperty(value, String(index)), depth + 1))
        return result
      }
      const result: { [key: string]: JsonOutput } = {}
      for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== 'string') throw new TypeError('Harness output contains symbol properties')
        const item = dataProperty(value, key)
        if (item !== undefined) Object.defineProperty(result, key, { value: visit(item, depth + 1), enumerable: true, writable: true, configurable: true })
      }
      return result
    } finally { ancestors.delete(value) }
  }
}

function dataProperty(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError('Harness output contains an accessor or hidden property')
  return descriptor.value
}

/** Normalize only the returned DTO, preserving the original execution and authority checks. */
export function withJsonOutput(tool: HarnessTool): HarnessTool {
  return { ...tool, async execute(input, execution) { return jsonOutput(await tool.execute(input, execution)) } }
}
