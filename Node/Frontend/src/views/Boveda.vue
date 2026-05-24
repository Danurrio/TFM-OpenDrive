<template>
  <div class="dashboard-layout">

    <!-- Sidebar -->
    <aside class="sidebar">
      <div class="sidebar-logo">☁️ OpenDrive</div>
      <nav class="sidebar-nav">
        <button @click="$router.push('/dashboard')">← Volver</button>
        <button :class="{ active: tab === 'archivos' }" @click="tab = 'archivos'">📂 Archivos</button>
        <button
          v-if="acceso && (acceso.esCreador || acceso.puede_gestionar)"
          :class="{ active: tab === 'miembros' }"
          @click="tab = 'miembros'">
          👥 Miembros
        </button>
      </nav>

      <div class="espacio-box" v-if="boveda">
        <p class="espacio-label">{{ boveda.nombre }}</p>
        <div class="barra-fondo">
          <div class="barra-usada" :style="{ width: porcentaje + '%', background: colorEspacio }"></div>
        </div>
        <p class="espacio-texto">{{ usadoMB }} / {{ totalMB }} MB</p>
        <p class="espacio-texto" style="margin-top:0.25rem">
          {{ acceso?.esCreador ? '👑 Creador' : permisoLabel }}
        </p>
      </div>
    </aside>

    <!-- Contenido -->
    <main class="main-content">
      <div v-if="cargando" class="vacio">Cargando bóveda...</div>
      <div v-else-if="!boveda" class="vacio">Bóveda no encontrada o sin acceso.</div>

      <template v-else>

        <!-- ── ARCHIVOS ── -->
        <div v-if="tab === 'archivos'">
          <div class="main-header">
            <div class="header-left">
              <h2>📂 {{ boveda.nombre }}</h2>
              <div v-if="breadcrumb.length > 0" class="breadcrumb">
                <span class="breadcrumb-item" @click="irARaiz()">📂 Raíz</span>
                <template v-for="(crumb, i) in breadcrumb" :key="crumb.id">
                  <span class="breadcrumb-sep">›</span>
                  <span
                    class="breadcrumb-item"
                    :class="{ 'breadcrumb-actual': i === breadcrumb.length - 1 }"
                    @click="i < breadcrumb.length - 1 && irACarpeta(crumb.id, crumb.nombre, i)">
                    {{ crumb.nombre }}
                  </span>
                </template>
              </div>
            </div>
            <div class="header-acciones">
              <button v-if="accesoEfectivo.puede_subir" class="btn-accion" @click="mostrarModalCarpeta = true">
                📂 Nueva carpeta
              </button>
              <button v-if="accesoEfectivo.puede_subir" class="btn-subir" @click="$refs.inputArchivo.click()">
                ⬆️ Subir archivo
              </button>
              <input ref="inputArchivo" type="file" style="display:none" @change="subirArchivo" />
            </div>
          </div>

          <div v-if="carpetaActualId" class="btn-volver-wrap">
            <button class="btn-volver" @click="subirNivel()">← Volver</button>
          </div>

          <p v-if="errorArchivo" class="notificacion error">{{ errorArchivo }}</p>

          <div class="lista-archivos">
            <div
              class="archivo-fila carpeta-fila"
              v-for="carpeta in carpetas"
              :key="'c-' + carpeta.id"
              @click="entrarCarpeta(carpeta)">
              <span>📂 {{ carpeta.nombre }}</span>
              <div style="display:flex;gap:0.5rem;align-items:center;">
                <span class="archivo-fecha">Carpeta</span>
                <button
                  v-if="acceso.esCreador || acceso.puede_gestionar"
                  class="btn-mini"
                  @click.stop="abrirPermisosCarteta(carpeta)"
                  title="Gestionar permisos">
                  🔑
                </button>
                <button
                  v-if="accesoEfectivo.puede_borrar || acceso.esCreador || acceso.puede_gestionar"
                  class="btn-mini btn-mini-danger"
                  @click.stop="eliminarCarpeta(carpeta.id, carpeta.nombre)">
                  🗑️
                </button>
              </div>
            </div>
            <div class="archivo-fila" v-for="a in archivos" :key="a.id">
              <span>{{ iconoArchivo(a.tipo) }} {{ a.nombre }}</span>
              <div style="display:flex;gap:0.5rem;align-items:center;">
                <span class="archivo-fecha">{{ a.subido_por }} · {{ new Date(a.creado_en).toLocaleDateString() }}</span>
                <button class="btn-mini" @click="descargar(a.id, a.nombre)">⬇️</button>
                <button v-if="accesoEfectivo.puede_borrar" class="btn-mini btn-mini-danger" @click="eliminar(a.id)">🗑️</button>
              </div>
            </div>
            <div v-if="carpetas.length === 0 && archivos.length === 0" class="vacio">
              {{ carpetaActualId ? 'Esta carpeta está vacía.' : 'No hay archivos en esta bóveda todavía.' }}
            </div>
          </div>
        </div>

        <!-- ── MIEMBROS ── -->
        <div v-if="tab === 'miembros'">
          <div class="main-header">
            <h2>👥 Miembros</h2>
          </div>

          <div class="invitar-box">
            <input v-model="invitar.identificador" type="text" placeholder="Usuario o email a invitar" />
            <div class="permisos-check">
              <label><input type="checkbox" v-model="invitar.puede_leer" /> 👁️ Leer</label>
              <label><input type="checkbox" v-model="invitar.puede_subir" /> ⬆️ Subir</label>
              <label><input type="checkbox" v-model="invitar.puede_borrar" /> 🗑️ Borrar</label>
              <label v-if="acceso.esCreador"><input type="checkbox" v-model="invitar.puede_gestionar" /> ⚙️ Gestionar</label>
            </div>
            <p v-if="errorInvitar" class="error-inline">{{ errorInvitar }}</p>
            <button class="btn-invitar" @click="invitarMiembro" :disabled="invitando">
              {{ invitando ? 'Invitando...' : '➕ Invitar' }}
            </button>
          </div>

          <div v-if="miembros.length === 0" class="vacio">No hay miembros todavía.</div>
          <div v-else class="lista-miembros">
            <div class="miembro-fila" v-for="m in miembros" :key="m.usuario_id">
              <div class="miembro-info">
                <span class="miembro-nombre">{{ m.username }}</span>
                <span class="miembro-email">{{ m.email }}</span>
              </div>
              <div class="miembro-permisos">
                <label><input type="checkbox" :checked="m.puede_leer" @change="editarPermiso(m, 'puede_leer', $event.target.checked)" /> 👁️</label>
                <label><input type="checkbox" :checked="m.puede_subir" @change="editarPermiso(m, 'puede_subir', $event.target.checked)" /> ⬆️</label>
                <label><input type="checkbox" :checked="m.puede_borrar" @change="editarPermiso(m, 'puede_borrar', $event.target.checked)" /> 🗑️</label>
                <label v-if="acceso.esCreador"><input type="checkbox" :checked="m.puede_gestionar" @change="editarPermiso(m, 'puede_gestionar', $event.target.checked)" /> ⚙️</label>
              </div>
              <button
                v-if="acceso.esCreador || (acceso.puede_gestionar && !m.puede_gestionar)"
                class="btn-revocar"
                @click="revocarAcceso(m)">
                Revocar
              </button>
            </div>
          </div>

          <div v-if="acceso.esCreador" class="zona-peligro">
            <h3>⚠️ Zona de peligro</h3>
            <p>Eliminar la bóveda devolverá el espacio a tu cuota personal pero borrará todos sus archivos.</p>
            <button class="btn-eliminar-boveda" @click="eliminarBoveda">🗑️ Eliminar bóveda</button>
          </div>
        </div>

      </template>
    </main>

    <!-- ── MODAL NUEVA CARPETA ── -->
    <div v-if="mostrarModalCarpeta" class="modal-overlay" @click.self="cerrarModalCarpeta()">
      <div class="modal">
        <h3>📂 Nueva carpeta</h3>
        <input
          v-model="nombreNuevaCarpeta"
          type="text"
          placeholder="Nombre de la carpeta *"
          @keyup.enter="crearCarpeta" />
        <p v-if="errorCarpeta" class="error-modal">{{ errorCarpeta }}</p>
        <div class="modal-acciones">
          <button class="btn-cancelar" @click="cerrarModalCarpeta()">Cancelar</button>
          <button class="btn-crear" @click="crearCarpeta" :disabled="creandoCarpeta">
            {{ creandoCarpeta ? 'Creando...' : 'Crear' }}
          </button>
        </div>
      </div>
    </div>

    <!-- ── MODAL PERMISOS DE CARPETA ── -->
    <div v-if="mostrarModalPermisos" class="modal-overlay" @click.self="cerrarModalPermisos()">
      <div class="modal modal-permisos">
        <h3>🔑 Permisos: {{ carpetaPermisos?.nombre }}</h3>
        <p class="modal-sub">Permisos específicos por usuario para esta carpeta. Sobreescriben los permisos generales de la bóveda.</p>

        <div class="permiso-form">
          <input v-model="nuevoPermiso.identificador" type="text" placeholder="Usuario o email" />
          <div class="permisos-check">
            <label><input type="checkbox" v-model="nuevoPermiso.puede_leer" /> 👁️ Leer</label>
            <label><input type="checkbox" v-model="nuevoPermiso.puede_subir" /> ⬆️ Subir</label>
            <label><input type="checkbox" v-model="nuevoPermiso.puede_borrar" /> 🗑️ Borrar</label>
          </div>
          <p v-if="errorPermisoModal" class="error-inline">{{ errorPermisoModal }}</p>
          <button class="btn-invitar" @click="asignarPermisoCarpeta" :disabled="asignandoPermiso">
            {{ asignandoPermiso ? 'Guardando...' : '💾 Guardar permiso' }}
          </button>
        </div>

        <div v-if="listaPermisosCarpeta.length > 0" class="lista-permisos-carpeta">
          <p class="permiso-sub-label">Permisos personalizados activos:</p>
          <div class="permiso-fila" v-for="p in listaPermisosCarpeta" :key="p.usuario_id">
            <div>
              <span class="miembro-nombre">{{ p.username }}</span>
              <span class="miembro-email"> · {{ p.email }}</span>
            </div>
            <div class="permiso-badges">
              <span v-if="p.puede_leer" class="badge-p">👁️</span>
              <span v-if="p.puede_subir" class="badge-p">⬆️</span>
              <span v-if="p.puede_borrar" class="badge-p">🗑️</span>
            </div>
            <button class="btn-revocar" @click="revocarPermisoCarpeta(p.usuario_id)">Revocar</button>
          </div>
        </div>
        <p v-else class="vacio" style="padding:1rem 0">Sin permisos personalizados aún.</p>

        <div class="modal-acciones">
          <button class="btn-cancelar" @click="cerrarModalPermisos()">Cerrar</button>
        </div>
      </div>
    </div>

  </div>
