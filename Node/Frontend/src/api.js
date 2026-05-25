/**
 * api.js — Helper centralizado para todas las llamadas al backend.
 *
 * Qué hace:
 *  1. Centraliza la URL base (VITE_API_URL en lugar de estar hardcodeada en cada vista)
 *  2. Añade automáticamente el header Authorization con el JWT
 *  3. Añade automáticamente X-CSRF-Token en peticiones mutantes (POST/PUT/PATCH/DELETE)
 *  4. Exporta helpers tipados: apiGet, apiPost, apiPatch, apiDelete, apiUpload
 *
 * Uso en las vistas:
 *   import { apiGet, apiPost, apiPatch, apiDelete, apiUpload } from '../api'
 *
 *   const datos = await apiGet('/archivos/lista')
 *   const res   = await apiPost('/bovedas/crear', { nombre, espacio_bytes })
 *   const res   = await apiUpload('/archivos/subir', formData)
 */

export const API = import.meta.env.VITE_API_URL || 'https://backend-opendrive.apps-crc.testing';

const METODOS_MUTANTES = ['POST', 'PUT', 'PATCH', 'DELETE'];

/**
 * Construye los headers para peticiones JSON normales.
 * NO se usa para apiUpload (multipart), que gestiona sus propios headers.
 */
function buildHeaders(method = 'GET') {
  const headers = {
    'Content-Type': 'application/json',
  };

  const token = localStorage.getItem('token');
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (METODOS_MUTANTES.includes(method.toUpperCase())) {
    const csrfToken = sessionStorage.getItem('csrf_token');
    if (csrfToken) {
      headers['X-CSRF-Token'] = csrfToken;
    }
  }

  return headers;
}

/**
 * Fetch base con manejo de sesión expirada.
 * Si se pasan options.headers propios (como en apiUpload),
 * se usan tal cual sin sobreescribir con Content-Type: application/json.
 */
async function apiFetch(path, options = {}) {
  const method = options.method || 'GET';

  let headers;

  if (options.headers) {
    // Headers ya construidos externamente (ej: apiUpload sin Content-Type)
    // Solo añadimos Auth y CSRF si no están ya presentes
    headers = { ...options.headers };

    const token = localStorage.getItem('token');
    if (token && !headers['Authorization']) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    if (METODOS_MUTANTES.includes(method.toUpperCase()) && !headers['X-CSRF-Token']) {
      const csrfToken = sessionStorage.getItem('csrf_token');
      if (csrfToken) {
        headers['X-CSRF-Token'] = csrfToken;
      }
    }
  } else {
    // Petición JSON normal — construir headers completos
    headers = buildHeaders(method);
  }

  const response = await fetch(`${API}${path}`, {
    ...options,
    headers,
  });

  // Si el token expiró, limpiamos la sesión y forzamos login
  if (response.status === 401 || (response.status === 403 && !path.startsWith('/auth'))) {
    const body = await response.json().catch(() => ({}));
    // Solo redirigimos si el mensaje es de token inválido, no de permisos de rol
    if (body.error && (body.error.includes('Token') || body.error.includes('token'))) {
      sessionStorage.removeItem('csrf_token');
      localStorage.removeItem('token');
      localStorage.removeItem('rol');
      localStorage.removeItem('username');
      localStorage.removeItem('password_must_change');
      window.location.href = '/login';
      return null;
    }
  }

  return response;
}

// ── Helpers por método ───────────────────────────────────────────────────────

export async function apiGet(path) {
  return apiFetch(path, { method: 'GET' });
}

export async function apiPost(path, body) {
  return apiFetch(path, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function apiPatch(path, body) {
  return apiFetch(path, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export async function apiDelete(path) {
  return apiFetch(path, { method: 'DELETE' });
}

/**
 * Para subida de archivos con FormData.
 * NO se pone Content-Type: el navegador lo gestiona automáticamente
 * con el boundary correcto para multipart/form-data.
 */
export async function apiUpload(path, formData) {
  const token = localStorage.getItem('token');
  const csrfToken = sessionStorage.getItem('csrf_token');

  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
  // Content-Type NO se pone aquí — el navegador lo añade solo con el boundary

  return apiFetch(path, {
    method: 'POST',
    headers,
    body: formData,
  });
}