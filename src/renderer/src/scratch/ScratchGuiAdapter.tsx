import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties
} from 'react'
import ScratchGUI, {
  buildInitialState,
  guiMiddleware,
  guiReducers,
  legacyConfig,
  localesInitialState
} from '@scratch/scratch-gui'
import type VirtualMachine from '@scratch/scratch-vm'
import type { ScratchStorage } from '@scratch/scratch-storage'
import { combineReducers, createStore, type AnyAction, type Reducer, type Store } from 'redux'
import { Provider } from 'react-redux'
import { VscodeIcon } from '../components/VscodeIcon'
import {
  layoutScratchGui,
  restrictedToolboxForVm,
  shareScratchGuiVmState,
  type ScratchGuiStageSizeMode,
  type ScratchVmEditorContract
} from './editor-model'
import { configureLocalScratchLibrary } from './library-assets'

const TOOLBOX_UPDATE = 'scratch-gui/toolbox/UPDATE_TOOLBOX'

interface ScratchVmAdapter {
  editingTarget?: ScratchVmEditorContract['editingTarget']
  emitTargetsUpdate: (triggerProjectChange: boolean) => void
  refreshWorkspace: () => void
}

interface ScratchGuiState {
  scratchGui: Record<string, unknown>
  locales: unknown
}

function createGuiStore(vm: ScratchVmAdapter, storage: ScratchStorage): Store {
  const config = {
    storage: {
      scratchStorage: storage,
      saveProject: async () => ({ id: 'parrot-local-project' })
    }
  }
  const initialGui = shareScratchGuiVmState(
    buildInitialState(config) as Record<string, unknown>,
    vm
  )

  const baseGuiReducer = guiReducers.scratchGui as unknown as Reducer<Record<string, unknown>, AnyAction>
  const parrotGuiReducer: Reducer<Record<string, unknown>, AnyAction> = (state, action) => {
    const restrictedAction = action.type === TOOLBOX_UPDATE
      ? { ...action, toolboxXML: restrictedToolboxForVm(vm) }
      : action
    const next = baseGuiReducer(state, restrictedAction)
    const toolbox = next.toolbox as { toolboxXML?: unknown } | undefined
    const restrictedToolbox = restrictedToolboxForVm(vm)
    return toolbox?.toolboxXML === restrictedToolbox
      ? next
      : { ...next, toolbox: { ...toolbox, toolboxXML: restrictedToolbox } }
  }
  const rootReducer = combineReducers({
    ...guiReducers,
    scratchGui: parrotGuiReducer
  })
  const preloadedState: ScratchGuiState = {
    locales: localesInitialState,
    scratchGui: initialGui
  }
  return createStore(
    rootReducer,
    preloadedState as never,
    guiMiddleware as never
  )
}

function stageSizeModeFromStore(store: Store): ScratchGuiStageSizeMode {
  const state = store.getState() as ScratchGuiState
  const stageSize = state.scratchGui.stageSize as { stageSize?: unknown } | undefined
  return stageSize?.stageSize === 'small' ? 'small' : 'large'
}

function useScratchStageSizeMode(store: Store): ScratchGuiStageSizeMode {
  const [stageSizeMode, setStageSizeMode] = useState(() => stageSizeModeFromStore(store))

  useEffect(() => store.subscribe(() => {
    const next = stageSizeModeFromStore(store)
    setStageSizeMode((current) => current === next ? current : next)
  }), [store])

  return stageSizeMode
}

function fullScreenFromStore(store: Store): boolean {
  const state = store.getState() as ScratchGuiState
  const mode = state.scratchGui.mode as { isFullScreen?: unknown } | undefined
  return mode?.isFullScreen === true
}

function useScratchFullScreen(store: Store): boolean {
  const [fullScreen, setFullScreen] = useState(() => fullScreenFromStore(store))

  useEffect(() => store.subscribe(() => {
    const next = fullScreenFromStore(store)
    setFullScreen((current) => current === next ? current : next)
  }), [store])

  return fullScreen
}

function useScratchGuiLayout(stageSizeMode: ScratchGuiStageSizeMode): {
  hostRef: React.RefObject<HTMLDivElement>
  scale: number
  surfaceWidth: number
  surfaceHeight: number
} {
  const hostRef = useRef<HTMLDivElement>(null)
  const [layout, setLayout] = useState(() => layoutScratchGui(0, 0, stageSizeMode))

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    const update = (): void => {
      const next = layoutScratchGui(host.clientWidth, host.clientHeight, stageSizeMode)
      setLayout((current) => (
        Math.abs(current.scale - next.scale) < 0.001 &&
        Math.abs(current.width - next.width) < 0.5 &&
        Math.abs(current.height - next.height) < 0.5
          ? current
          : next
      ))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(host)
    return () => observer.disconnect()
  }, [stageSizeMode])

  return {
    hostRef,
    scale: layout.scale,
    surfaceWidth: layout.width,
    surfaceHeight: layout.height
  }
}

export interface ScratchGuiAdapterProps {
  vm: VirtualMachine
  storage: ScratchStorage
  projectName: string
}

/**
 * The only package-facing Scratch GUI integration point in Parrot. The adapter
 * supplies Parrot's already-loaded VM and storage to Scratch GUI's public root,
 * and constrains the toolbox before Scratch Blocks receives each update.
 */
export function ScratchGuiAdapter({
  vm: rawVm,
  storage,
  projectName
}: ScratchGuiAdapterProps): React.JSX.Element {
  const vm = rawVm as unknown as ScratchVmAdapter
  configureLocalScratchLibrary(legacyConfig.storage.scratchStorage)
  const store = useMemo(() => createGuiStore(vm, storage), [storage, vm])
  const stageSizeMode = useScratchStageSizeMode(store)
  const fullScreen = useScratchFullScreen(store)
  const { hostRef, scale, surfaceWidth, surfaceHeight } = useScratchGuiLayout(stageSizeMode)
  const Gui = ScratchGUI as ComponentType<Record<string, unknown>>
  const surfaceStyle = {
    '--scratch-gui-scale': String(scale),
    width: surfaceWidth,
    height: surfaceHeight
  } as CSSProperties

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      vm.emitTargetsUpdate(false)
      vm.refreshWorkspace()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [store, vm])

  useLayoutEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'))
      vm.refreshWorkspace()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [scale, stageSizeMode, surfaceHeight, surfaceWidth, vm])

  return (
    <div className={`scratch-gui-adapter ${fullScreen ? 'scratch-gui-adapter--fullscreen' : ''}`} ref={hostRef} data-project-wheel="local">
      <div className="scratch-gui-surface" style={surfaceStyle}>
        <Provider store={store}>
          <Gui
            vm={vm}
            projectTitle={projectName.replace(/\.sb3$/i, '')}
            basePath="./scratch-gui/"
            menuBarHidden
            canManageFiles={false}
            canSave={false}
            canShare={false}
            canRemix={false}
            canCreateCopy={false}
            canCreateNew={false}
            canEditTitle={false}
            canUseCloud={false}
            enableCommunity={false}
            backpackVisible={false}
            showComingSoon={false}
            showNewFeatureCallouts={false}
            isTelemetryEnabled={false}
            platform="DESKTOP"
          />
        </Provider>
      </div>
      {fullScreen && <button
        className="scratch-gui-exit-fullscreen"
        type="button"
        aria-label="Exit Scratch fullscreen"
        title="Exit fullscreen"
        onClick={() => store.dispatch({ type: 'scratch-gui/mode/SET_FULL_SCREEN', isFullScreen: false })}
      ><VscodeIcon name="screen-normal" /></button>}
    </div>
  )
}
