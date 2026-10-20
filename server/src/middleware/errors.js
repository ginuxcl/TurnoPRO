// Middleware de errores + wrapper async

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const asyncH = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

export function notFound(req, res) {
  res.status(404).json({ error: 'Recurso no encontrado' });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) {
    const body = { error: err.message, code: err.code };
    if (err.violations) body.violations = err.violations;
    return res.status(err.status).json(body);
  }
  // Errores de validación (zod) → 400 con el primer mensaje útil
  if (err?.issues && Array.isArray(err.issues)) {
    return res.status(400).json({ error: err.issues[0]?.message || 'Datos inválidos', code: 'VALIDATION' });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON inválido' });
  }
  console.error('[api] error:', err.stack || err.message);
  // No filtrar detalles internos al cliente
  return res.status(500).json({ error: 'Error interno del servidor' });
}
