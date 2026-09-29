# **TFM-Ciberseguridad-OpenDrive**

OpenDrive es una plataforma de almacenamiento en la nube (estilo Dropbox) con el foco puesto en la seguridad. Permite a los usuarios guardar, organizar y compartir archivos de forma segura, con cifrado en reposo, control de acceso por roles y auditoría de todas las acciones.

**Desarrollado por:** Daniel Barrio Domínguez.

# Arquitectura del Sistema

- **Frontend (Vue.js):** Interfaz de usuario que consume la API (repositorio independiente).
- **Backend (Node.js + Express):** API REST con autenticación JWT, protección CSRF y control de roles (`superadmin`, `admin`, `soporte`, `usuario`).
- **Persistencia:** PostgreSQL para usuarios, permisos y logs; MinIO para los archivos, cifrados con AES-256-GCM antes de guardarse.

# Tecnologías Utilizadas

- **Backend:** Node.js, Express, JWT, bcrypt, multer, Helmet.
- **Base de datos:** PostgreSQL.
- **Almacenamiento:** MinIO.
- **Despliegue:** Docker y OpenShift.

# Instalación

*1. Base de datos*

```
psql -d opendrive -f Esquema-bd.sql
```

*2. Variables de entorno*

Definir `JWT_SECRET`, `FILE_ENCRYPTION_KEY`, `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `MINIO_ENDPOINT`, `MINIO_PORT`, `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `MINIO_BUCKET` y `FRONTEND_URL`. El servidor no arranca si falta alguna obligatoria.

*3. Arranque*

```
npm install
npm start
```

También puede desplegarse en OpenShift mediante el `Dockerfile` incluido (estrategia Docker).

# Uso

- Registrarse desde el frontend; los usuarios nuevos tienen el rol `usuario` y 20 MB de cuota.
- Subir, descargar y organizar archivos en carpetas personales o en bóvedas compartidas con permisos por miembro.
- Para crear el primer administrador, elevar el rol directamente en la base de datos:

```
UPDATE usuarios SET rol_id = (SELECT id FROM roles WHERE nombre = 'superadmin') WHERE username = 'tu_usuario';
```

# Limitaciones y Seguridad

- **Clave de cifrado:** Si se pierde `FILE_ENCRYPTION_KEY`, los archivos ya subidos no podrán descifrarse.
- **Cifrado en tránsito:** La conexión con MinIO se realiza sin TLS; el cifrado HTTPS depende del router de OpenShift.
- **Sesiones:** Los JWT caducan a las 2 horas y el login está limitado a 10 intentos cada 15 minutos por IP.

---

***Nota:** Este proyecto ha sido desarrollado como Trabajo de Fin de Máster para Campus Cámara Sevilla.*
