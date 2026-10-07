import { blockIdFromInput, fieldId, fieldValue } from './block-input.ts'
import { pythonString } from './python-syntax.ts'
import type { StatementConverter } from './compiler-types.ts'

const statement = (convert: StatementConverter): StatementConverter => convert

const motionStatement = (convert: StatementConverter): StatementConverter => statement((context) => {
  if (context.target.isStage) {
    context.services.warn(`Motion block ${context.block.opcode} on the Stage was skipped.`)
    const pad = '    '.repeat(context.indent)
    return [`${pad}# Scratch Motion blocks only run on sprites.`, `${pad}pass`]
  }
  return convert(context)
})

export const statementConverters: Record<string, StatementConverter> = {
  motion_movesteps: motionStatement(({ block, target, indent, actor, services }) => [
    `${'    '.repeat(indent)}${actor}.move(${services.input(block.inputs.STEPS, target)})`
  ]),
  motion_turnright: motionStatement(({ block, target, indent, actor, services }) => [
    `${'    '.repeat(indent)}${actor}.turn_right(${services.input(block.inputs.DEGREES, target)})`
  ]),
  motion_turnleft: motionStatement(({ block, target, indent, actor, services }) => [
    `${'    '.repeat(indent)}${actor}.turn_left(${services.input(block.inputs.DEGREES, target)})`
  ]),
  motion_goto: motionStatement(({ block, target, indent, actor, services }) => [
    `${'    '.repeat(indent)}${actor}.go_to_target(${services.input(block.inputs.TO, target)})`
  ]),
  motion_gotoxy: motionStatement(({ block, target, indent, actor, services }) => [
    `${'    '.repeat(indent)}${actor}.go_to(${services.input(block.inputs.X, target)}, ${services.input(block.inputs.Y, target)})`
  ]),
  motion_glideto: motionStatement(({ block, target, indent, actor, services }) => [
    `${'    '.repeat(indent)}await ${actor}.glide_to_target(${services.input(block.inputs.TO, target)}, ${services.input(block.inputs.SECS, target)})`
  ]),
  motion_glidesecstoxy: motionStatement(({ block, target, indent, actor, services }) => [
    `${'    '.repeat(indent)}await ${actor}.glide_to(${services.input(block.inputs.X, target)}, ${services.input(block.inputs.Y, target)}, ${services.input(block.inputs.SECS, target)})`
  ]),
  motion_pointindirection: motionStatement(({ block, target, indent, actor, services }) => [
    `${'    '.repeat(indent)}${actor}.point_in_direction(${services.input(block.inputs.DIRECTION, target)})`
  ]),
  motion_pointtowards: motionStatement(({ block, target, indent, actor, services }) => [
    `${'    '.repeat(indent)}${actor}.point_towards(${services.input(block.inputs.TOWARDS, target)})`
  ]),
  motion_setx: motionStatement(({ block, target, indent, actor, services }) => [
    `${'    '.repeat(indent)}${actor}.set_x(${services.input(block.inputs.X, target)})`
  ]),
  motion_sety: motionStatement(({ block, target, indent, actor, services }) => [
    `${'    '.repeat(indent)}${actor}.set_y(${services.input(block.inputs.Y, target)})`
  ]),
  motion_changexby: motionStatement(({ block, target, indent, actor, services }) => [
    `${'    '.repeat(indent)}${actor}.change_x(${services.input(block.inputs.DX, target)})`
  ]),
  motion_changeyby: motionStatement(({ block, target, indent, actor, services }) => [
    `${'    '.repeat(indent)}${actor}.change_y(${services.input(block.inputs.DY, target)})`
  ]),
  motion_ifonedgebounce: motionStatement(({ indent, actor }) => [
    `${'    '.repeat(indent)}${actor}.bounce_if_on_edge()`
  ]),
  motion_setrotationstyle: motionStatement(({ block, indent, actor }) => [
    `${'    '.repeat(indent)}${actor}.set_rotation_style(${pythonString(fieldValue(block, 'STYLE'))})`
  ]),
  looks_show: statement(({ indent, actor }) => [`${'    '.repeat(indent)}${actor}.show()`]),
  looks_hide: statement(({ indent, actor }) => [`${'    '.repeat(indent)}${actor}.hide()`]),
  data_setvariableto: statement(({ block, target, indent, services }) => {
    const id = String(fieldId(block, 'VARIABLE'))
    const variable = services.variable(id)
    if (!variable) services.warn(`A variable referenced in ${target.name} is missing from the project.`)
    const reference = variable ?? `project.variable_by_id(${pythonString(id)})`
    return [`${'    '.repeat(indent)}${reference}.set(${services.input(block.inputs.VALUE, target)})`]
  }),
  data_changevariableby: statement(({ block, target, indent, services }) => {
    const id = String(fieldId(block, 'VARIABLE'))
    const variable = services.variable(id)
    if (!variable) services.warn(`A variable referenced in ${target.name} is missing from the project.`)
    const reference = variable ?? `project.variable_by_id(${pythonString(id)})`
    return [`${'    '.repeat(indent)}${reference}.change(${services.input(block.inputs.VALUE, target)})`]
  }),
  control_repeat: statement(({ block, target, indent, ancestors, services }) => {
    const pad = '    '.repeat(indent)
    const childPad = '    '.repeat(indent + 1)
    const body = services.stack(blockIdFromInput(block.inputs.SUBSTACK), target, indent + 1, new Set(ancestors))
    return [
      `${pad}for _ in range(max(0, int(scratch_number(${services.input(block.inputs.TIMES, target)})))):`,
      ...(body.length ? body : [`${childPad}pass`]),
      `${childPad}await project.next_frame()`
    ]
  }),
  control_forever: statement(({ block, target, indent, ancestors, services }) => {
    const pad = '    '.repeat(indent)
    const childPad = '    '.repeat(indent + 1)
    const body = services.stack(blockIdFromInput(block.inputs.SUBSTACK), target, indent + 1, new Set(ancestors))
    return [
      `${pad}while True:`,
      ...(body.length ? body : [`${childPad}pass`]),
      `${childPad}await project.next_frame()`
    ]
  }),
  control_if: statement(({ block, target, indent, ancestors, services }) => {
    const pad = '    '.repeat(indent)
    const body = services.stack(blockIdFromInput(block.inputs.SUBSTACK), target, indent + 1, new Set(ancestors))
    return [
      `${pad}if scratch_truth(${services.input(block.inputs.CONDITION, target)}):`,
      ...(body.length ? body : [`${'    '.repeat(indent + 1)}pass`])
    ]
  }),
  control_if_else: statement(({ block, target, indent, ancestors, services }) => {
    const pad = '    '.repeat(indent)
    const childPad = '    '.repeat(indent + 1)
    const first = services.stack(blockIdFromInput(block.inputs.SUBSTACK), target, indent + 1, new Set(ancestors))
    const second = services.stack(blockIdFromInput(block.inputs.SUBSTACK2), target, indent + 1, new Set(ancestors))
    return [
      `${pad}if scratch_truth(${services.input(block.inputs.CONDITION, target)}):`,
      ...(first.length ? first : [`${childPad}pass`]),
      `${pad}else:`,
      ...(second.length ? second : [`${childPad}pass`])
    ]
  })
}
