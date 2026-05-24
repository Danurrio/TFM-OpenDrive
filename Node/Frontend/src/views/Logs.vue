<template>
  <div class="logs-page">
    <h2>📋 Logs de Auditoría</h2>

    <div class="tabs">
      <button :class="{ active: tab === 'admin' }" @click="tab = 'admin'; cargar(true)">
        🔧 Acciones Admin
      </button>
      <button :class="{ active: tab === 'usuarios' }" @click="tab = 'usuarios'; cargar(true)">
        👤 Acciones Usuario
      </button>
    </div>

    <div v-if="cargando" class="cargando">Cargando logs...</div>

    <table v-else>
      <thead>
        <tr>
          <th>Fecha</th>
          <th>Usuario</th>
          <th>Acción</th>
          <th v-if="tab === 'admin'">Entidad</th>
          <th>Detalle</th>
          <th>IP</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="log in logs" :key="log.id">
          <td>{{ formatFecha(log.creado_en) }}</td>
          <td>{{ log.admin_username || log.username || 'N/A' }}</td>
          <td><span class="badge-accion">{{ log.accion }}</span></td>
          <td v-if="tab === 'admin'">{{ log.entidad || '-' }}</td>
          <td>{{ log.detalle || '-' }}</td>
          <td>{{ log.ip || '-' }}</td>
        </tr>
        <tr v-if="logs.length === 0">
          <td colspan="6" class="vacio">No hay logs todavía</td>
        </tr>
      </tbody>
    </table>

    <div v-if="total > limit" class="paginacion">
      <button :disabled="page === 1" @click="page--; cargar()">← Anterior</button>
      <span>Página {{ page }} de {{ Math.ceil(total / limit) }} · {{ total }} entradas</span>
      <button :disabled="page >= Math.ceil(total / limit)" @click="page++; cargar()">Siguiente →</button>
    </div>
  </div>
</template>

<script>
import { apiGet } from '../api'

export default {
  data() {
    return {
      tab: 'admin',
      logs: [],
      cargando: true,
      total: 0,
      page: 1,
      limit: 50
    }
  },
  mounted() {
    this.cargar()
  },
  methods: {
    async cargar(resetPage = false) {
      if (resetPage) this.page = 1
      this.cargando = true
      try {
        const res = await apiGet(`/logs/${this.tab}?page=${this.page}&limit=${this.limit}`)
        const data = await res.json()
        this.logs = data.logs || []
        this.total = data.total || 0
      } catch (err) {
        console.error(err)
      } finally {
        this.cargando = false
      }
    },
    formatFecha(fecha) {
      return new Date(fecha).toLocaleString('es-ES')
    }
  }
}
</script>

<style scoped>
.logs-page { padding: 2rem; }
.logs-page h2 { color: #60a5fa; margin-bottom: 1.5rem; }

.tabs { display: flex; gap: 0.75rem; margin-bottom: 1.5rem; }
.tabs button {
  padding: 0.5rem 1.25rem;
  border-radius: 8px;
  border: none;
  background: #334155;
  color: #94a3b8;
  cursor: pointer;
  font-size: 0.9rem;
}
.tabs button.active { background: #3b82f6; color: white; }

table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
th { background: #1e293b; padding: 0.75rem; text-align: left; color: #64748b; }
td { padding: 0.75rem; border-bottom: 1px solid #1e293b20; }
tr:hover { background: #1e293b33; }

.badge-accion {
  background: #1e40af;
  color: #bfdbfe;
  padding: 0.2rem 0.6rem;
  border-radius: 999px;
  font-size: 0.75rem;
  white-space: nowrap;
}

.vacio { text-align: center; color: #475569; padding: 2rem; }
.cargando { color: #94a3b8; text-align: center; padding: 2rem; }

.paginacion {
  display: flex; align-items: center; justify-content: center;
  gap: 1rem; margin-top: 1.5rem; font-size: 0.85rem; color: #64748b;
}
.paginacion button {
  background: #334155; color: #e2e8f0; border: none; border-radius: 8px;
  padding: 0.4rem 0.9rem; cursor: pointer; font-size: 0.85rem;
}
.paginacion button:disabled { opacity: 0.4; cursor: not-allowed; }
.paginacion button:not(:disabled):hover { background: #475569; }
</style>