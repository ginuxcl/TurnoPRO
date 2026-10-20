# TurnoPro — Sistema de gestión de turnos

Plataforma de planificación de turnos para equipos (hostelería, retail, salud…) inspirada en
[RosterLab](https://rosterlab.com/), [EnSaturno](https://ensaturno.com/), [Turnyon](https://turnyon.com/)
y [Factorial](https://factorial.com/cl/gestion-turnos). Multi-organización, con planificador semanal
drag & drop, fichaje con control horario, reportes con costes, patrones de rotación, autoservicio del
empleado, turnos abiertos reclamables, ausencias con aprobación, API de integraciones y registro de
auditoría — **con seguridad de primera línea (anti-IDOR/BOLA)**.

## Stack

| Capa     | Tecnología |
|----------|------------|
| Frontend | React 18 + Vite + React Router (SPA en español, diseño propio) |
| Backend  | Node 20 + Express 4, validación con Zod |
| Base de datos | **PostgreSQL 16** (Docker), queries parametrizadas con `pg` |
| Auth     | JWT de acceso (15 min) + refresh token rotatorio en cookie `httpOnly` |

## Arranque rápido

```bash
# 1. Base de datos (puerto 5433 para no chocar con otro Postgres local)
docker compose up -d

# 2. Dependencias
npm run setup

# 3. Esquema + datos demo
npm run db:migrate
npm run db:seed

# 4. Todo en marcha (API :4000 + web :5173)
npm run dev
```

Abre **http://localhost:5173** — o pulsa «Explorar la demo en vivo» en la landing.

### Cuentas demo (`La Terraza Gastrobar`)

| Rol        | Email              | Contraseña   |
|------------|--------------------|--------------|
| Propietaria| `demo@turnos.app`  | `Demo12345!` |
| Empleada   | `ana@turnos.app`   | `Demo12345!` |

> La base de datos se puede recrear limpia en cualquier momento: `npm run db:reset`

## Funcionalidades

- **Planificador semanal** — calendario de 7 días con bloques de turno posicionados por hora,
  carriles side-by-side para solapados, soporte de turnos que cruzan medianoche, drag & drop
  para mover turnos de día, clic en hueco para crear, filtros por departamento/persona.
- **Vista mensual** — rejilla mensual compacta con chips por turno, ausencias marcadas y
  creación de turnos con un clic en cualquier día.
- **⚡ Autocompletado inteligente** — asigna los turnos abiertos de la semana con un algoritmo
  voraz que reparte la carga según el contrato de cada persona, respetando ausencias,
  disponibilidad y reglas.
- **Publicación de horarios** — borrador → publicado (avisa a todo el equipo); copiar semana
  anterior a la siguiente; informe de avisos de ausencias y de incumplimiento de reglas al publicar.
- **Turnos abiertos** — publica huecos que el equipo puede reclamar; el gestor aprueba y el
  turno se reasigna (el resto de solicitudes se rechazan en cascada).
- **Cambios de turno entre personas** — un empleado propone ceder su turno a un compañero;
  el compañero acepta, el gestor aprueba (con validación de reglas del receptor) y el turno se
  reasigna. Todo con notificaciones.
- **Reglas de planificación** configurables por organización — máx. turnos/día, descanso mínimo
  entre turnos, máx. días consecutivos y tope de horas semanales. Se validan al asignar (con
  opción de forzar por el gestor), al aprobar cambios y al publicar.
- **Ausencias** — vacaciones/baja/personal con flujo aprobar-rechazar; al aprobar, los turnos
  del periodo se liberan automáticamente.
- **Notificaciones in-app** — campana con contador, panel de novedades y enlaces directos
  (publicaciones, reclamaciones, cambios, ausencias).
- **Equipo** — altas con contraseña generada, roles (propietario/gestor/empleado), horas
  semanales, departamentos con color, desactivación sin perder historial.
- **Autoservicio empleado** — mis turnos, disponibilidad semanal, reclamaciones, proponer
  cambios, solicitudes de ausencia.
- **Panel** — horas de la semana, cobertura, turnos de hoy, pendientes por revisar y **fichaje con un clic**.
- **✨ Comandos del cuadrante (estilo Deputy)** — barra de comandos sobre el planificador: «extiende los turnos de cocina del viernes una hora y pon nota refuerzo», «busca sustituto para Lucía esta semana», «Ana no está disponible los lunes hasta el 2026-12-31», «¿quién está trabajando ahora?», «¿está listo para la nómina?». Los cambios se proponen en una **vista previa revisable** (checkbox por cambio) y solo se aplican al confirmar, revalidándose contra reglas, solapes y ausencias.
- **💰 Coste en vivo y prioridades de autocompletado** — la barra del planificador muestra el coste estimado de la semana visible antes de publicar, y el autocompletado admite tres prioridades: equidad de carga, menor coste (valor hora) o repetir el patrón de las últimas 4 semanas.
- **👀 Proacción** — el panel avisa con antelación de huecos de la semana que viene y de personas que superarían su jornada.
- **🗂 Cuadrante tipo hoja de cálculo** — tercera vista del planificador (personas × días) con totales semanales por persona, fila de turnos abiertos y creación de turnos con un clic en cualquier celda.
- **🤖 Asistente** — chat en español que responde preguntas sobre el cuadrante: «¿quién trabaja mañana?», «¿quién está libre el viernes?», «turnos abiertos», «horas de Ana», «coste de esta semana», «ausencias pendientes». Respeta roles: cada empleado solo ve lo suyo.
- **Vista previa de cobertura al aprobar ausencias** — antes de confirmar, muestra los turnos que se liberarán, cuánta gente quedaría cada día en los departamentos afectados y avisa de riesgos de descobertura.
- **PWA instalable** — manifest + service worker (shell cache-first, API siempre en red); instalable desde el navegador en escritorio y móvil.
- **⏱ Fichaje y control horario** — entrada/salida con un clic (cronómetro en vivo); panel de marcaje
  para el gestor que compara lo planificado con lo fichado (retrasos, salidas anticipadas, horas extra,
  umbral de 5 min); fichajes manuales de corrección con nota y auditoría.
- **📊 Reportes y costes** — horas planificadas vs. fichadas por persona y departamento, desviaciones
  y coste estimado con el **valor hora** de cada empleado; **exportación Excel profesional** (2 hojas:
  cuadrante con color por departamento + resumen por persona con totales).
- **🔁 Patrones de semana** — plantillas de rotación (5x2, 7x7, finde reforzado…) creadas en Ajustes y
  aplicadas a cualquier semana desde Planificar en un clic; omiten duplicados y respetan las reglas.
- **🎉 Festivos** — calendario de festivos de la organización, visibles en las vistas semanal y mensual.
- **Preferencias del empleado** — días bloqueados (médico, estudios…) que el autocompletado nunca
  asigna, con aviso en el modal de turnos para el gestor.
- **🔌 API para integraciones** — claves de API por organización (se muestran una sola vez, revocables)
  para consultar turnos publicados y plantilla en solo lectura: `GET /api/v1/public/v1/shifts`,
  `GET /api/v1/public/v1/employees` con cabecera `X-API-Key`.
- **Auditoría** — cada acción sensible con actor, entidad, IP y fecha.

## Seguridad (lo importante)

Verificada con una suite automatizada: `npm run test:security` — **126 comprobaciones, todas en verde**
(ejecútala con la base de datos recién reseteada: `npm run db:reset` y la API reiniciada).

| Amenaza | Mitigación |
|---------|-----------|
| **IDOR / BOLA** | Todo acceso por id va acotado a `org_id` del token (`fetchScoped`). Objeto de otra organización → **404**, no 403 (sin filtrar existencia). IDs UUID no secuenciales. |
| **Escalada de privilegios** | RBAC en servidor (`requireRole`): solo gestores crean/editan turnos y personal; nadie puede asignar el rol `owner`; el propietario es intocable. |
| **Sesiones** | Access token 15 min en memoria (nunca localStorage). Refresh rotatorio en cookie `httpOnly SameSite=Strict`; **detección de reuso** → revoca toda la familia de tokens. Cambio de contraseña → revoca sesiones. |
| **Fuerza bruta** | Bloqueo de cuenta tras 5 fallos (15 min) + rate limit por IP+email en login/registro. Respuestas uniformes (no se filtra si el email existe) y tiempo constante. |
| **Inyección SQL** | 100% queries parametrizadas; fechas/horas validadas por regex antes de tocar la BD. |
| **XSS / cabeceras** | Helmet con CSP estricta, `X-Content-Type-Options`, `frame-ancestors 'none'`, React escapa por defecto; body limit 100 kB. |
| **Validación** | Esquemas Zod en cada endpoint (tipos, rangos, longitudes); solapes de turno detectados también entre días adyacentes; reglas de negocio por organización. |
| **API pública** | Autenticación por clave (`X-API-Key`, hash SHA-256 en BD, se muestra una sola vez, revocable). Solo lectura, solo turnos publicados, acotada a la organización de la clave, sin emails. |
| **Trazabilidad** | `audit_logs` con actor, acción, entidad, detalles JSONB e IP en cada mutación. |

> **126 comprobaciones automáticas** cubren autenticación, RBAC, aislamiento por organización
> (turnos, personal, auditoría, swaps, notificaciones, patrones, fichajes, API pública),
> inyección, rotación de refresh tokens, bloqueo por fuerza bruta, reglas/autocompletado
> y cabeceras de seguridad.

## Estructura

```
turnos/
├── docker-compose.yml        # PostgreSQL 16 (puerto host 5433)
├── dev.mjs                   # arranca API + web juntos
├── server/
│   ├── src/
│   │   ├── schema.sql        # DDL completo
│   │   ├── seed.js           # demo idempotente
│   │   ├── middleware/       # auth JWT, RBAC, scope anti-IDOR, rate limit, audit
│   │   ├── routes/           # auth, me, staff, departments, templates, schedules,
│   │   │                     # shifts, claims, leave, availability, dashboard, audit,
│   │   │                     # swaps, notifications, timeclock, reports, patterns, assistant,
│   │   │                     # holidays, preferences, public (API con X-API-Key), assistantCommands
│   │   └── utils/            # bcrypt, tokens, fechas (sin pitfalls de TZ), reglas
│   ├── scripts/security-test.mjs  # 126 comprobaciones
│   ├── scripts/reset.mjs          # npm run db:reset
│   └── .env                  # secretos locales (no se sube a git)
└── client/
    └── src/
        ├── components/       # Layout, Calendar (drag&drop, festivos), ShiftModal
        ├── pages/            # Landing, Login, Register, Dashboard (fichar), Schedule,
        │                     # MyShifts, Requests, Staff, Availability (días bloqueados),
        │                     # Timeclock (marcaje), Reports (costes + Excel), Assistant, Settings, Audit
        ├── api.js            # fetch con refresh automático + descarga autenticada
        └── styles.css        # sistema de diseño propio
```

## Notas de diseño

- **Fechas naive locales**: las fechas viajan como `YYYY-MM-DD` y las horas como `HH:MM`;
  el driver de PG está configurado para devolver DATE/TIME como texto — cero desfases de zona.
- **Multi-tenant por `org_id`** en todas las tablas de dominio, con borrado en cascada.
- Los empleados solo ven horarios **publicados**; los borradores son privados de gestión.
- Desactivar personal es un soft-delete: el historial de turnos queda íntegro para auditoría.
