import rateLimit from 'express-rate-limit';

const json = (message) => (_req, res) => res.status(429).json({ error: message });

// Límite general para la API
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: json('Demasiadas peticiones, inténtalo de nuevo en un minuto'),
});

// Login más estricto (anti fuerza bruta, combinado con bloqueo de cuenta)
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 15,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `${req.ip}:${(req.body?.email || '').toLowerCase()}`,
  message: json('Demasiados intentos de inicio de sesión. Espera 15 minutos.'),
});

export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: json('Demasiados registros desde esta IP'),
});
