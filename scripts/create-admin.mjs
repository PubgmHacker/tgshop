// create-admin.mjs — provisions an AdminUser with a REAL bcrypt hash.
//
// This is the only way to get into the admin panel. Everything else is a dead
// end by design:
//
//   • the database seed creates no admin credentials;
//   • the panel has no "manage admins" page, so an existing admin cannot mint
//     the first one;
//   • telegramLoginAction() requires an AdminUser row whose email is already
//     `tg:<telegram_id>` and deliberately never creates admins.
//
// Cost factor 12 matches nothing in particular — apps/admin only ever calls
// compare(), which reads the cost out of the hash itself, so this can be raised
// later without invalidating existing hashes.
//
// Usage:
//   node scripts/create-admin.mjs --email you@example.com --role OWNER
//   node scripts/create-admin.mjs --email you@example.com --password '...' --role OWNER
//   node scripts/create-admin.mjs --telegram-id 123456789 --role OWNER
//   node scripts/create-admin.mjs --delete <email>
//
// With no --password the script generates a strong one and prints it once.
// Re-running for an existing email resets that account's password (and role, if
// given) rather than failing, which is also the documented recovery path for a
// locked-out owner.
import { randomBytes } from 'node:crypto'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { prisma, AdminRole } from '../packages/db/dist/index.js'
// bcryptjs lives in apps/admin (the only app that authenticates), and scripts/
// sits outside every workspace's node_modules — hence the explicit path, the
// same reason the verify-* scripts import through dist/.
import bcrypt from '../apps/admin/node_modules/bcryptjs/index.js'

const BCRYPT_COST = 12
const MIN_PASSWORD_LENGTH = 8 // matches loginSchema in apps/admin/src/lib/schemas.ts

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) continue
    const key = arg.slice(2)
    const next = argv[i + 1]
    // A value is consumed only if it does not look like another flag, so
    // `--password --weird` parses as a flag rather than a password value.
    if (next === undefined || next.startsWith('--')) {
      args[key] = true
    } else {
      args[key] = next
      i++
    }
  }
  return args
}

function usage(message) {
  if (message) console.error(`error: ${message}\n`)
  console.error(`Usage:
  node scripts/create-admin.mjs --email <email> [--password <password>] [--role OWNER|ADMIN|SUPPORT]
  node scripts/create-admin.mjs --telegram-id <id> [--role OWNER|ADMIN|SUPPORT]
  node scripts/create-admin.mjs --delete <email> [--force]

Options:
  --email        Login email for password-based sign-in.
  --telegram-id  Numeric Telegram user id; provisions the "tg:<id>" account the
                 Telegram Login Widget looks for. Mutually exclusive with --email.
  --password     Password to set. Omit to have one generated and printed once.
                 Prefer omitting it: a password on the command line lands in
                 your shell history.
  --role         Defaults to OWNER, the only role that can manage other admins.
  --force        Overwrite (or delete) an existing account without the prompt.
  --delete       Remove the named account. Refuses
                 to remove the last remaining OWNER.

Requires DATABASE_URL (set -a; source .env; set +a) and a prior 'pnpm build'.`)
  process.exit(1)
}

/**
 * 24 bytes of base64url — ~143 bits of entropy, well past anything bcrypt's
 * 72-byte input limit or an online attacker would trouble.
 */
function generatePassword() {
  return randomBytes(24).toString('base64url')
}

async function confirm(question) {
  const rl = createInterface({ input: stdin, output: stdout })
  try {
    const answer = await rl.question(`${question} [y/N] `)
    return answer.trim().toLowerCase() === 'y'
  } finally {
    rl.close()
  }
}

const args = parseArgs(process.argv.slice(2))

if (args.help || args.h) usage()

// ── --delete: remove an explicitly named admin ──────────────────────────────
if (args.delete !== undefined) {
  if (args.delete === true) usage('--delete needs the email of the account to remove')
  const target = String(args.delete).trim().toLowerCase()
  const victim = await prisma.adminUser.findUnique({ where: { email: target } })
  if (!victim) {
    console.error(`error: no admin with email ${target}`)
    await prisma.$disconnect()
    process.exit(1)
  }

  // Deleting the last OWNER locks everyone out permanently: no page mints
  // admins, so recovery would mean running this script again with DB access.
  // Better to refuse than to hand someone a working foot-gun.
  if (victim.role === AdminRole.OWNER) {
    const owners = await prisma.adminUser.count({ where: { role: AdminRole.OWNER } })
    if (owners <= 1) {
      console.error(
        `error: ${target} is the only OWNER — create a replacement first, ` +
          'or the panel becomes unreachable'
      )
      await prisma.$disconnect()
      process.exit(1)
    }
  }

  if (!args.force && !(await confirm(`Delete admin ${target} (role ${victim.role})?`))) {
    console.log('aborted, nothing was changed')
    await prisma.$disconnect()
    process.exit(1)
  }

  await prisma.adminUser.delete({ where: { email: target } })
  console.log(`deleted admin ${target}`)
  await prisma.$disconnect()
  process.exit(0)
}

if (args.email && args['telegram-id']) usage('pass either --email or --telegram-id, not both')
if (!args.email && !args['telegram-id']) usage('one of --email or --telegram-id is required')

let email
if (args['telegram-id']) {
  const id = String(args['telegram-id'])
  if (!/^\d+$/.test(id)) usage('--telegram-id must be a positive integer')
  // The exact convention telegramLoginAction() looks up. Getting this wrong
  // produces an account that exists but can never sign in.
  email = `tg:${id}`
} else {
  email = String(args.email).trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) usage(`"${email}" is not a valid email address`)
}

const role = String(args.role ?? AdminRole.OWNER).toUpperCase()
if (!Object.values(AdminRole).includes(role)) {
  usage(`--role must be one of ${Object.values(AdminRole).join(', ')}`)
}

const generated = args.password === undefined
const password = generated ? generatePassword() : String(args.password)
if (password.length < MIN_PASSWORD_LENGTH) {
  usage(`password must be at least ${MIN_PASSWORD_LENGTH} characters (the admin login schema rejects shorter ones)`)
}

const existing = await prisma.adminUser.findUnique({ where: { email } })
if (existing && !args.force) {
  const ok = await confirm(
    `${email} already exists (role ${existing.role}). Reset its password${
      existing.role === role ? '' : ` and change the role to ${role}`
    }?`
  )
  if (!ok) {
    console.log('aborted, nothing was changed')
    await prisma.$disconnect()
    process.exit(1)
  }
}

const passwordHash = await bcrypt.hash(password, BCRYPT_COST)

// Verify before writing: a hash that does not round-trip would lock the panel
// and the failure would only surface at the login screen.
if (!(await bcrypt.compare(password, passwordHash))) {
  console.error('error: generated hash failed its own verification, refusing to write')
  await prisma.$disconnect()
  process.exit(1)
}

const admin = await prisma.adminUser.upsert({
  where: { email },
  update: { passwordHash, role },
  create: { email, passwordHash, role }
})

console.log(`${existing ? 'updated' : 'created'} admin ${admin.email} (role ${admin.role}, id ${admin.id})`)
if (args['telegram-id']) {
  console.log('sign in with the Telegram Login Widget on the panel\'s login page.')
  if (generated) {
    // The row needs SOME hash; password login on a tg: account is a fallback
    // nobody should need, so the generated one is deliberately not printed.
    console.log('a random password was set as well, and is intentionally not shown.')
  }
} else if (generated) {
  console.log(`\n  password: ${password}\n`)
  console.log('this is shown once and is not stored anywhere in plaintext — save it now.')
}

await prisma.$disconnect()
