/// <reference types="vite/client" />

import type { ParrotApi } from '../../shared/project'

declare global {
  interface Window {
    parrot?: ParrotApi
  }
}

export {}
