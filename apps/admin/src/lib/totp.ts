import { authenticator } from 'otplib'

/** Verifies a 6-digit TOTP code against a base32 secret, with the standard ±1 step window. */
export function verifyTotp(secret: string, code: string): boolean {
  try {
    return authenticator.verify({ token: code, secret })
  } catch {
    return false
  }
}

/** Generates a new base32 TOTP secret for provisioning a fresh AdminUser 2FA setup. */
export function generateTotpSecret(): string {
  return authenticator.generateSecret()
}

/** Builds an otpauth:// URI suitable for rendering as a QR code during 2FA setup. */
export function totpKeyUri(email: string, secret: string, issuer = 'tgshop-admin'): string {
  return authenticator.keyuri(email, issuer, secret)
}
