export const SELECT_BLOCKS_TOOLBOX = `
<xml xmlns="https://developers.google.com/blockly/xml">
  <category name="Motion" toolboxitemid="motion" colour="#4C97FF" secondaryColour="#4280D7">
    <block type="motion_movesteps"><value name="STEPS"><shadow type="math_number"><field name="NUM">10</field></shadow></value></block>
    <block type="motion_turnright"><value name="DEGREES"><shadow type="math_number"><field name="NUM">15</field></shadow></value></block>
    <block type="motion_turnleft"><value name="DEGREES"><shadow type="math_number"><field name="NUM">15</field></shadow></value></block>
    <sep gap="36" />
    <block type="motion_goto"><value name="TO"><shadow type="motion_goto_menu"><field name="TO">_random_</field></shadow></value></block>
    <block type="motion_gotoxy">
      <value name="X"><shadow type="math_number"><field name="NUM">0</field></shadow></value>
      <value name="Y"><shadow type="math_number"><field name="NUM">0</field></shadow></value>
    </block>
    <block type="motion_glideto">
      <value name="SECS"><shadow type="math_number"><field name="NUM">1</field></shadow></value>
      <value name="TO"><shadow type="motion_glideto_menu"><field name="TO">_random_</field></shadow></value>
    </block>
    <block type="motion_glidesecstoxy">
      <value name="SECS"><shadow type="math_number"><field name="NUM">1</field></shadow></value>
      <value name="X"><shadow type="math_number"><field name="NUM">0</field></shadow></value>
      <value name="Y"><shadow type="math_number"><field name="NUM">0</field></shadow></value>
    </block>
    <sep gap="36" />
    <block type="motion_pointindirection"><value name="DIRECTION"><shadow type="math_angle"><field name="NUM">90</field></shadow></value></block>
    <block type="motion_pointtowards"><value name="TOWARDS"><shadow type="motion_pointtowards_menu"><field name="TOWARDS">_mouse_</field></shadow></value></block>
    <sep gap="36" />
    <block type="motion_changexby"><value name="DX"><shadow type="math_number"><field name="NUM">10</field></shadow></value></block>
    <block type="motion_setx"><value name="X"><shadow type="math_number"><field name="NUM">0</field></shadow></value></block>
    <block type="motion_changeyby"><value name="DY"><shadow type="math_number"><field name="NUM">10</field></shadow></value></block>
    <block type="motion_sety"><value name="Y"><shadow type="math_number"><field name="NUM">0</field></shadow></value></block>
    <sep gap="36" />
    <block type="motion_ifonedgebounce" />
    <block type="motion_setrotationstyle"><field name="STYLE">left-right</field></block>
    <sep gap="36" />
    <block type="motion_xposition" />
    <block type="motion_yposition" />
    <block type="motion_direction" />
  </category>
  <category name="Looks" toolboxitemid="looks" colour="#9966FF" secondaryColour="#855CD6">
    <block type="looks_show" />
    <block type="looks_hide" />
  </category>
  <category name="Events" toolboxitemid="events" colour="#FFBF00" secondaryColour="#E6AC00">
    <block type="event_whenflagclicked" />
  </category>
  <category name="Control" toolboxitemid="control" colour="#FFAB19" secondaryColour="#CF8B17">
    <block type="control_forever" />
    <block type="control_repeat"><value name="TIMES"><shadow type="math_whole_number"><field name="NUM">10</field></shadow></value></block>
    <block type="control_if" />
    <block type="control_if_else" />
  </category>
  <category name="Sensing" toolboxitemid="sensing" colour="#5CB1D6" secondaryColour="#47A8D1">
    <block type="sensing_keypressed"><value name="KEY_OPTION"><shadow type="sensing_keyoptions"><field name="KEY_OPTION">space</field></shadow></value></block>
    <block type="sensing_touchingobject"><value name="TOUCHINGOBJECTMENU"><shadow type="sensing_touchingobjectmenu"><field name="TOUCHINGOBJECTMENU">_edge_</field></shadow></value></block>
  </category>
  <category name="Operators" toolboxitemid="operators" colour="#59C059" secondaryColour="#46B946">
    <block type="operator_add"><value name="NUM1"><shadow type="math_number"><field name="NUM"></field></shadow></value><value name="NUM2"><shadow type="math_number"><field name="NUM"></field></shadow></value></block>
    <block type="operator_subtract"><value name="NUM1"><shadow type="math_number"><field name="NUM"></field></shadow></value><value name="NUM2"><shadow type="math_number"><field name="NUM"></field></shadow></value></block>
    <block type="operator_multiply"><value name="NUM1"><shadow type="math_number"><field name="NUM"></field></shadow></value><value name="NUM2"><shadow type="math_number"><field name="NUM"></field></shadow></value></block>
    <block type="operator_divide"><value name="NUM1"><shadow type="math_number"><field name="NUM"></field></shadow></value><value name="NUM2"><shadow type="math_number"><field name="NUM"></field></shadow></value></block>
    <block type="operator_lt"><value name="OPERAND1"><shadow type="text"><field name="TEXT"></field></shadow></value><value name="OPERAND2"><shadow type="text"><field name="TEXT">50</field></shadow></value></block>
    <block type="operator_equals"><value name="OPERAND1"><shadow type="text"><field name="TEXT"></field></shadow></value><value name="OPERAND2"><shadow type="text"><field name="TEXT">50</field></shadow></value></block>
    <block type="operator_gt"><value name="OPERAND1"><shadow type="text"><field name="TEXT"></field></shadow></value><value name="OPERAND2"><shadow type="text"><field name="TEXT">50</field></shadow></value></block>
    <block type="operator_and" />
    <block type="operator_or" />
    <block type="operator_not" />
  </category>
  <category name="Variables" toolboxitemid="variables" colour="#FF8C1A" secondaryColour="#DB6E00">
    <block type="data_variable"><field name="VARIABLE" id="parrot-score">score</field></block>
    <block type="data_setvariableto"><field name="VARIABLE" id="parrot-score">score</field><value name="VALUE"><shadow type="text"><field name="TEXT">0</field></shadow></value></block>
    <block type="data_changevariableby"><field name="VARIABLE" id="parrot-score">score</field><value name="VALUE"><shadow type="math_number"><field name="NUM">1</field></shadow></value></block>
  </category>
</xml>`

