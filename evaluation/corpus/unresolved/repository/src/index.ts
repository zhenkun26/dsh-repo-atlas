import { serve } from '@app/service'
import './absent.ts'
export function loadLater() { return import('./lazy.ts') }
export const handler = serve
