import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFound } from './middleware/errors.js';
import { authRouter } from './routes/auth.js';
import { meRouter } from './routes/me.js';
import { staffRouter } from './routes/staff.js';
import { departmentsRouter } from './routes/departments.js';
import { templatesRouter } from './routes/templates.js';
import { schedulesRouter } from './routes/schedules.js';
import { shiftsRouter } from './routes/shifts.js';
import { claimsRouter } from './routes/claims.js';
import { leaveRouter } from './routes/leave.js';
import { availabilityRouter } from './routes/availability.js';
import { dashboardRouter } from './routes/dashboard.js';
import { auditRouter } from './routes/audit.js';
import { swapsRouter } from './routes/swaps.js';
import { notificationsRouter } from './routes/notifications.js';
import { timeclockRouter } from './routes/timeclock.js';
import { reportsRouter } from './routes/reports.js';
import { patternsRouter } from './routes/patterns.js';
import { holidaysRouter } from './routes/holidays.js';
import { preferencesRouter } from './routes/preferences.js';
import { apiKeysRouter, publicApiRouter } from './routes/public.js';
import { assistantRouter } from './routes/assistant.js';
import { commandRouter } from './routes/assistantCommands.js';

const app = express();

app.set('trust proxy', 1);
app.disable('x-powered-by');

// Cabeceras de seguridad
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'"],
      'style-src': ["'self'", "'unsafe-inline'"],
      'img-src': ["'self'", 'data:'],
      'connect-src': ["'self'", ...config.corsOrigins],
      'frame-ancestors': ["'none'"],
    },
  },
  crossOriginResourcePolicy: { policy: 'same-site' },
  referrerPolicy: { policy: 'no-referrer' },
}));

// CORS restringido a orígenes conocidos
app.use(cors({
  origin(origin, cb) {
    if (!origin || config.corsOrigins.includes(origin)) return cb(null, true);
    return cb(new Error('Origen no permitido por CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
}));

app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use(apiLimiter);

const v1 = express.Router();
v1.get('/health', (_req, res) => res.json({ ok: true, service: 'turnos-api' }));
v1.use('/auth', authRouter);
v1.use('/me', meRouter);
v1.use('/staff', staffRouter);
v1.use('/departments', departmentsRouter);
v1.use('/templates', templatesRouter);
v1.use('/schedules', schedulesRouter);
v1.use('/shifts', shiftsRouter);
v1.use('/claims', claimsRouter);
v1.use('/leave', leaveRouter);
v1.use('/availability', availabilityRouter);
v1.use('/dashboard', dashboardRouter);
v1.use('/audit', auditRouter);
v1.use('/swaps', swapsRouter);
v1.use('/notifications', notificationsRouter);
v1.use('/timeclock', timeclockRouter);
v1.use('/reports', reportsRouter);
v1.use('/patterns', patternsRouter);
v1.use('/holidays', holidaysRouter);
v1.use('/preferences', preferencesRouter);
v1.use('/apikeys', apiKeysRouter);
v1.use('/public', publicApiRouter);
v1.use('/assistant', assistantRouter);
v1.use('/assistant', commandRouter);

app.use('/api/v1', v1);
app.use('/api', notFound);
app.use(notFound);
app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`[api] Turnos API escuchando en http://localhost:${config.port} (${config.env})`);
});
