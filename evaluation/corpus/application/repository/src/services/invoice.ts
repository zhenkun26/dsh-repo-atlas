import { roundCents } from '../lib/money.js'
export function createInvoice(amount: number) { return { amount: roundCents(amount) } }
