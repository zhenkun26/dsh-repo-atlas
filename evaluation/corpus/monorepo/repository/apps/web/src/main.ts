import { calculateTotal } from '@shared/math'
import { renderTotal } from './view.js'
export const webTotal = renderTotal(calculateTotal([5, 6]))
