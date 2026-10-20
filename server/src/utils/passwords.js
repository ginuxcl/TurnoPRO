import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { config } from '../config.js';

export async function hashPassword(plain) {
  return bcrypt.hash(plain, config.bcryptRounds);
}

export async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

// Token aleatorio opaco para refresh/invitaciones (se guarda hasheado)
export function newOpaqueToken() {
  return crypto.randomBytes(48).toString('base64url');
}

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function newUuid() {
  return crypto.randomUUID();
}
