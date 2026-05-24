const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verificarToken, verificarCsrf } = require('../middleware/auth');
const { logUser } = require('../logger');

async function obtenerAccesoBoveda(bovedaId, usuarioId) {
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

async function obtenerAccesoCarpeta(carpetaId, usuarioId) {
  const carpeta = await pool.query(
    `SELECT * FROM carpetas WHERE id = $1`,
    [carpetaId]
  );
  if (carpeta.rows.length === 0) return null;

  const c = carpeta.rows[0];

  if (!c.boveda_id) {
    if (c.creador_id === usuarioId) {
      return { esCreador: true, puede_leer: true, puede_subir: true, puede_borrar: true, puede_gestionar: true, carpeta: c };
    }
    return null;
  }

  const accesoBoveda = await obtenerAccesoBoveda(c.boveda_id, usuarioId);
  if (!accesoBoveda) return null;

  if (accesoBoveda.esCreador || accesoBoveda.puede_gestionar) {
    return {
      esCreador: accesoBoveda.esCreador,
      puede_leer: true,
      puede_subir: true,
      puede_borrar: true,
      puede_gestionar: true,
      carpeta: c
    };
  }

  const permisosCarpeta = await pool.query(
    `SELECT puede_leer, puede_subir, puede_borrar
     FROM carpeta_permisos WHERE carpeta_id = $1 AND usuario_id = $2`,
    [carpetaId, usuarioId]
  );

  if (permisosCarpeta.rows.length > 0) {
    const pc = permisosCarpeta.rows[0];
    return {
      esCreador: false,
      puede_leer: pc.puede_leer,
      puede_subir: pc.puede_subir,
      puede_borrar: pc.puede_borrar,
      puede_gestionar: false,
      carpeta: c,
      tienePermisosEspecificos: true
    };
  }

  return {
    esCreador: false,
    puede_leer: accesoBoveda.puede_leer,
    puede_subir: accesoBoveda.puede_subir,
    puede_borrar: accesoBoveda.puede_borrar,
    puede_gestionar: false,
    carpeta: c,
    tienePermisosEspecificos: false
  };
}

// ── GET — solo lectura, sin CSRF ─────────────────────────────────────────────

router.get('/boveda/:bovedaId', verificarToken, async (req, res) => {
  const { bovedaId } = req.params;
  const { parent_id } = req.query;

  const accesoBoveda = await obtenerAccesoBoveda(bovedaId, req.user.id);
  if (!accesoBoveda || !accesoBoveda.puede_leer) {
    return res.status(403).json({ error: 'Sin acceso a esta bóveda' });
  }

  try {
    const result = await pool.query(
      `SELECT c.*, u.username as creador_username
       FROM carpetas c
       LEFT JOIN usuarios u ON c.creador_id = u.id
       WHERE c.boveda_id = $1 AND c.parent_id IS NOT DISTINCT FROM $2
       ORDER BY c.nombre ASC`,
      [bovedaId, parent_id || null]
    );

    const carpetasConAcceso = await Promise.all(
      result.rows.map(async (carpeta) => {
        const acceso = await obtenerAccesoCarpeta(carpeta.id, req.user.id);
        return {
          ...carpeta,
          acceso: acceso || { puede_leer: false, puede_subir: false, puede_borrar: false, puede_gestionar: false }
        };
      })
    );

    const carpetasVisibles = carpetasConAcceso.filter(c => c.acceso.puede_leer);
    res.json(carpetasVisibles);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:carpetaId/acceso', verificarToken, async (req, res) => {
  const acceso = await obtenerAccesoCarpeta(req.params.carpetaId, req.user.id);
  if (!acceso) return res.status(403).json({ error: 'Sin acceso a esta carpeta' });
  res.json(acceso);
});

router.get('/:carpetaId/permisos', verificarToken, async (req, res) => {
  const { carpetaId } = req.params;
  const acceso = await obtenerAccesoCarpeta(carpetaId, req.user.id);
  if (!acceso) return res.status(403).json({ error: 'Sin acceso a esta carpeta' });
  if (!acceso.puede_gestionar) return res.status(403).json({ error: 'Solo gestores pueden ver permisos de carpeta' });

  try {
    const result = await pool.query(
      `SELECT cp.*, u.username, u.email
       FROM carpeta_permisos cp
       JOIN usuarios u ON cp.usuario_id = u.id
       WHERE cp.carpeta_id = $1`,
      [carpetaId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/personal', verificarToken, async (req, res) => {
  const { parent_id } = req.query;
  try {
    const result = await pool.query(
      `SELECT c.*, u.username as creador_username
       FROM carpetas c
       LEFT JOIN usuarios u ON c.creador_id = u.id
       WHERE c.creador_id = $1 AND c.boveda_id IS NULL AND c.parent_id IS NOT DISTINCT FROM $2
       ORDER BY c.nombre ASC`,
      [req.user.id, parent_id || null]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST mutantes — requieren CSRF ────────────────────────────────────────────

router.post('/boveda/:bovedaId', verificarToken, verificarCsrf, async (req, res) => {
  const { bovedaId } = req.params;
  const { nombre, parent_id } = req.body;

  if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });

  if (parent_id) {
    const acceso = await obtenerAccesoCarpeta(parent_id, req.user.id);
    if (!acceso || !acceso.puede_subir) {
      return res.status(403).json({ error: 'Sin permiso para crear carpetas aquí' });
    }
  } else {
    const acceso = await obtenerAccesoBoveda(bovedaId, req.user.id);
    if (!acceso || !acceso.puede_subir) {
      return res.status(403).json({ error: 'Sin permiso para crear carpetas' });
    }
  }

  try {
    if (parent_id) {
      const padre = await pool.query(
        `SELECT id FROM carpetas WHERE id = $1 AND boveda_id = $2`,
        [parent_id, bovedaId]
      );
      if (padre.rows.length === 0) return res.status(404).json({ error: 'Carpeta padre no encontrada' });
    }

    const result = await pool.query(
      `INSERT INTO carpetas (nombre, boveda_id, parent_id, creador_id)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [nombre.trim(), bovedaId, parent_id || null, req.user.id]
    );
    await logUser(req.user.id, 'CREAR_CARPETA', `Carpeta: ${nombre} en bóveda ${bovedaId}`, req.ip);
    res.status(201).json({ message: 'Carpeta creada', carpeta: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:carpetaId/permisos', verificarToken, verificarCsrf, async (req, res) => {
  const { carpetaId } = req.params;
  const { identificador, puede_leer = true, puede_subir = false, puede_borrar = false } = req.body;

  if (!identificador) return res.status(400).json({ error: 'Indica el usuario o email' });

  const acceso = await obtenerAccesoCarpeta(carpetaId, req.user.id);
  if (!acceso) return res.status(403).json({ error: 'Sin acceso a esta carpeta' });
  if (!acceso.puede_gestionar) return res.status(403).json({ error: 'Solo gestores pueden asignar permisos' });

  try {
    const usuario = await pool.query(
      `SELECT id, username FROM usuarios WHERE username = $1 OR email = $1`,
      [identificador]
    );
    if (usuario.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });

    const target = usuario.rows[0];

    await pool.query(
      `INSERT INTO carpeta_permisos (carpeta_id, usuario_id, puede_leer, puede_subir, puede_borrar)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (carpeta_id, usuario_id) DO UPDATE
       SET puede_leer = $3, puede_subir = $4, puede_borrar = $5`,
      [carpetaId, target.id, puede_leer, puede_subir, puede_borrar]
    );

    await logUser(req.user.id, 'ASIGNAR_PERMISO_CARPETA', `Usuario ${target.username} en carpeta ${carpetaId}`, req.ip);
    res.json({ message: `Permisos actualizados para ${target.username}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/personal', verificarToken, verificarCsrf, async (req, res) => {
  const { nombre, parent_id } = req.body;
  if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
  try {
    if (parent_id) {
      const padre = await pool.query(
        `SELECT id FROM carpetas WHERE id = $1 AND creador_id = $2 AND boveda_id IS NULL`,
        [parent_id, req.user.id]
      );
      if (padre.rows.length === 0) return res.status(404).json({ error: 'Carpeta padre no encontrada' });
    }
    const result = await pool.query(
      `INSERT INTO carpetas (nombre, boveda_id, parent_id, creador_id)
       VALUES ($1, NULL, $2, $3) RETURNING *`,
      [nombre.trim(), parent_id || null, req.user.id]
    );
    await logUser(req.user.id, 'CREAR_CARPETA_PERSONAL', `Carpeta: ${nombre}`, req.ip);
    res.status(201).json({ message: 'Carpeta creada', carpeta: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE mutantes — requieren CSRF ─────────────────────────────────────────

router.delete('/boveda/:bovedaId/:carpetaId', verificarToken, verificarCsrf, async (req, res) => {
  const { bovedaId, carpetaId } = req.params;

  const accesoBoveda = await obtenerAccesoBoveda(bovedaId, req.user.id);
  if (!accesoBoveda) return res.status(403).json({ error: 'Sin acceso a esta bóveda' });

  try {
    const carpeta = await pool.query(
      `SELECT * FROM carpetas WHERE id = $1 AND boveda_id = $2`,
      [carpetaId, bovedaId]
    );
    if (carpeta.rows.length === 0) return res.status(404).json({ error: 'Carpeta no encontrada' });

    const esCreadorCarpeta = carpeta.rows[0].creador_id === req.user.id;
    if (!esCreadorCarpeta && !accesoBoveda.esCreador && !accesoBoveda.puede_gestionar) {
      return res.status(403).json({ error: 'Sin permiso para eliminar esta carpeta' });
    }

    await pool.query(
      `WITH RECURSIVE sub AS (
         SELECT id FROM carpetas WHERE id = $1
         UNION ALL
         SELECT c.id FROM carpetas c JOIN sub ON c.parent_id = sub.id
       )
       UPDATE archivos SET eliminado = true
       WHERE carpeta_id IN (SELECT id FROM sub) AND boveda_id = $2`,
      [carpetaId, bovedaId]
    );

    await pool.query(`DELETE FROM carpetas WHERE id = $1`, [carpetaId]);
    await logUser(req.user.id, 'ELIMINAR_CARPETA', `Carpeta ID: ${carpetaId}`, req.ip);
    res.json({ message: 'Carpeta eliminada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:carpetaId/permisos/:uid', verificarToken, verificarCsrf, async (req, res) => {
  const { carpetaId, uid } = req.params;

  const acceso = await obtenerAccesoCarpeta(carpetaId, req.user.id);
  if (!acceso) return res.status(403).json({ error: 'Sin acceso a esta carpeta' });
  if (!acceso.puede_gestionar) return res.status(403).json({ error: 'Solo gestores pueden revocar permisos' });

  try {
    await pool.query(
      `DELETE FROM carpeta_permisos WHERE carpeta_id = $1 AND usuario_id = $2`,
      [carpetaId, uid]
    );
    res.json({ message: 'Permiso revocado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/personal/:carpetaId', verificarToken, verificarCsrf, async (req, res) => {
  const { carpetaId } = req.params;
  try {
    const carpeta = await pool.query(
      `SELECT * FROM carpetas WHERE id = $1 AND creador_id = $2 AND boveda_id IS NULL`,
      [carpetaId, req.user.id]
    );
    if (carpeta.rows.length === 0) return res.status(404).json({ error: 'Carpeta no encontrada' });

    await pool.query(
      `WITH RECURSIVE sub AS (
         SELECT id FROM carpetas WHERE id = $1
         UNION ALL
         SELECT c.id FROM carpetas c JOIN sub ON c.parent_id = sub.id
       )
       UPDATE archivos SET eliminado = true
       WHERE carpeta_id IN (SELECT id FROM sub) AND propietario_id = $2`,
      [carpetaId, req.user.id]
    );
    await pool.query(`DELETE FROM carpetas WHERE id = $1`, [carpetaId]);
    await logUser(req.user.id, 'ELIMINAR_CARPETA_PERSONAL', `Carpeta ID: ${carpetaId}`, req.ip);
    res.json({ message: 'Carpeta eliminada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;