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

async function obtenerAcceso(bovedaId, usuarioId) {
  const creador = await pool.query(
    `SELECT id FROM bovedas WHERE id = $1 AND creador_id = $2`,
    [bovedaId, usuarioId]
  );
  if (creador.rows.length > 0) {
    return { esCreador: true, puede_leer: true, puede_subir: true, puede_borrar: true, puede_gestionar: true };
  }

  const miembro = await pool.query(
    `SELECT puede_leer, puede_subir, puede_borrar, puede_gestionar
     FROM boveda_miembros WHERE boveda_id = $1 AND usuario_id = $2`,
    [bovedaId, usuarioId]
  );
  if (miembro.rows.length > 0) {
    return { esCreador: false, ...miembro.rows[0] };
  }

  return null;
}

// ── GET — solo lectura, sin CSRF ─────────────────────────────────────────────

router.get('/mias', verificarToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT b.*,
              COUNT(bm.usuario_id) as num_miembros
       FROM bovedas b
       LEFT JOIN boveda_miembros bm ON b.id = bm.boveda_id
       WHERE b.creador_id = $1
       GROUP BY b.id
       ORDER BY b.creado_en DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/compartidas', verificarToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT b.*, u.username as creador_username,
              bm.puede_leer, bm.puede_subir, bm.puede_borrar, bm.puede_gestionar
       FROM boveda_miembros bm
       JOIN bovedas b ON bm.boveda_id = b.id
       JOIN usuarios u ON b.creador_id = u.id
       WHERE bm.usuario_id = $1
       ORDER BY bm.invitado_en DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', verificarToken, async (req, res) => {
  const acceso = await obtenerAcceso(req.params.id, req.user.id);
  if (!acceso) return res.status(403).json({ error: 'Sin acceso a esta bóveda' });

  try {
    const result = await pool.query(
      `SELECT b.*, u.username as creador_username
       FROM bovedas b
       JOIN usuarios u ON b.creador_id = u.id
       WHERE b.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Bóveda no encontrada' });
    res.json({ ...result.rows[0], acceso });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/miembros', verificarToken, async (req, res) => {
  const acceso = await obtenerAcceso(req.params.id, req.user.id);
  if (!acceso) return res.status(403).json({ error: 'Sin acceso a esta bóveda' });

  try {
    const result = await pool.query(
      `SELECT bm.*, u.username, u.email, u.nombre, u.apellido
       FROM boveda_miembros bm
       JOIN usuarios u ON bm.usuario_id = u.id
       WHERE bm.boveda_id = $1
       ORDER BY bm.invitado_en ASC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/archivos', verificarToken, async (req, res) => {
  const acceso = await obtenerAcceso(req.params.id, req.user.id);
  if (!acceso || !acceso.puede_leer) return res.status(403).json({ error: 'Sin permiso de lectura' });

  const { carpeta_id } = req.query;

  try {
    const result = await pool.query(
      `SELECT a.id, a.nombre, a.tipo, a.tamanio_bytes, a.creado_en, u.username as subido_por
       FROM archivos a
       JOIN usuarios u ON a.propietario_id = u.id
       WHERE a.boveda_id = $1
         AND a.eliminado = false
         AND a.carpeta_id IS NOT DISTINCT FROM $2
       ORDER BY a.creado_en DESC`,
      [req.params.id, carpeta_id || null]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/archivos/:fid/descargar', verificarToken, async (req, res) => {
  const acceso = await obtenerAcceso(req.params.id, req.user.id);
  if (!acceso || !acceso.puede_leer) return res.status(403).json({ error: 'Sin permiso de lectura' });

  try {
    const result = await pool.query(
      `SELECT * FROM archivos WHERE id = $1 AND boveda_id = $2 AND eliminado = false`,
      [req.params.fid, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Archivo no encontrado' });

    const archivo = result.rows[0];
    const stream = await minioClient.getObject(BUCKET, archivo.nombre_objeto);
    const encryptedBuffer = await streamToBuffer(stream);
    const decryptedBuffer = decrypt(encryptedBuffer);

    res.setHeader('Content-Disposition', `attachment; filename="${archivo.nombre}"`);
    res.setHeader('Content-Type', archivo.tipo);
    res.setHeader('Content-Length', decryptedBuffer.length);
    await logUser(req.user.id, 'DESCARGAR_ARCHIVO_BOVEDA', `Archivo: ${archivo.nombre}`, req.ip);
    res.send(decryptedBuffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST mutantes — requieren CSRF ────────────────────────────────────────────

router.post('/crear', verificarToken, verificarCsrf, async (req, res) => {
  const { nombre, descripcion, espacio_bytes } = req.body;

  if (!nombre || !espacio_bytes) {
    return res.status(400).json({ error: 'Nombre y espacio son obligatorios' });
  }
  if (espacio_bytes < 1024 * 1024) {
    return res.status(400).json({ error: 'El espacio mínimo es 1 MB' });
  }

  try {
    const cuota = await pool.query(
      `SELECT almacen_id, cuota_maxima_bytes, espacio_usado_bytes
       FROM usuario_almacen WHERE usuario_id = $1`,
      [req.user.id]
    );

    if (cuota.rows.length === 0) {
      return res.status(403).json({ error: 'No tienes almacén personal asignado' });
    }

    const { almacen_id } = cuota.rows[0];
    const cuota_maxima_bytes = parseInt(cuota.rows[0].cuota_maxima_bytes);
    const espacio_usado_bytes = parseInt(cuota.rows[0].espacio_usado_bytes);
    const libre = cuota_maxima_bytes - espacio_usado_bytes;

    if (espacio_bytes > libre) {
      return res.status(400).json({
        error: `No tienes suficiente espacio libre. Disponible: ${(libre / 1048576).toFixed(2)} MB`
      });
    }

    await pool.query(
      `UPDATE usuario_almacen SET espacio_usado_bytes = espacio_usado_bytes + $1
       WHERE usuario_id = $2 AND almacen_id = $3`,
      [espacio_bytes, req.user.id, almacen_id]
    );

    const boveda = await pool.query(
      `INSERT INTO bovedas (nombre, descripcion, creador_id, espacio_total_bytes)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [nombre, descripcion || null, req.user.id, espacio_bytes]
    );

    await logUser(req.user.id, 'CREAR_BOVEDA', `Bóveda: ${nombre}`, req.ip);
    res.status(201).json({ message: 'Bóveda creada', boveda: boveda.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/miembros', verificarToken, verificarCsrf, async (req, res) => {
  const acceso = await obtenerAcceso(req.params.id, req.user.id);
  if (!acceso) return res.status(403).json({ error: 'Sin acceso a esta bóveda' });
  if (!acceso.esCreador && !acceso.puede_gestionar) {
    return res.status(403).json({ error: 'No tienes permisos para invitar miembros' });
  }

  const { identificador, puede_leer = true, puede_subir = false, puede_borrar = false, puede_gestionar = false } = req.body;

  if (!identificador) {
    return res.status(400).json({ error: 'Debes indicar el usuario o email a invitar' });
  }

  try {
    const usuario = await pool.query(
      `SELECT id, username FROM usuarios WHERE username = $1 OR email = $1`,
      [identificador]
    );
    if (usuario.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const invitado = usuario.rows[0];

    if (invitado.id === req.user.id) {
      return res.status(400).json({ error: 'No puedes invitarte a ti mismo' });
    }

    const boveda = await pool.query(`SELECT creador_id FROM bovedas WHERE id = $1`, [req.params.id]);
    if (invitado.id === boveda.rows[0].creador_id) {
      return res.status(400).json({ error: 'El creador ya tiene acceso total' });
    }

    if (!acceso.esCreador && puede_gestionar) {
      return res.status(403).json({ error: 'Solo el creador puede asignar permisos de gestión' });
    }

    await pool.query(
      `INSERT INTO boveda_miembros (boveda_id, usuario_id, puede_leer, puede_subir, puede_borrar, puede_gestionar)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (boveda_id, usuario_id) DO UPDATE
       SET puede_leer = $3, puede_subir = $4, puede_borrar = $5, puede_gestionar = $6`,
      [req.params.id, invitado.id, puede_leer, puede_subir, puede_borrar, puede_gestionar]
    );

    await logUser(req.user.id, 'INVITAR_BOVEDA', `Invitado: ${invitado.username} a bóveda ${req.params.id}`, req.ip);
    res.status(201).json({ message: `${invitado.username} añadido a la bóveda` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/archivos/subir', verificarToken, verificarCsrf, upload.single('archivo'), async (req, res) => {
  const acceso = await obtenerAcceso(req.params.id, req.user.id);
  if (!acceso || !acceso.puede_subir) return res.status(403).json({ error: 'Sin permiso de subida' });

  if (!req.file) return res.status(400).json({ error: 'No se ha enviado ningún archivo' });

  const { originalname, mimetype, buffer, size } = req.file;
  const carpeta_id = req.body.carpeta_id || null;

  // Sanitizar nombre de archivo
  const nombreSeguro = path.basename(originalname).replace(/[^a-zA-Z0-9._\- ]/g, '_');
  const nombreObjeto = `bovedas/${req.params.id}/${Date.now()}-${nombreSeguro}`;

  try {
    const boveda = await pool.query(
      `SELECT espacio_total_bytes, espacio_usado_bytes FROM bovedas WHERE id = $1`,
      [req.params.id]
    );
    const espacio_total_bytes = parseInt(boveda.rows[0].espacio_total_bytes);
    const espacio_usado_bytes = parseInt(boveda.rows[0].espacio_usado_bytes);
    if (espacio_usado_bytes + size > espacio_total_bytes) {
      return res.status(400).json({
        error: `La bóveda no tiene espacio suficiente. Disponible: ${((espacio_total_bytes - espacio_usado_bytes) / 1048576).toFixed(2)} MB`
      });
    }

    if (carpeta_id) {
      const carpeta = await pool.query(
        `SELECT id FROM carpetas WHERE id = $1 AND boveda_id = $2`,
        [carpeta_id, req.params.id]
      );
      if (carpeta.rows.length === 0) {
        return res.status(404).json({ error: 'Carpeta no encontrada en esta bóveda' });
      }
    }

    const encryptedBuffer = encrypt(buffer);
    await minioClient.putObject(BUCKET, nombreObjeto, encryptedBuffer, encryptedBuffer.length, {
      'Content-Type': 'application/octet-stream'
    });

    const result = await pool.query(
      `INSERT INTO archivos (nombre, nombre_objeto, tipo, tamanio_bytes, propietario_id, boveda_id, carpeta_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, nombre, tipo, tamanio_bytes, creado_en`,
      [nombreSeguro, nombreObjeto, mimetype, size, req.user.id, req.params.id, carpeta_id]
    );

    await pool.query(
      `UPDATE bovedas SET espacio_usado_bytes = espacio_usado_bytes + $1 WHERE id = $2`,
      [size, req.params.id]
    );

    await logUser(req.user.id, 'SUBIR_ARCHIVO_BOVEDA', `Archivo: ${nombreSeguro} en bóveda ${req.params.id}`, req.ip);
    res.status(201).json({ message: 'Archivo subido', archivo: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH mutante — requiere CSRF ─────────────────────────────────────────────

router.patch('/:id/miembros/:uid/permisos', verificarToken, verificarCsrf, async (req, res) => {
  const acceso = await obtenerAcceso(req.params.id, req.user.id);
  if (!acceso) return res.status(403).json({ error: 'Sin acceso a esta bóveda' });
  if (!acceso.esCreador && !acceso.puede_gestionar) {
    return res.status(403).json({ error: 'No tienes permisos para editar miembros' });
  }

  const { puede_leer, puede_subir, puede_borrar, puede_gestionar } = req.body;

  try {
    const boveda = await pool.query(`SELECT creador_id FROM bovedas WHERE id = $1`, [req.params.id]);
    if (req.params.uid === boveda.rows[0].creador_id) {
      return res.status(403).json({ error: 'No puedes editar los permisos del creador' });
    }

    if (!acceso.esCreador && puede_gestionar) {
      return res.status(403).json({ error: 'Solo el creador puede asignar permisos de gestión' });
    }

    const result = await pool.query(
      `UPDATE boveda_miembros
       SET puede_leer = COALESCE($1, puede_leer),
           puede_subir = COALESCE($2, puede_subir),
           puede_borrar = COALESCE($3, puede_borrar),
           puede_gestionar = COALESCE($4, puede_gestionar)
       WHERE boveda_id = $5 AND usuario_id = $6
       RETURNING *`,
      [puede_leer, puede_subir, puede_borrar, puede_gestionar, req.params.id, req.params.uid]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Miembro no encontrado' });
    await logUser(req.user.id, 'EDITAR_PERMISOS_BOVEDA', `Usuario ${req.params.uid} en bóveda ${req.params.id}`, req.ip);
    res.json({ message: 'Permisos actualizados', miembro: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE mutantes — requieren CSRF ─────────────────────────────────────────

router.delete('/:id', verificarToken, verificarCsrf, async (req, res) => {
  try {
    const boveda = await pool.query(
      `SELECT * FROM bovedas WHERE id = $1 AND creador_id = $2`,
      [req.params.id, req.user.id]
    );
    if (boveda.rows.length === 0) {
      return res.status(403).json({ error: 'No tienes permiso para eliminar esta bóveda' });
    }

    const { espacio_total_bytes } = boveda.rows[0];

    await pool.query(
      `UPDATE usuario_almacen SET espacio_usado_bytes = espacio_usado_bytes - $1
       WHERE usuario_id = $2`,
      [espacio_total_bytes, req.user.id]
    );

    await pool.query(`DELETE FROM bovedas WHERE id = $1`, [req.params.id]);
    await logUser(req.user.id, 'ELIMINAR_BOVEDA', `Bóveda ID: ${req.params.id}`, req.ip);
    res.json({ message: 'Bóveda eliminada y espacio recuperado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id/miembros/:uid', verificarToken, verificarCsrf, async (req, res) => {
  const acceso = await obtenerAcceso(req.params.id, req.user.id);
  if (!acceso) return res.status(403).json({ error: 'Sin acceso a esta bóveda' });
  if (!acceso.esCreador && !acceso.puede_gestionar) {
    return res.status(403).json({ error: 'No tienes permisos para revocar acceso' });
  }

  try {
    const boveda = await pool.query(`SELECT creador_id FROM bovedas WHERE id = $1`, [req.params.id]);
    if (req.params.uid === boveda.rows[0].creador_id) {
      return res.status(403).json({ error: 'No puedes revocar el acceso al creador' });
    }

    if (!acceso.esCreador) {
      const objetivo = await pool.query(
        `SELECT puede_gestionar FROM boveda_miembros WHERE boveda_id = $1 AND usuario_id = $2`,
        [req.params.id, req.params.uid]
      );
      if (objetivo.rows[0]?.puede_gestionar) {
        return res.status(403).json({ error: 'Solo el creador puede revocar a un gestor' });
      }
    }

    await pool.query(
      `DELETE FROM boveda_miembros WHERE boveda_id = $1 AND usuario_id = $2`,
      [req.params.id, req.params.uid]
    );

    await logUser(req.user.id, 'REVOCAR_BOVEDA', `Usuario ${req.params.uid} de bóveda ${req.params.id}`, req.ip);
    res.json({ message: 'Acceso revocado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id/archivos/:fid', verificarToken, verificarCsrf, async (req, res) => {
  const acceso = await obtenerAcceso(req.params.id, req.user.id);
  if (!acceso || !acceso.puede_borrar) return res.status(403).json({ error: 'Sin permiso de borrado' });

  try {
    const result = await pool.query(
      `UPDATE archivos SET eliminado = true
       WHERE id = $1 AND boveda_id = $2
       RETURNING tamanio_bytes`,
      [req.params.fid, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Archivo no encontrado' });

    await pool.query(
      `UPDATE bovedas SET espacio_usado_bytes = espacio_usado_bytes - $1 WHERE id = $2`,
      [result.rows[0].tamanio_bytes, req.params.id]
    );

    await logUser(req.user.id, 'ELIMINAR_ARCHIVO_BOVEDA', `Archivo ${req.params.fid} de bóveda ${req.params.id}`, req.ip);
    res.json({ message: 'Archivo eliminado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;