import { fieldId, fieldValue } from './block-input.ts'
import { pythonString } from './python-syntax.ts'
import type { ReporterConverter } from './compiler-types.ts'

const reporter = (convert: ReporterConverter): ReporterConverter => convert

const motionReporter = (convert: ReporterConverter): ReporterConverter => reporter((context) => {
  if (context.target.isStage) {
    context.services.warn(`Motion reporter ${context.block.opcode} on the Stage was replaced with 0.`)
    return '0'
  }
  return convert(context)
})

export const reporterConverters: Record<string, ReporterConverter> = {
  motion_goto_menu: motionReporter(({ block }) => pythonString(fieldValue(block, 'TO'))),
  motion_glideto_menu: motionReporter(({ block }) => pythonString(fieldValue(block, 'TO'))),
  motion_pointtowards_menu: motionReporter(({ block }) => pythonString(fieldValue(block, 'TOWARDS'))),
  motion_xposition: motionReporter(({ actor }) => `${actor}.x_position`),
  motion_yposition: motionReporter(({ actor }) => `${actor}.y_position`),
  motion_direction: motionReporter(({ actor }) => `${actor}.direction`),
  sensing_keypressed: reporter(({ block, target, services }) =>
    `project.key_pressed(${services.input(block.inputs.KEY_OPTION, target)})`),
  sensing_keyoptions: reporter(({ block }) => pythonString(fieldValue(block, 'KEY_OPTION'))),
  sensing_touchingobject: reporter(({ block, target, actor, services }) =>
    `${actor}.touching(${services.input(block.inputs.TOUCHINGOBJECTMENU, target)})`),
  sensing_touchingobjectmenu: reporter(({ block }) => pythonString(fieldValue(block, 'TOUCHINGOBJECTMENU'))),
  operator_add: reporter(({ block, target, services }) =>
    `(scratch_number(${services.input(block.inputs.NUM1, target)}) + scratch_number(${services.input(block.inputs.NUM2, target)}))`),
  operator_subtract: reporter(({ block, target, services }) =>
    `(scratch_number(${services.input(block.inputs.NUM1, target)}) - scratch_number(${services.input(block.inputs.NUM2, target)}))`),
  operator_multiply: reporter(({ block, target, services }) =>
    `(scratch_number(${services.input(block.inputs.NUM1, target)}) * scratch_number(${services.input(block.inputs.NUM2, target)}))`),
  operator_divide: reporter(({ block, target, services }) =>
    `scratch_divide(${services.input(block.inputs.NUM1, target)}, ${services.input(block.inputs.NUM2, target)})`),
  operator_lt: reporter(({ block, target, services }) =>
    `scratch_compare(${services.input(block.inputs.OPERAND1, target)}, ${services.input(block.inputs.OPERAND2, target)}) < 0`),
  operator_equals: reporter(({ block, target, services }) =>
    `scratch_equals(${services.input(block.inputs.OPERAND1, target)}, ${services.input(block.inputs.OPERAND2, target)})`),
  operator_gt: reporter(({ block, target, services }) =>
    `scratch_compare(${services.input(block.inputs.OPERAND1, target)}, ${services.input(block.inputs.OPERAND2, target)}) > 0`),
  operator_and: reporter(({ block, target, services }) =>
    `(scratch_truth(${services.input(block.inputs.OPERAND1, target)}) and scratch_truth(${services.input(block.inputs.OPERAND2, target)}))`),
  operator_or: reporter(({ block, target, services }) =>
    `(scratch_truth(${services.input(block.inputs.OPERAND1, target)}) or scratch_truth(${services.input(block.inputs.OPERAND2, target)}))`),
  operator_not: reporter(({ block, target, services }) =>
    `(not scratch_truth(${services.input(block.inputs.OPERAND, target)}))`),
  data_variable: reporter(({ block, services }) => {
    const id = String(fieldId(block, 'VARIABLE'))
    return `${services.variable(id) ?? `project.variable_by_id(${pythonString(id)})`}.value`
  })
}
