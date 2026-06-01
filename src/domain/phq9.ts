import type { PhqAnswer, PhqResult } from './types'

export const PHQ9_QUESTIONS = [
  '做事时提不起劲或没有兴趣',
  '感到心情低落、沮丧或绝望',
  '入睡困难、睡不安稳或睡眠过多',
  '感觉疲倦或没有活力',
  '食欲不振或吃得太多',
  '觉得自己很糟，或觉得自己很失败，或让自己或家人失望',
  '对事物专注有困难，例如阅读报纸或看电视时',
  '动作或说话速度缓慢到别人已经察觉，或相反，比平时烦躁、坐立不安、动来动去',
  '有不如死掉或用某种方式伤害自己的念头',
] as const

export const PHQ9_OPTIONS: { value: PhqAnswer; label: string }[] = [
  { value: 0, label: '完全没有' },
  { value: 1, label: '有几天' },
  { value: 2, label: '一半以上时间' },
  { value: 3, label: '几乎每天' },
]

export function scorePhq9(answers: PhqAnswer[]): PhqResult {
  if (answers.length !== 9) {
    throw new Error('PHQ-9 requires exactly 9 answers')
  }
  const total = answers.reduce<number>((sum, answer) => sum + answer, 0)
  const urgentSupport = answers[8] > 0
  if (total <= 4) {
    return { total, level: 'minimal', label: '当前困扰较少', recommendation: '继续关注自己的睡眠、情绪与日常节奏。', urgentSupport }
  }
  if (total <= 9) {
    return { total, level: 'mild', label: '存在轻度困扰', recommendation: '建议安排休息，并与信任的人聊聊近期状态。', urgentSupport }
  }
  if (total <= 14) {
    return { total, level: 'moderate', label: '存在中度困扰', recommendation: '建议近期联系学校心理中心或专业人员进一步沟通。', urgentSupport }
  }
  if (total <= 19) {
    return { total, level: 'moderately-severe', label: '困扰程度较高', recommendation: '建议尽快联系专业人员，获得进一步支持。', urgentSupport }
  }
  return { total, level: 'severe', label: '困扰程度较高', recommendation: '建议尽快联系专业人员，获得进一步支持。', urgentSupport }
}
