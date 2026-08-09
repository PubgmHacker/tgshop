import pino from 'pino'
import { env } from '../config/env.js'

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { app: '@tgshop/bot' },
  formatters: {
    level(label) {
      return { level: label }
    }
  }
})

export type Logger = typeof logger
