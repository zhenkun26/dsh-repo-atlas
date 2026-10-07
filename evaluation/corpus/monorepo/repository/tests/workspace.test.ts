import { apiBoot } from '../apps/api/src/main.js'
import { renderTotal } from '../apps/web/src/view.js'
export const workspaceExample = renderTotal(apiBoot())
