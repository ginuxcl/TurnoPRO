import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, org: user.org_id, role: user.role },
    config.jwtSecret,
    { expiresIn: config.accessTokenTtl, issuer: 'turnos-api' }
  );
}

export function verifyAccessToken(token) {
  return jwt.verify(token, config.jwtSecret, { issuer: 'turnos-api' });
}
