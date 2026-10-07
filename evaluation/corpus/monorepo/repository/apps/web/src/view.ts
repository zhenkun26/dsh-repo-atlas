import { calculateTotal } from '../../../packages/shared/src/math.js'
export function renderTotal(value: number) { return String(calculateTotal([value])) }
