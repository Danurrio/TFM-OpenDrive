<template>
  <div class="admin-panel">
    <h2>⚙️ Panel de Administración</h2>

    <div v-if="cargando" class="cargando">Cargando usuarios...</div>

    <div v-else>
      <table>
        <thead>
          <tr>
            <th>Usuario</th>
            <th>Email</th>
            <th>Nombre</th>
            <th>Rol</th>
            <th>Estado</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in usuarios" :key="u.id">
            <td>{{ u.username }}</td>
            <td>{{ u.email }}</td>
            <td>{{ u.nombre }} {{ u.apellido }}</td>
            <td>
              <select
                v-if="puedeEditarRol(u.rol)"
                :value="u.rol"
                @change="cambiarRol(u.id, $event.target.value)">
                <option value="usuario">usuario</option>
                <option value="soporte" v-if="rolActual === 'superadmin' || rolActual === 'admin'">soporte</option>
                <option value="admin" v-if="rolActual === 'superadmin'">admin</option>
                <option value="superadmin" v-if="rolActual === 'superadmin'">superadmin</option>
              </select>
              <span v-else class="badge">{{ u.rol }}</span>
            </td>
            <td>
              <span :class="u.activo ? 'activo' : 'inactivo'">
                {{ u.activo ? 'Activo' : 'Inactivo' }}
              </span>
            </td>
            <td class="acciones">
              <button
                v-if="puedeDeshabilitarA(u.rol)"
                @click="toggleActivo(u)"
                :class="u.activo ? 'btn-danger' : 'btn-success'">
                {{ u.activo ? 'Deshabilitar' : 'Habilitar' }}
              </button>
              <button
                v-if="puedeResetPassword()"
                @click="forzarPassword(u.id)"
                class="btn-warning">
                Reset contraseña
              </button>
              <button
                v-if="rolActual === 'superadmin'"
                @click="eliminarUsuario(u.id)"
                class="btn-delete">
                Eliminar
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script>
import { apiGet, apiPatch, apiDelete } from '../api'

export default {
  data() {
    return {
      usuarios: [],
      cargando: true,
      rolActual: localStorage.getItem('rol') || ''
    }
  },
  mounted() {
    this.cargarUsuarios()
  },
  methods: {
    puedeEditarRol(rolObjetivo) {
      if (this.rolActual === 'superadmin') return true
      if (this.rolActual === 'admin' && ['soporte', 'usuario'].includes(rolObjetivo)) return true
      return false
    },
    puedeDeshabilitarA(rolObjetivo) {
      if (this.rolActual === 'superadmin') return true
      if (this.rolActual === 'admin' && ['soporte', 'usuario'].includes(rolObjetivo)) return true
      return false
    },
    puedeResetPassword() {
      return ['superadmin', 'admin', 'soporte'].includes(this.rolActual)
    },
    async cargarUsuarios() {
      try {
        const res = await apiGet('/admin/usuarios')
        this.usuarios = await res.json()
      } catch (err) {
        console.error(err)
      } finally {
        this.cargando = false
      }
    },
    async toggleActivo(usuario) {
      try {
        const res = await apiPatch(`/admin/usuarios/${usuario.id}/activo`, { activo: !usuario.activo })
        if (res.ok) {
          usuario.activo = !usuario.activo
        }
      } catch (err) {
        console.error(err)
      }
    },
    async forzarPassword(id) {
      try {
        await apiPatch(`/admin/usuarios/${id}/forzar-password`, {})
        alert('Se ha forzado el cambio de contraseña')
      } catch (err) {
        console.error(err)
      }
    },
    async cambiarRol(id, rol_nombre) {
      try {
        await apiPatch(`/admin/usuarios/${id}/rol`, { rol_nombre })
        await this.cargarUsuarios()
      } catch (err) {
        console.error(err)
      }
    },
    async eliminarUsuario(id) {
      if (!confirm('¿Seguro que quieres eliminar este usuario? Esta acción no se puede deshacer.')) return
      try {
        await apiDelete(`/admin/usuarios/${id}`)
        await this.cargarUsuarios()
      } catch (err) {
        console.error(err)
      }
    }
  }
}
</script>

<style scoped>
.admin-panel { padding: 2rem; }
.admin-panel h2 { color: #60a5fa; margin-bottom: 1.5rem; }

table { width: 100%; border-collapse: collapse; }
th { background: #1e293b; padding: 0.75rem; text-align: left; color: #94a3b8; font-size: 0.85rem; }
td { padding: 0.75rem; border-bottom: 1px solid #1e293b; font-size: 0.9rem; }
tr:hover { background: #1e293b33; }

select {
  background: #0f172a;
  color: #e2e8f0;
  border: 1px solid #334155;
  border-radius: 6px;
  padding: 0.3rem;
}

.badge {
  background: #334155;
  padding: 0.2rem 0.6rem;
  border-radius: 999px;
  font-size: 0.8rem;
}

.activo { color: #4ade80; }
.inactivo { color: #f87171; }

.acciones { display: flex; gap: 0.5rem; flex-wrap: wrap; }

button {
  padding: 0.3rem 0.7rem;
  border-radius: 6px;
  border: none;
  cursor: pointer;
  font-size: 0.8rem;
}

.btn-danger { background: #ef4444; color: white; }
.btn-success { background: #22c55e; color: white; }
.btn-warning { background: #f59e0b; color: white; }
.btn-delete { background: #7f1d1d; color: white; }

.cargando { color: #94a3b8; text-align: center; padding: 2rem; }
</style>