import { createInvoice } from '../src/services/invoice.js'
import { roundCents } from '../src/lib/money.js'
export const invoiceExample = createInvoice(roundCents(12.345))
