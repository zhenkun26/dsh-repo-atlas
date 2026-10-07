import { createInvoice } from '../services/invoice.js'
export function routeInvoice(amount: number) { return createInvoice(amount) }
