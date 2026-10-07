import add from '../assets/vscode-icons/add.svg'
import checklist from '../assets/vscode-icons/checklist.svg'
import chevronDown from '../assets/vscode-icons/chevron-down.svg'
import chevronLeft from '../assets/vscode-icons/chevron-left.svg'
import chevronRight from '../assets/vscode-icons/chevron-right.svg'
import close from '../assets/vscode-icons/close.svg'
import debugDisconnect from '../assets/vscode-icons/debug-disconnect.svg'
import debugStart from '../assets/vscode-icons/debug-start.svg'
import debugStop from '../assets/vscode-icons/debug-stop.svg'
import editorLayout from '../assets/vscode-icons/editor-layout.svg'
import fileCode from '../assets/vscode-icons/file-code.svg'
import files from '../assets/vscode-icons/files.svg'
import link from '../assets/vscode-icons/link.svg'
import newFile from '../assets/vscode-icons/new-file.svg'
import newFolder from '../assets/vscode-icons/new-folder.svg'
import packageIcon from '../assets/vscode-icons/package.svg'
import refresh from '../assets/vscode-icons/refresh.svg'
import screenNormal from '../assets/vscode-icons/screen-normal.svg'
import search from '../assets/vscode-icons/search.svg'
import settingsGear from '../assets/vscode-icons/settings-gear.svg'

export type VscodeIconName =
  | 'add'
  | 'checklist'
  | 'chevron-down'
  | 'chevron-left'
  | 'chevron-right'
  | 'close'
  | 'debug-disconnect'
  | 'debug-start'
  | 'debug-stop'
  | 'editor-layout'
  | 'file-code'
  | 'files'
  | 'link'
  | 'new-file'
  | 'new-folder'
  | 'package'
  | 'refresh'
  | 'screen-normal'
  | 'search'
  | 'settings-gear'

const ICONS: Record<VscodeIconName, string> = {
  add,
  checklist,
  'chevron-down': chevronDown,
  'chevron-left': chevronLeft,
  'chevron-right': chevronRight,
  close,
  'debug-disconnect': debugDisconnect,
  'debug-start': debugStart,
  'debug-stop': debugStop,
  'editor-layout': editorLayout,
  'file-code': fileCode,
  files,
  link,
  'new-file': newFile,
  'new-folder': newFolder,
  package: packageIcon,
  refresh,
  'screen-normal': screenNormal,
  search,
  'settings-gear': settingsGear
}

export function VscodeIcon({
  name,
  className = ''
}: {
  name: VscodeIconName
  className?: string
}): React.JSX.Element {
  return <img className={`fp-icon ${className}`.trim()} src={ICONS[name]} alt="" aria-hidden="true" />
}
