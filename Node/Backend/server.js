const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// ── Validación de variables de entorno críticas al arranque ─────────────────
// Si alguna falta, el servidor termina antes de escuchar peticiones.
const REQUIRED_ENV = [
  'JWT_SECRET',
  'FILE_ENCRYPTION_KEY',
  'DB_HOST',
  'DB_NAME',
  'DB_USER',
  'DB_PASSWORD',
  'MINIO_ENDPOINT',
  'MINIO_ROOT_USER',
  'MINIO_ROOT_PASSWORD',
  'MINIO_BUCKET',
];

const missingEnv = REQUIRED_ENV.filter(key => !process.env[key]);
if (missingEnv.length > 0) {
  console.error('[FATAL] Variables de entorno requeridas no definidas:', missingEnv.join(', '));
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 8080;

// OpenShift enruta el tráfico a través de HAProxy que añade X-Forwarded-For.
// Sin esto express-rate-limit lanza ERR_ERL_UNEXPECTED_X_FORWARDED_FOR
// y rechaza todas las peticiones. El valor 1 indica un único proxy de confianza.
app.set('trust proxy', 1);

// ── Helmet: cabeceras de seguridad HTTP ─────────────────────────────────────
// Añade X-Content-Type-Options, X-Frame-Options, HSTS, etc.
app.use(helmet({
  // CSP básico: ajusta connect-src si añades más orígenes externos
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"], // unsafe-inline necesario para algunos frameworks CSS
      imgSrc: ["'self'", "data:"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false, // Puede romper assets en OpenShift; ajusta según necesidad
}));

// ── CORS: solo el frontend propio puede llamar a la API ─────────────────────
app.use(cors({
  origin: process.env.FRONTEND_URL || 'https://frontend-opendrive.apps-crc.testing',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'], // <-- exponer el header CSRF
  credentials: true, // necesario si en el futuro se usan cookies HttpOnly
}));

app.use(express.json());

// ── Rate limiting global ─────────────────────────────────────────────────────
// Protección base para todas las rutas: 200 req / 15 min por IP
const limiterGlobal = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones, intenta más tarde' },
});
app.use(limiterGlobal);

// ── Rate limiting estricto para autenticación ────────────────────────────────
// 10 intentos de login / 15 min por IP → protege contra fuerza bruta
const limiterAuth = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de autenticación, espera 15 minutos' },
  skipSuccessfulRequests: true, // no cuenta los logins correctos
});

// ── Rate limiting para registro ──────────────────────────────────────────────
// 5 registros / hora por IP → evita creación masiva de cuentas
const limiterRegister = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados registros desde esta IP, espera una hora' },
});

// ── Rutas ────────────────────────────────────────────────────────────────────
const authRoutes     = require('./routes/auth');
const adminRoutes    = require('./routes/admin');
const archivosRoutes = require('./routes/archivos');
const logsRoutes     = require('./routes/logs');
const bovedaRoutes   = require('./routes/bovedas');
const carpetasRoutes = require('./routes/carpetas');

// Aplicar limiters específicos ANTES de montar las rutas
app.use('/auth/login',    limiterAuth);
app.use('/auth/register', limiterRegister);

app.use('/bovedas',   bovedaRoutes);
app.use('/logs',      logsRoutes);
app.use('/auth',      authRoutes);
app.use('/admin',     adminRoutes);
app.use('/archivos',  archivosRoutes);
app.use('/carpetas',  carpetasRoutes);

// ── Healthcheck público ──────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'OpenDrive backend funcionando' });
});

// ── db-health protegido: solo accesible con JWT válido ───────────────────────
const { verificarToken } = require('./middleware/auth');
app.get('/db-health', verificarToken, async (req, res) => {
  const pool = require('./db');
  try {
    // Solo confirmamos conectividad, sin exponer versión ni timestamps del servidor
    await pool.query('SELECT 1');
    res.json({ status: 'OK' });
  } catch (err) {
    // No exponemos el mensaje de error de PostgreSQL al cliente
    console.error('[db-health] Error de conexión:', err.message);
    res.status(500).json({ status: 'ERROR', message: 'Error de conexión a la base de datos' });
  }
});

app.get('/', (req, res) => {
  res.json({ message: 'Bienvenido a OpenDrive API' });
});

// ── Arranque ─────────────────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);

  try {
    const { minioClient, BUCKET } = require('./minio');
    const exists = await minioClient.bucketExists(BUCKET);
    if (!exists) {
      await minioClient.makeBucket(BUCKET);
      console.log(`Bucket '${BUCKET}' creado correctamente`);
    } else {
      console.log(`Bucket '${BUCKET}' ya existe`);
    }
  } catch (err) {
    console.error('Error al verificar/crear bucket de MinIO:', err.message);
  }
});