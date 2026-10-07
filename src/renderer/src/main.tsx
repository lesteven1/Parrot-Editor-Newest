import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import App from './FocusedAppV04'
import './styles.css'
import './focused.css'

const workerScope = self as typeof globalThis & {
  MonacoEnvironment?: { getWorker: () => Worker }
}

workerScope.MonacoEnvironment = {
  getWorker: () => new EditorWorker()
}

loader.config({ monaco })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
