import { afterAll, beforeAll } from 'vitest'
import { connect, disconnect } from './setup.js'

// Second setup file: `load-env.ts` has already populated process.env by the
// time this module (and therefore @tgshop/db) is imported. One connect/disconnect
// per test file keeps the pool from leaking across the run.

beforeAll(async () => {
  await connect()
})

afterAll(async () => {
  await disconnect()
})
