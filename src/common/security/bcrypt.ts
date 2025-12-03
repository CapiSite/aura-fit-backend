import bcrypt from 'bcryptjs'



export async function hashPassword(password: string, pepper = ''): Promise<string> {
  const toHash = `${password}${pepper}`
  return bcrypt.hash(toHash, 16)
}

export async function verifyPassword(password: string, hash: string, pepper = ''): Promise<boolean> {
  if (!hash) return false
  const toVerify = `${password}${pepper}`
  return bcrypt.compare(toVerify, hash)
}
