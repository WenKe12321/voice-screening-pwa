import { describe, expect, it } from 'vitest'
import { scorePhq9 } from '../src/domain/phq9'
import type { PhqAnswer } from '../src/domain/types'

describe('scorePhq9', () => {
  it.each([
    [0, 'minimal'],
    [5, 'mild'],
    [10, 'moderate'],
    [15, 'moderately-severe'],
    [20, 'severe'],
  ])('maps score %i to %s', (score, level) => {
    const answers = Array(9).fill(0) as PhqAnswer[]
    let remaining = score
    for (let index = 0; index < answers.length && remaining; index += 1) {
      answers[index] = Math.min(3, remaining) as PhqAnswer
      remaining -= answers[index]
    }
    expect(scorePhq9(answers).level).toBe(level)
  })

  it('always shows urgent support when question 9 is non-zero', () => {
    expect(scorePhq9([0, 0, 0, 0, 0, 0, 0, 0, 1]).urgentSupport).toBe(true)
  })

  it('rejects incomplete responses', () => {
    expect(() => scorePhq9([0, 0] as PhqAnswer[])).toThrow()
  })
})
