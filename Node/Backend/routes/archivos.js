const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const pool = require('../db');
const { minioClient, BUCKET } = require('../minio');
const { verificarToken, verificarCsrf } = require('../middleware/auth');
const { logUser } = require('../logger');
const { encrypt, decrypt, streamToBuffer } = require('../crypto');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } }); // límite 100 MB

// ── GET — solo lectura, sin CSRF ─────────────────────────────────────────────

// Lista archivos personales (no en bóvedas)
router.get('/lista', verificarToken, async (req, res) => {
  const { carpeta_id } = req.query;
  try {
    const result = await pool.query(
      `SELECT id, nombre, tipo, tamanio_bytes, creado_en
       FROM archivos
       WHERE propietario_id = $1
         AND eliminado = false
         AND boveda_id IS NULL
         AND carpeta_id IS NOT DISTINCT FROM $2
       ORDER BY creado_en DESC`,
      [req.user.id, carpeta_id || null]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Espacio de almacenamiento del usuario
router.get('/espacio', verificarToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT cuota_maxima_bytes, espacio_usado_bytes
       FROM usuario_almacen WHERE usuario_id = $1`,
      [req.user.id]
    );
    if (result.rows.length === 0) {
      return res.json({ cuota_maxima_bytes: 0, espacio_usado_bytes: 0 });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Notificaciones de almacenamiento (aviso cuando se acerca el límite)
router.get('/notificaciones', verificarToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT cuota_maxima_bytes, espacio_usado_bytes
       FROM usuario_almacen WHERE usuario_id = $1`,
      [req.user.id]
    );
    const notificaciones = [];
    if (result.rows.length > 0) {
      const { cuota_maxima_bytes, espacio_usado_bytes } = result.rows[0];
      const porcentaje = cuota_maxima_bytes > 0
        ? (espacio_usado_bytes / cuota_maxima_bytes) * 100
        : 0;
      if (porcentaje >= 90) {
        notificaciones.push({
          tipo: 'error',
          mensaje: `⚠️ Has usado el ${porcentaje.toFixed(0)}% de tu almacenamiento. Libera espacio pronto.`
        });
      } else if (porcentaje >= 75) {
        notificaciones.push({
          tipo: 'warning',
          mensaje: `Estás usando el ${porcentaje.toFixed(0)}% de tu almacenamiento.`
        });
      }
    }
    res.json(notificaciones);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Archivos en papelera (eliminados lógicamente, sin bóveda)
router.get('/papelera', verificarToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, nombre, tipo, tamanio_bytes, creado_en
       FROM archivos
       WHERE propietario_id = $1
         AND eliminado = true
         AND boveda_id IS NULL
       ORDER BY creado_en DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Descarga de un archivo personal
router.get('/descargar/:id', verificarToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM archivos
       WHERE id = $1 AND propietario_id = $2 AND eliminado = false AND boveda_id IS NULL`,
      [req.params.id, req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }
    const archivo = result.rows[0];
    const stream = await minioClient.getObject(BUCKET, archivo.nombre_objeto);
    const encryptedBuffer = await streamToBuffer(stream);
    const decryptedBuffer = decrypt(encryptedBuffer);

    res.setHeader('Content-Disposition', `attachment; filename="${archivo.nombre}"`);
    res.setHeader('Content-Type', archivo.tipo);
    res.setHeader('Content-Length', decryptedBuffer.length);
    await logUser(req.user.id, 'DESCARGAR_ARCHIVO', `Archivo: ${archivo.nombre}`, req.ip);
    res.send(decryptedBuffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST mutantes — requieren CSRF ────────────────────────────────────────────

// Subir archivo personal
router.post('/subir', verificarToken, upload.single('archivo'), verificarCsrf, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se ha enviado ningún archivo' });

  const { originalname, mimetype, buffer, size } = req.file;
  const carpeta_id = req.body.carpeta_id || null;

  // Sanitizar nombre
  const nombreSeguro = path.basename(originalname).replace(/[^a-zA-Z0-9._\- ]/g, '_');
  const nombreObjeto = `personal/${req.user.id}/${Date.now()}-${nombreSeguro}`;

  try {
    // Comprobar cuota
    const cuota = await pool.query(
      `SELECT almacen_id, cuota_maxima_bytes, espacio_usado_bytes
       FROM usuario_almacen WHERE usuario_id = $1`,
      [req.user.id]
    );
    if (cuota.rows.length === 0) {
      return res.status(403).json({ error: 'No tienes almacén personal asignado' });
    }
    const { almacen_id, cuota_maxima_bytes, espacio_usado_bytes } = cuota.rows[0];
    const libre = parseInt(cuota_maxima_bytes) - parseInt(espacio_usado_bytes);
    if (size > libre) {
      return res.status(400).json({
        error: `No tienes suficiente espacio libre. Disponible: ${(libre / 1048576).toFixed(2)} MB`
      });
    }

    // Validar carpeta si se indica
    if (carpeta_id) {
      const carpeta = await pool.query(
        `SELECT id FROM carpetas WHERE id = $1 AND creador_id = $2 AND boveda_id IS NULL`,
        [carpeta_id, req.user.id]
      );
      if (carpeta.rows.length === 0) {
        return res.status(404).json({ error: 'Carpeta no encontrada' });
      }
    }

    const encryptedBuffer = encrypt(buffer);
    await minioClient.putObject(BUCKET, nombreObjeto, encryptedBuffer, encryptedBuffer.length, {
      'Content-Type': 'application/octet-stream'
    });

    const result = await pool.query(
      `INSERT INTO archivos (nombre, nombre_objeto, tipo, tamanio_bytes, propietario_id, carpeta_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, nombre, tipo, tamanio_bytes, creado_en`,
      [nombreSeguro, nombreObjeto, mimetype, size, req.user.id, carpeta_id]
    );

    await pool.query(
      `UPDATE usuario_almacen SET espacio_usado_bytes = espacio_usado_bytes + $1
       WHERE usuario_id = $2 AND almacen_id = $3`,
      [size, req.user.id, almacen_id]
    );

    await logUser(req.user.id, 'SUBIR_ARCHIVO', `Archivo: ${nombreSeguro}`, req.ip);
    res.status(201).json({ message: 'Archivo subido', archivo: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH mutantes — requieren CSRF ───────────────────────────────────────────

// Restaurar archivo de la papelera
router.patch('/papelera/:id/restaurar', verificarToken, verificarCsrf, async (req, res) => {
  try {
    // Comprobar que hay cuota suficiente para restaurar
    const archivo = await pool.query(
      `SELECT tamanio_bytes FROM archivos
       WHERE id = $1 AND propietario_id = $2 AND eliminado = true AND boveda_id IS NULL`,
      [req.params.id, req.user.id]
    );
    if (archivo.rows.length === 0) {
      return res.status(404).json({ error: 'Archivo no encontrado en la papelera' });
    }

    const { tamanio_bytes } = archivo.rows[0];
    const cuota = await pool.query(
      `SELECT almacen_id, cuota_maxima_bytes, espacio_usado_bytes
       FROM usuario_almacen WHERE usuario_id = $1`,
      [req.user.id]
    );
    const { almacen_id, cuota_maxima_bytes, espacio_usado_bytes } = cuota.rows[0];
    const libre = parseInt(cuota_maxima_bytes) - parseInt(espacio_usado_bytes);
    if (tamanio_bytes > libre) {
      return res.status(400).json({ error: 'No tienes suficiente espacio libre para restaurar el archivo' });
    }

    await pool.query(
      `UPDATE archivos SET eliminado = false WHERE id = $1`,
      [req.params.id]
    );
    await pool.query(
      `UPDATE usuario_almacen SET espacio_usado_bytes = espacio_usado_bytes + $1
       WHERE usuario_id = $2 AND almacen_id = $3`,
      [tamanio_bytes, req.user.id, almacen_id]
    );

    await logUser(req.user.id, 'RESTAURAR_ARCHIVO', `Archivo ID: ${req.params.id}`, req.ip);
    res.json({ message: 'Archivo restaurado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE mutantes — requieren CSRF ─────────────────────────────────────────

// Mover archivo personal a la papelera (eliminado lógico)
router.delete('/eliminar/:id', verificarToken, verificarCsrf, async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE archivos SET eliminado = true
       WHERE id = $1 AND propietario_id = $2 AND boveda_id IS NULL AND eliminado = false
       RETURNING tamanio_bytes, almacen_id`,
      [req.params.id, req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }

    // Al mover a la papelera liberamos el espacio
    const { tamanio_bytes } = result.rows[0];
    await pool.query(
      `UPDATE usuario_almacen SET espacio_usado_bytes = GREATEST(espacio_usado_bytes - $1, 0)
       WHERE usuario_id = $2`,
      [tamanio_bytes, req.user.id]
    );

    await logUser(req.user.id, 'ELIMINAR_ARCHIVO', `Archivo ID: ${req.params.id}`, req.ip);
    res.json({ message: 'Archivo movido a la papelera' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Eliminar un archivo de la papelera de forma permanente
router.delete('/papelera/:id', verificarToken, verificarCsrf, async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM archivos
       WHERE id = $1 AND propietario_id = $2 AND eliminado = true AND boveda_id IS NULL
       RETURNING nombre_objeto`,
      [req.params.id, req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Archivo no encontrado en la papelera' });
    }

    // Eliminar el objeto físico de MinIO
    try {
      await minioClient.removeObject(BUCKET, result.rows[0].nombre_objeto);
    } catch (minioErr) {
      console.error('Error eliminando objeto de MinIO:', minioErr.message);
    }

    await logUser(req.user.id, 'ELIMINAR_PERMANENTE', `Archivo ID: ${req.params.id}`, req.ip);
    res.json({ message: 'Archivo eliminado permanentemente' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Vaciar toda la papelera del usuario
router.delete('/papelera', verificarToken, verificarCsrf, async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM archivos
       WHERE propietario_id = $1 AND eliminado = true AND boveda_id IS NULL
       RETURNING nombre_objeto`,
      [req.user.id]
    );

    // Eliminar objetos físicos de MinIO
    for (const row of result.rows) {
      try {
        await minioClient.removeObject(BUCKET, row.nombre_objeto);
      } catch (minioErr) {
        console.error('Error eliminando objeto de MinIO:', minioErr.message);
      }
    }

    await logUser(req.user.id, 'VACIAR_PAPELERA', `${result.rows.length} archivos eliminados`, req.ip);
    res.json({ message: `${result.rows.length} archivos eliminados permanentemente` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;