</template>

<script>
import { apiGet, apiPost, apiPatch, apiDelete, apiUpload, API } from '../api'

export default {
  data() {
    return {
      tab: 'archivos',
      cargando: true,
      boveda: null,
      acceso: null,
      archivos: [],
      carpetas: [],
      carpetaActualId: null,
      accesoCarpetaActual: null,
      breadcrumb: [],
      miembros: [],
      errorArchivo: '',
      errorInvitar: '',
      invitando: false,
      invitar: { identificador: '', puede_leer: true, puede_subir: false, puede_borrar: false, puede_gestionar: false },
      mostrarModalCarpeta: false,
      creandoCarpeta: false,
      nombreNuevaCarpeta: '',
      errorCarpeta: '',
      mostrarModalPermisos: false,
      carpetaPermisos: null,
      listaPermisosCarpeta: [],
      nuevoPermiso: { identificador: '', puede_leer: true, puede_subir: false, puede_borrar: false },
      asignandoPermiso: false,
      errorPermisoModal: ''
    }
  },
  computed: {
    accesoEfectivo() {
      return this.carpetaActualId && this.accesoCarpetaActual
        ? this.accesoCarpetaActual
        : (this.acceso || {})
    },
    porcentaje() {
      if (!this.boveda?.espacio_total_bytes) return 0
      return Math.min(this.boveda.espacio_usado_bytes / this.boveda.espacio_total_bytes * 100, 100).toFixed(1)
    },
    colorEspacio() {
      if (this.porcentaje >= 90) return '#ef4444'
      if (this.porcentaje >= 70) return '#f59e0b'
      return '#3b82f6'
    },
    usadoMB() { return this.boveda ? (this.boveda.espacio_usado_bytes / 1048576).toFixed(1) : 0 },
    totalMB() { return this.boveda ? (this.boveda.espacio_total_bytes / 1048576).toFixed(1) : 0 },
    permisoLabel() {
      if (!this.acceso) return ''
      const p = []
      if (this.acceso.puede_leer) p.push('👁️ Leer')
      if (this.acceso.puede_subir) p.push('⬆️ Subir')
      if (this.acceso.puede_borrar) p.push('🗑️ Borrar')
      if (this.acceso.puede_gestionar) p.push('⚙️ Gestionar')
      return p.join(' · ')
    }
  },
  async mounted() {
    await this.cargarBoveda()
    await this.cargarContenido()
  },
  methods: {

    // ── Navegación carpetas ──
    irARaiz() {
      this.carpetaActualId = null
      this.accesoCarpetaActual = null
      this.breadcrumb = []
      this.cargarContenido()
    },
    async entrarCarpeta(carpeta) {
      if (!carpeta.acceso?.puede_leer) return
      this.breadcrumb.push({ id: carpeta.id, nombre: carpeta.nombre })
      this.carpetaActualId = carpeta.id
      this.accesoCarpetaActual = carpeta.acceso
      this.cargarContenido()
    },
    async irACarpeta(id, nombre, index) {
      this.breadcrumb = this.breadcrumb.slice(0, index + 1)
      this.carpetaActualId = id
      try {
        const res = await apiGet(`/carpetas/${id}/acceso`)
        this.accesoCarpetaActual = res.ok ? await res.json() : null
      } catch { this.accesoCarpetaActual = null }
      this.cargarContenido()
    },
    async subirNivel() {
      if (this.breadcrumb.length === 0) return
      this.breadcrumb.pop()
      if (this.breadcrumb.length > 0) {
        const crumb = this.breadcrumb[this.breadcrumb.length - 1]
        this.carpetaActualId = crumb.id
        try {
          const res = await apiGet(`/carpetas/${crumb.id}/acceso`)
          this.accesoCarpetaActual = res.ok ? await res.json() : null
        } catch { this.accesoCarpetaActual = null }
      } else {
        this.carpetaActualId = null
        this.accesoCarpetaActual = null
      }
      this.cargarContenido()
    },

    // ── Carga de datos ──
    async cargarBoveda() {
      try {
        const res = await apiGet(`/bovedas/${this.$route.params.id}`)
        if (!res.ok) { this.boveda = null; return }
        const data = await res.json()
        this.boveda = data
        this.acceso = data.acceso
      } catch (err) { console.error(err) }
      finally { this.cargando = false }
    },
    async cargarContenido() {
      await Promise.all([this.cargarCarpetas(), this.cargarArchivos()])
    },
    async cargarCarpetas() {
      try {
        const params = this.carpetaActualId ? `?parent_id=${this.carpetaActualId}` : ''
        const res = await apiGet(`/carpetas/boveda/${this.$route.params.id}${params}`)
        if (res.ok) this.carpetas = await res.json()
      } catch (err) { console.error(err) }
    },
    async cargarArchivos() {
      try {
        const params = this.carpetaActualId ? `?carpeta_id=${this.carpetaActualId}` : ''
        const res = await apiGet(`/bovedas/${this.$route.params.id}/archivos${params}`)
        if (res.ok) this.archivos = await res.json()
      } catch (err) { console.error(err) }
    },
    async cargarMiembros() {
      try {
        const res = await apiGet(`/bovedas/${this.$route.params.id}/miembros`)
        if (res.ok) this.miembros = await res.json()
      } catch (err) { console.error(err) }
    },

    // ── Carpetas ──
    cerrarModalCarpeta() {
      this.mostrarModalCarpeta = false
      this.nombreNuevaCarpeta = ''
      this.errorCarpeta = ''
    },
    async crearCarpeta() {
      this.errorCarpeta = ''
      if (!this.nombreNuevaCarpeta.trim()) { this.errorCarpeta = 'El nombre es obligatorio'; return }
      this.creandoCarpeta = true
      try {
        const body = { nombre: this.nombreNuevaCarpeta.trim() }
        if (this.carpetaActualId) body.parent_id = this.carpetaActualId
        const res = await apiPost(`/carpetas/boveda/${this.$route.params.id}`, body)
        const data = await res.json()
        if (!res.ok) throw new Error(data.error)
        this.cerrarModalCarpeta()
        await this.cargarCarpetas()
      } catch (err) {
        this.errorCarpeta = err.message
      } finally {
        this.creandoCarpeta = false
      }
    },
    async eliminarCarpeta(id, nombre) {
      if (!confirm(`¿Eliminar la carpeta "${nombre}" y todo su contenido?`)) return
      try {
        await apiDelete(`/carpetas/boveda/${this.$route.params.id}/${id}`)
        await this.cargarContenido()
      } catch (err) { console.error(err) }
    },

    // ── Permisos de carpeta ──
    async abrirPermisosCarteta(carpeta) {
      this.carpetaPermisos = carpeta
      this.nuevoPermiso = { identificador: '', puede_leer: true, puede_subir: false, puede_borrar: false }
      this.errorPermisoModal = ''
      this.mostrarModalPermisos = true
      await this.cargarPermisosCarpeta(carpeta.id)
    },
    cerrarModalPermisos() {
      this.mostrarModalPermisos = false
      this.carpetaPermisos = null
      this.listaPermisosCarpeta = []
      this.errorPermisoModal = ''
    },
    async cargarPermisosCarpeta(carpetaId) {
      try {
        const res = await apiGet(`/carpetas/${carpetaId}/permisos`)
        if (res.ok) this.listaPermisosCarpeta = await res.json()
      } catch (err) { console.error(err) }
    },
    async asignarPermisoCarpeta() {
      this.errorPermisoModal = ''
      if (!this.nuevoPermiso.identificador) { this.errorPermisoModal = 'Indica el usuario o email'; return }
      this.asignandoPermiso = true
      try {
        const res = await apiPost(`/carpetas/${this.carpetaPermisos.id}/permisos`, this.nuevoPermiso)
        const data = await res.json()
        if (!res.ok) throw new Error(data.error)
        this.nuevoPermiso = { identificador: '', puede_leer: true, puede_subir: false, puede_borrar: false }
        await this.cargarPermisosCarpeta(this.carpetaPermisos.id)
      } catch (err) {
        this.errorPermisoModal = err.message
      } finally {
        this.asignandoPermiso = false
      }
    },
    async revocarPermisoCarpeta(uid) {
      if (!confirm('¿Revocar permisos personalizados de este usuario?')) return
      try {
        await apiDelete(`/carpetas/${this.carpetaPermisos.id}/permisos/${uid}`)
        await this.cargarPermisosCarpeta(this.carpetaPermisos.id)
      } catch (err) { console.error(err) }
    },

    // ── Archivos ──
    async subirArchivo(event) {
      this.errorArchivo = ''
      const archivo = event.target.files[0]
      if (!archivo) return
      const formData = new FormData()
      formData.append('archivo', archivo)
      if (this.carpetaActualId) formData.append('carpeta_id', this.carpetaActualId)
      try {
        const res = await apiUpload(`/bovedas/${this.$route.params.id}/archivos/subir`, formData)
        const data = await res.json()
        if (!res.ok) throw new Error(data.error)
        await this.cargarArchivos()
        await this.cargarBoveda()
      } catch (err) { this.errorArchivo = err.message }
    },
    async descargar(id, nombre) {
      const token = localStorage.getItem('token')
      const csrfToken = sessionStorage.getItem('csrf_token')
      const headers = { 'Authorization': `Bearer ${token}` }
      if (csrfToken) headers['X-CSRF-Token'] = csrfToken

      const res = await fetch(`${API}/bovedas/${this.$route.params.id}/archivos/${id}/descargar`, { headers })
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = nombre; a.click()
      URL.revokeObjectURL(url)
    },
    async eliminar(id) {
      if (!confirm('¿Eliminar este archivo de la bóveda?')) return
      await apiDelete(`/bovedas/${this.$route.params.id}/archivos/${id}`)
      await this.cargarArchivos()
      await this.cargarBoveda()
    },

    // ── Miembros ──
    async invitarMiembro() {
      this.errorInvitar = ''
      if (!this.invitar.identificador) { this.errorInvitar = 'Introduce un usuario o email'; return }
      this.invitando = true
      try {
        const res = await apiPost(`/bovedas/${this.$route.params.id}/miembros`, this.invitar)
        const data = await res.json()
        if (!res.ok) throw new Error(data.error)
        this.invitar = { identificador: '', puede_leer: true, puede_subir: false, puede_borrar: false, puede_gestionar: false }
        await this.cargarMiembros()
      } catch (err) { this.errorInvitar = err.message }
      finally { this.invitando = false }
    },
    async editarPermiso(miembro, campo, valor) {
      try {
        await apiPatch(`/bovedas/${this.$route.params.id}/miembros/${miembro.usuario_id}/permisos`, { [campo]: valor })
        miembro[campo] = valor
      } catch (err) { console.error(err) }
    },
    async revocarAcceso(miembro) {
      if (!confirm(`¿Revocar acceso a ${miembro.username}?`)) return
      try {
        await apiDelete(`/bovedas/${this.$route.params.id}/miembros/${miembro.usuario_id}`)
        await this.cargarMiembros()
      } catch (err) { console.error(err) }
    },
    async eliminarBoveda() {
      if (!confirm('¿Eliminar esta bóveda? Se perderán todos sus archivos y se recuperará el espacio.')) return
      try {
        const res = await apiDelete(`/bovedas/${this.$route.params.id}`)
        if (res.ok) this.$router.push('/dashboard')
      } catch (err) { console.error(err) }
    },

    iconoArchivo(tipo) {
      if (!tipo) return '📁'
      if (tipo.includes('pdf')) return '📄'
      if (tipo.includes('image')) return '🖼️'
      if (tipo.includes('video')) return '🎬'
      if (tipo.includes('audio')) return '🎵'
      if (tipo.includes('zip') || tipo.includes('compressed')) return '📦'
      if (tipo.includes('word') || tipo.includes('document')) return '📝'
      return '📁'
    }
  },
  watch: {
    tab(val) {
      if (val === 'miembros') this.cargarMiembros()
      if (val === 'archivos') this.cargarContenido()
    }
  }
}
</script>