export const SCRATCH_BOOTSTRAP_TOOLBOX = SELECT_BLOCKS_TOOLBOX.replace(
  /(<category name="Variables"[^>]*>)[\s\S]*?(<\/category>)/,
  '$1$2'
)

export interface ScratchToolboxVariable {
  id: string
  name: string
}

function xmlEscape(value: string): string {
  return value.replace(/[<>&'"]/g, (character) => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    "'": '&apos;',
    '"': '&quot;'
  })[character] ?? character)
}

function variableBlocks(variables: ScratchToolboxVariable[]): string {
  if (variables.length === 0) return '<label text="No variables in this target"></label>'
  return variables.map(({ id, name }) => {
    const safeId = xmlEscape(id)
    const safeName = xmlEscape(name)
    return `
    <block type="data_variable"><field name="VARIABLE" id="${safeId}">${safeName}</field></block>
    <block type="data_setvariableto"><field name="VARIABLE" id="${safeId}">${safeName}</field><value name="VALUE"><shadow type="text"><field name="TEXT">0</field></shadow></value></block>
    <block type="data_changevariableby"><field name="VARIABLE" id="${safeId}">${safeName}</field><value name="VALUE"><shadow type="math_number"><field name="NUM">1</field></shadow></value></block>`
  }).join('')
}

export const toolboxForTarget = (
  isStage: boolean,
  variables: ScratchToolboxVariable[] = []
): string => {
  const targetToolbox = isStage
    ? SELECT_BLOCKS_TOOLBOX.replace(/\s*<category name="Motion"[\s\S]*?<\/category>/, '')
    : SELECT_BLOCKS_TOOLBOX
  return targetToolbox.replace(
    /(<category name="Variables"[^>]*>)[\s\S]*?(<\/category>)/,
    `$1${variableBlocks(variables)}$2`
  )
}
