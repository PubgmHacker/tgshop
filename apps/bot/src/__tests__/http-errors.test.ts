import { describe, expect, it } from 'vitest'
import { describeError } from '../lib/httpErrors.js'

describe('HTTP error mapping', () => {
  it('maps malformed JSON to a localized 400 envelope', () => {
    expect(describeError({ code: 'FST_ERR_CTP_INVALID_JSON' }, 'ru')).toEqual({
      status: 400,
      body: {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Часть отправленных данных некорректна.'
        }
      }
    })
  })

  it('maps an oversized body to 413 without exposing parser details', () => {
    expect(describeError({ code: 'FST_ERR_CTP_BODY_TOO_LARGE' }, 'en')).toEqual({
      status: 413,
      body: { error: { code: 'VALIDATION_ERROR', message: 'Some of the submitted data is invalid.' } }
    })
  })
})
