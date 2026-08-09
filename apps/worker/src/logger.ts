import pino from 'pino'
import { loadEnv } from './env.js'

const env = loadEnv()

export const logger = pino({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  base: { app: 'tgshop-worker' },
  timestamp: pino.stdTimeFunctions.isoTime
})

export type Logger = typeof logger

/** Creates a child logger scoped to a job for correlation-id tracing. */
export function jobLogger(queue: string, jobId: string | undefined, correlationId: string): Logger {
  return logger.child({ queue, jobId, correlationId })
}
