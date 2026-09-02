// The receive-address helpers moved to @tgshop/core so the worker shares them;
// this re-export keeps the bot's existing import paths (and their tests) intact.
export { TRON_ADDRESS_RE, isTronAddress, resolveTronReceiveAddress, type TronReceiveEnv } from '@tgshop/core'
