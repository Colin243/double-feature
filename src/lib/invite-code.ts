export const pendingInviteKey = 'double-feature:pending-invite'

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const codeLength = 8

export function normalizeInviteCode(input: string): string | null {
  const code = input.trim().toUpperCase()
  return code.length === codeLength && [...code].every(char => alphabet.includes(char))
    ? code
    : null
}

export function generateInviteCode(): string {
  // 32 symbols evenly divide the 256 possible byte values.
  const bytes = crypto.getRandomValues(new Uint8Array(codeLength))
  return Array.from(bytes, byte => alphabet[byte % alphabet.length]).join('')
}
