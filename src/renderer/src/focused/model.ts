export type FocusedActivity = 'explorer' | 'search' | 'settings'
export type FocusedFileKind = 'scratch' | 'python'

export interface FocusedViewState {
  activity: FocusedActivity
  sidebarOpen: boolean
  scratchOpen: boolean
  pythonOpen: boolean
  selectedFile: FocusedFileKind
  codeUpToDate: boolean
}

export type FocusedViewAction =
  | { type: 'toggle-sidebar' }
  | { type: 'select-activity'; activity: FocusedActivity }
  | { type: 'open-file'; file: FocusedFileKind }
  | { type: 'close-file'; file: FocusedFileKind }
  | { type: 'mark-code-stale' }
  | { type: 'mark-code-updated' }

export function createFocusedViewState(hasProject: boolean): FocusedViewState {
  return {
    activity: 'explorer',
    sidebarOpen: true,
    scratchOpen: hasProject,
    pythonOpen: hasProject,
    selectedFile: 'scratch',
    codeUpToDate: hasProject
  }
}

export function focusedViewReducer(
  state: FocusedViewState,
  action: FocusedViewAction
): FocusedViewState {
  switch (action.type) {
    case 'toggle-sidebar':
      return { ...state, sidebarOpen: !state.sidebarOpen }
    case 'select-activity':
      return {
        ...state,
        activity: action.activity,
        sidebarOpen: state.activity === action.activity ? !state.sidebarOpen : true
      }
    case 'open-file':
      return {
        ...state,
        selectedFile: action.file,
        scratchOpen: action.file === 'scratch' ? true : state.scratchOpen,
        pythonOpen: action.file === 'python' ? true : state.pythonOpen
      }
    case 'close-file': {
      const scratchOpen = action.file === 'scratch' ? false : state.scratchOpen
      const pythonOpen = action.file === 'python' ? false : state.pythonOpen
      const selectedFile = action.file !== state.selectedFile
        ? state.selectedFile
        : scratchOpen
          ? 'scratch'
          : 'python'
      return { ...state, scratchOpen, pythonOpen, selectedFile }
    }
    case 'mark-code-stale':
      return state.codeUpToDate ? { ...state, codeUpToDate: false } : state
    case 'mark-code-updated':
      return state.codeUpToDate ? state : { ...state, codeUpToDate: true }
  }
}

export function projectFileNames(scratchName: string): { scratch: string; python: string } {
  const normalizedScratch = scratchName.toLowerCase().endsWith('.sb3')
    ? scratchName
    : `${scratchName}.sb3`
  return {
    scratch: normalizedScratch,
    python: `${normalizedScratch.replace(/\.sb3$/i, '')}.py`
  }
}

export function projectFolderName(scratchName: string): string {
  return scratchName.replace(/\.sb3$/i, '').trim() || 'PROJECT'
}