<style scoped>
.dashboard-layout { display: flex; min-height: calc(100vh - 60px); }

.sidebar {
  width: 240px; background: #1e293b; padding: 1.5rem 1rem;
  display: flex; flex-direction: column; border-right: 1px solid #334155; flex-shrink: 0;
}
.sidebar-logo { font-size: 1.3rem; color: #60a5fa; font-weight: bold; margin-bottom: 2rem; padding-left: 0.5rem; }
.sidebar-nav { display: flex; flex-direction: column; gap: 0.5rem; flex: 1; }
.sidebar-nav button {
  text-align: left; background: transparent; color: #94a3b8;
  padding: 0.65rem 0.75rem; border-radius: 8px; font-size: 0.95rem;
  border: none; cursor: pointer; transition: background 0.2s;
}
.sidebar-nav button:hover { background: #334155; color: #e2e8f0; }
.sidebar-nav button.active { background: #3b82f620; color: #60a5fa; }

.espacio-box { margin-top: auto; padding-top: 1.5rem; border-top: 1px solid #334155; }
.espacio-label { font-size: 0.8rem; color: #64748b; margin-bottom: 0.5rem; font-weight: 600; }
.barra-fondo { background: #334155; border-radius: 999px; height: 6px; margin-bottom: 0.4rem; }
.barra-usada { height: 6px; border-radius: 999px; transition: width 0.5s; }
.espacio-texto { font-size: 0.78rem; color: #64748b; }

.main-content { flex: 1; padding: 2rem; overflow-y: auto; }

.main-header {
  display: flex; justify-content: space-between; align-items: flex-start;
  margin-bottom: 1.5rem; gap: 1rem;
}
.header-left { display: flex; flex-direction: column; gap: 0.4rem; }
.main-header h2 { color: #e2e8f0; font-size: 1.5rem; }
.header-acciones { display: flex; gap: 0.75rem; flex-shrink: 0; align-items: center; }

.breadcrumb { display: flex; align-items: center; gap: 0.35rem; flex-wrap: wrap; }
.breadcrumb-item {
  font-size: 0.82rem; color: #60a5fa; cursor: pointer;
  padding: 0.15rem 0.35rem; border-radius: 4px; transition: background 0.15s;
}
.breadcrumb-item:hover { background: #1e293b; }
.breadcrumb-actual { color: #94a3b8; cursor: default; }
.breadcrumb-actual:hover { background: transparent; }
.breadcrumb-sep { color: #475569; font-size: 0.9rem; }

.btn-volver-wrap { margin-bottom: 1rem; }
.btn-volver {
  background: #334155; color: #94a3b8; border: none; border-radius: 8px;
  padding: 0.4rem 0.9rem; font-size: 0.85rem; cursor: pointer;
}
.btn-volver:hover { background: #3b82f620; color: #60a5fa; }

.btn-accion { background: #334155; padding: 0.5rem 1rem; font-size: 0.85rem; border-radius: 8px; border: none; color: #e2e8f0; cursor: pointer; }
.btn-accion:hover { background: #475569; }
.btn-subir { background: #3b82f6; padding: 0.5rem 1rem; font-size: 0.85rem; border-radius: 8px; border: none; color: white; cursor: pointer; }

.notificacion { padding: 0.75rem 1rem; border-radius: 8px; margin-bottom: 1rem; font-size: 0.9rem; }
.notificacion.error { background: #7f1d1d; color: #fca5a5; }

.lista-archivos { display: flex; flex-direction: column; gap: 0.5rem; }
.archivo-fila {
  display: flex; justify-content: space-between; align-items: center;
  padding: 0.75rem 1rem; background: #1e293b; border-radius: 8px;
  border: 1px solid #334155;
}
.archivo-fila:hover { background: #1e293b33; }
.carpeta-fila { cursor: pointer; border-color: #4a5568; }
.carpeta-fila:hover { border-color: #60a5fa; background: #1e3a5f22; }

.archivo-fecha { font-size: 0.75rem; color: #64748b; }

.btn-mini { padding: 0.25rem 0.5rem; font-size: 0.75rem; border-radius: 6px; background: #334155; border: none; cursor: pointer; color: white; }
.btn-mini-danger { background: #7f1d1d; }

.invitar-box {
  background: #1e293b; border: 1px solid #334155; border-radius: 10px;
  padding: 1.25rem; margin-bottom: 1.5rem; display: flex; flex-direction: column; gap: 0.75rem;
}
.invitar-box input[type="text"] {
  padding: 0.65rem 0.75rem; background: #0f172a; border: 1px solid #334155;
  border-radius: 8px; color: #e2e8f0; font-size: 0.9rem;
}
.permisos-check { display: flex; gap: 1rem; flex-wrap: wrap; }
.permisos-check label { display: flex; align-items: center; gap: 0.35rem; font-size: 0.85rem; color: #94a3b8; cursor: pointer; }
.error-inline { color: #f87171; font-size: 0.82rem; }
.btn-invitar { background: #3b82f6; color: white; border: none; border-radius: 8px; padding: 0.6rem 1.25rem; cursor: pointer; font-size: 0.9rem; align-self: flex-start; }
.btn-invitar:disabled { opacity: 0.6; cursor: not-allowed; }

.lista-miembros { display: flex; flex-direction: column; gap: 0.5rem; }
.miembro-fila {
  display: flex; align-items: center; gap: 1rem;
  background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 0.75rem 1rem;
}
.miembro-info { flex: 1; }
.miembro-nombre { font-size: 0.9rem; color: #e2e8f0; display: block; }
.miembro-email { font-size: 0.75rem; color: #64748b; }
.miembro-permisos { display: flex; gap: 0.75rem; }
.miembro-permisos label { display: flex; align-items: center; gap: 0.25rem; font-size: 0.85rem; color: #94a3b8; cursor: pointer; }
.btn-revocar { background: #7f1d1d; color: white; border: none; border-radius: 6px; padding: 0.3rem 0.75rem; font-size: 0.8rem; cursor: pointer; }

.zona-peligro {
  margin-top: 2.5rem; border: 1px solid #7f1d1d; border-radius: 10px;
  padding: 1.25rem; background: #1c0a0a;
}
.zona-peligro h3 { color: #f87171; margin-bottom: 0.5rem; }
.zona-peligro p { color: #94a3b8; font-size: 0.85rem; margin-bottom: 1rem; }
.btn-eliminar-boveda { background: #dc2626; color: white; border: none; border-radius: 8px; padding: 0.6rem 1.25rem; cursor: pointer; }

.vacio { text-align: center; color: #475569; padding: 4rem 2rem; font-size: 1rem; line-height: 2; }

.modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.6);
  display: flex; align-items: center; justify-content: center; z-index: 100;
}
.modal {
  background: #1e293b; border: 1px solid #334155; border-radius: 14px;
  padding: 2rem; width: 400px; display: flex; flex-direction: column; gap: 0.85rem;
  max-height: 85vh; overflow-y: auto;
}
.modal-permisos { width: 480px; }
.modal h3 { color: #60a5fa; margin-bottom: 0.25rem; }
.modal-sub { font-size: 0.8rem; color: #64748b; margin-top: -0.5rem; }
.modal input[type="text"] {
  padding: 0.75rem; border-radius: 8px; border: 1px solid #334155;
  background: #0f172a; color: #e2e8f0; font-size: 0.9rem;
}
.error-modal { color: #f87171; font-size: 0.85rem; }
.modal-acciones { display: flex; gap: 0.75rem; justify-content: flex-end; margin-top: 0.5rem; }
.btn-cancelar { background: #334155; border: none; border-radius: 8px; padding: 0.6rem 1rem; color: #e2e8f0; cursor: pointer; }
.btn-crear { background: #3b82f6; border: none; border-radius: 8px; padding: 0.6rem 1rem; color: white; cursor: pointer; }
.btn-crear:disabled { opacity: 0.6; cursor: not-allowed; }

.permiso-form { background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 1rem; display: flex; flex-direction: column; gap: 0.6rem; }
.lista-permisos-carpeta { display: flex; flex-direction: column; gap: 0.5rem; margin-top: 0.5rem; }
.permiso-sub-label { font-size: 0.78rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; }
.permiso-fila {
  display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;
  background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 0.6rem 0.85rem;
}
.permiso-badges { display: flex; gap: 0.25rem; }
.badge-p { font-size: 0.85rem; }
</style>