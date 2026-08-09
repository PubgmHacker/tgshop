import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// ─────────────────────────────────────────────────────────────────────────────
// Loads the repo-root .env into process.env.
//
// This module deliberately imports NOTHING from the workspace: it runs as the
// first vitest setup file, before @tgshop/db is ever imported, because that
// package constructs a PrismaClient at module load and needs DATABASE_URL to
// already be present.
//
// Semantics match dotenv: a variable the shell already exported WINS. The
// documented way to run this suite is `set -a && . ./.env && set +a`, and that
// must stay authoritative — otherwise pointing the tests at a scratch database
// via the environment would be silently overridden by the file on disk.
// ─────────────────────────────────────────────────────────────────────────────

const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Parses .env text into key/value pairs. Supports `export`, comments and quoted values. */
export function parseEnvFile(contents: string): Map<string, string> {
  const out = new Map<string, string>()

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue

    const withoutExport = line.startsWith('export ') ? line.slice('export '.length).trim() : line
    const eq = withoutExport.indexOf('=')
    if (eq <= 0) continue

    const key = withoutExport.slice(0, eq).trim()
    if (!KEY_PATTERN.test(key)) continue

    let value = withoutExport.slice(eq + 1).trim()

    const quote = value[0]
    if ((quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote)) {
      value = value.slice(1, -1)
      // Only double quotes carry escape sequences, same as a POSIX shell.
      if (quote === '"') {
        value = value.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
      }
    } else {
      // An unquoted value ends at the first whitespace-preceded '#'. A '#'
      // glued to the value (as in a URL fragment) is part of the value.
      value = value.replace(/\s+#.*$/, '').trim()
    }

    out.set(key, value)
  }

  return out
}

/** Absolute path of the repo-root .env, resolved from this file's location. */
export function repoRootEnvPath(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  return resolve(here, '../..', '.env')
}

/** Copies the repo-root .env into process.env without clobbering existing vars. */
export function loadRepoEnv(): void {
  const envPath = repoRootEnvPath()
  if (!existsSync(envPath)) {
    throw new Error(
      `@tgshop/e2e: no .env found at ${envPath}. These tests need a real DATABASE_URL and ENCRYPTION_KEY.`
    )
  }

  for (const [key, value] of parseEnvFile(readFileSync(envPath, 'utf8'))) {
    if (process.env[key] === undefined) process.env[key] = value
  }

  for (const required of ['DATABASE_URL', 'ENCRYPTION_KEY'] as const) {
    if (!process.env[required]) {
      throw new Error(`@tgshop/e2e: ${required} is not set (looked in the environment and ${envPath})`)
    }
  }
}

loadRepoEnv()
