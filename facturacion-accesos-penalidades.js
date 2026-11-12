/* Extensión independiente: acceso de usuarios EXISTENTES a Facturación desde Penalidades.
 * No requiere service_role y usa la sesión existente v16-replica-auth. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const prefix = 'factPerm';
  let client = null;
  let currentUserId = null;
  let selectedUserId = null;
  let isAdmin = false;
  let members = [];
  const norm = (value) => String(value || '').trim().toUpperCase().replace(/\.PDV$/i, '');
  const errorText = (e) => e?.message || String(e);
  const memberRole = ['ADMINISTRADOR', 'ENCARGADO', 'PDV'];
  function status(message, fail = false) {
    const el = $(prefix + 'Status');
    if (el) { el.textContent = message; el.style.color = fail ? '#b42318' : '#166534'; }
  }
  function visible(show) {
    const btn = $(prefix + 'Open');
    if (btn) btn.hidden = !show;
  }
  function showLink(show) {
    const link = $(prefix + 'Go');
    if (link) link.hidden = !show;
  }
  function build() {
    if ($(prefix + 'Open')) return;
    const toolbar = document.querySelector('.top-actions') || document.querySelector('header .actions');
    if (!toolbar) return;
    const button = document.createElement('button');
    button.type = 'button'; button.id = prefix + 'Open';
    button.className = 'btn'; button.hidden = true;
    button.textContent = '👤 Accesos a Facturación';
    toolbar.appendChild(button);
    const link = document.createElement('a');
    link.id = prefix + 'Go'; link.className = 'btn'; link.hidden = true;
    link.href = './facturacion.html'; link.textContent = '💰 Ir a Facturación';
    toolbar.appendChild(link);
    const style = document.createElement('style');
    style.textContent = `
      #factPermModal[hidden]{display:none!important}
      #factPermModal{position:fixed;inset:0;background:rgba(15,23,42,.66);z-index:9999;display:grid;place-items:center;padding:18px}
      #factPermPanel{box-sizing:border-box;width:min(720px,100%);max-height:90vh;overflow:auto;background:#fff;color:#1e293b;border-radius:12px;padding:22px;box-shadow:0 10px 32px #0004;font:14px/1.45 Segoe UI,Arial,sans-serif}
      #factPermPanel h2{margin:0 0 4px;font-size:20px}
      #factPermPanel p{margin:3px 0 12px;color:#64748b;font-size:13px}
      #factPermPanel label{display:block;font-weight:600;font-size:12px;margin:9px 0 3px}
      #factPermPanel input,#factPermPanel select{box-sizing:border-box;width:100%;padding:9px;border:1px solid #cbd5e1;border-radius:7px;background:white;color:#111827;font:inherit}
      #factPermPanel input[type=checkbox]{width:auto;margin-right:6px}
      #factPermPanel button{border:1px solid #cbd5e1;border-radius:7px;padding:8px 12px;background:#fff;color:#1e293b;cursor:pointer;font-weight:600}
      #factPermPanel button.primary{background:#e97625;color:#fff;border-color:#e97625}
      #factPermPanel button:disabled{opacity:.4;cursor:default}
      #factPermPanel .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
      #factPermPanel .line{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
      #factPermPanel .tools{display:flex;gap:8px;align-items:end;flex-wrap:wrap;margin:10px 0}
      #factPermPanel .tools button{white-space:nowrap}
      #factPermPanel .tools label{flex:1;margin:0}
      #factPermStatus{min-height:20px;font-size:12px;white-space:pre-wrap}
      #factPermPanel small{display:block;color:#64748b;margin-top:6px}
      #factPermPanel table{border-collapse:collapse;width:100%;font-size:12px}
      #factPermPanel td,#factPermPanel th{text-align:left;border-bottom:1px solid #e2e8f0;padding:6px}
      #factPermPanel td:last-child{text-align:right}
      @media(max-width:600px){#factPermPanel .grid{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
    const modal = document.createElement('div');
    modal.id = prefix + 'Modal'; modal.hidden = true;
    modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', prefix + 'Title');
    // Static markup, no user content interpolated.
    modal.innerHTML = `<div id="factPermPanel">
      <div class="line"><h2 id="factPermTitle">Autorizar usuarios para Facturación</h2><button type="button" id="factPermClose">Cerrar ✕</button></div>
      <p>Usa la misma cuenta de Penalidades. Busca su correo de inicio de sesión y define qué PDV podrá consultar en Facturación.</p>
      <form id="factPermForm">
        <div class="tools"><label>Correo del usuario (ya existe en Supabase Auth)
          <input id="factPermEmail" type="text" autocomplete="off" placeholder="usuario@empresa.com" required></label>
          <button type="button" id="factPermFind">Buscar cuenta</button></div>
        <p id="factPermFound">Primero busca al usuario.</p>
        <div class="grid">
          <label>Rol de Facturación<select id="factPermRole"><option value="PDV">PDV (consulta)</option><option value="ENCARGADO">Encargado (consulta)</option><option value="ADMINISTRADOR">Administrador (acceso total)</option></select></label>
          <label>Estado de acceso<select id="factPermActive"><option value="true">Habilitado</option><option value="false">Deshabilitado</option></select></label>
        </div>
        <label>PDV autorizados (separados por coma o salto de línea)
          <input id="factPermPDVs" placeholder="UCA-02, UCA-04" autocomplete="off"></label>
        <small>El rol administrador tiene acceso a todos los PDV y puede modificar tarifas. Los demás roles deben tener al menos un PDV.</small>
        <div class="tools"><button type="submit" class="primary" id="factPermSave" disabled>Guardar acceso</button>
          <a href="./facturacion.html" target="_blank" rel="noopener">Abrir Facturación</a></div>
        <div id="factPermStatus" role="status" aria-live="polite"></div>
      </form>
      <hr><div class="line"><strong>Usuarios habilitados en Facturación</strong><button type="button" id="factPermRefresh">Actualizar</button></div>
      <div style="overflow:auto"><table><thead><tr><th>UID</th><th>Rol</th><th>PDV</th><th>Activo</th></tr></thead><tbody id="factPermList"></tbody></table></div>
    </div>`;
    document.body.appendChild(modal);
    button.addEventListener('click', async () => {
      if (!isAdmin) return;
      modal.hidden = false;
      $('factPermEmail').focus();
      await loadMembers();
    });
    $('factPermClose').addEventListener('click', () => { modal.hidden = true; });
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) modal.hidden = true; });
    $('factPermFind').addEventListener('click', findAccount);
    $('factPermEmail').addEventListener('input', () => { selectedUserId = null; $('factPermSave').disabled = true; $('factPermFound').textContent = 'Busca esta cuenta antes de guardar.'; });
    $('factPermForm').addEventListener('submit', saveAccess);
    $('factPermRefresh').addEventListener('click', loadMembers);
  }
  async function getClient() {
    if (client) return client;
    const cfg = window.V16_CONFIG;
    if (!cfg?.url || !cfg?.key || !window.supabase?.createClient) throw Error('Falta config.js o supabase-js.');
    client = window.supabase.createClient(cfg.url, cfg.key, {
      auth: {storageKey: 'v16-replica-auth', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false}
    });
    client.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') { isAdmin = false; currentUserId = null; selectedUserId = null; visible(false); showLink(false); if ($('factPermModal')) $('factPermModal').hidden = true; }
    });
    return client;
  }
  async function initialize() {
    build();
    try {
      const c = await getClient();
      const {data: userData, error: userError} = await c.auth.getUser();
      if (userError || !userData?.user) return;
      currentUserId = userData.user.id;
      const {data, error} = await c.from('facturacion_usuarios').select('rol,activo')
        .eq('user_id', currentUserId).maybeSingle();
      if (error) throw error;
      isAdmin = !!data?.activo && data.rol === 'ADMINISTRADOR';
      visible(isAdmin);
      showLink(!!data?.activo);
    } catch (e) { console.warn('[Accesos Facturación]', errorText(e)); }
  }
  async function loadMembers() {
    if (!isAdmin) return;
    const list = $('factPermList');
    list.replaceChildren();
    const {data, error} = await client.from('facturacion_usuarios')
      .select('user_id,rol,pdvs,activo,actualizado_en').order('actualizado_en', {ascending:false}).limit(200);
    if (error) { status('Error consultando accesos: ' + error.message, true); return; }
    members = data || [];
    for (const user of members) {
      const tr = document.createElement('tr');
      for (const val of [user.user_id, user.rol, (user.pdvs || []).join(', '), user.activo ? 'Sí' : 'No']) {
        const td = document.createElement('td'); td.textContent = val; tr.appendChild(td);
      }
      list.appendChild(tr);
    }
  }
  async function findAccount() {
    selectedUserId = null; $('factPermSave').disabled = true;
    const entered = $('factPermEmail').value.trim().toLowerCase();
    const domain = String(window.V16_CONFIG?.loginDomain || '').replace(/^@/, '').trim().toLowerCase();
    const email = entered.includes('@') ? entered : (entered && domain ? entered + '@' + domain : '');
    if (!email) return status('Escribe un correo completo, o un usuario si el portal tiene loginDomain configurado.', true);
    $('factPermFind').disabled = true; status('Buscando cuenta…');
    try {
      const {data, error} = await client.rpc('facturacion_buscar_usuario_existente', {p_correo: email});
      if (error) throw error;
      const user = data?.[0];
      if (!user?.user_id) throw Error('No se encontró esa cuenta en Supabase Auth. Debe existir antes de asignar el acceso.');
      selectedUserId = user.user_id;
      const existing = members.find(x => x.user_id === selectedUserId);
      $('factPermFound').textContent = 'Cuenta encontrada: ' + user.correo + ' · UID ' + user.user_id;
      $('factPermRole').value = existing?.rol || 'PDV';
      $('factPermPDVs').value = (existing?.pdvs || []).join(', ');
      $('factPermActive').value = String(existing?.activo !== false);
      $('factPermSave').disabled = false;
      status(existing ? 'Cuenta ya autorizada. Puedes actualizar o deshabilitar su acceso.' : 'Cuenta encontrada; asigna el rol y sus PDV.');
    } catch (e) { $('factPermFound').textContent = 'Cuenta sin seleccionar'; status(errorText(e), true); }
    finally { $('factPermFind').disabled = false; }
  }
  async function saveAccess(e) {
    e.preventDefault();
    if (!isAdmin || !selectedUserId) return status('Primero busca una cuenta válida.', true);
    const rol = $('factPermRole').value;
    const activo = $('factPermActive').value === 'true';
    if (!memberRole.includes(rol)) return status('Rol no reconocido.', true);
    const pdvs = [...new Set($('factPermPDVs').value.split(/[,;\n]+/).map(norm).filter(Boolean))];
    if (rol !== 'ADMINISTRADOR' && !pdvs.length) return status('Indica uno o más PDV para el usuario (requerido incluso si está deshabilitado).', true);
    if (selectedUserId === currentUserId && (rol !== 'ADMINISTRADOR' || !activo)) return status('No puedes quitarte tu propio acceso administrativo.', true);
    if (rol === 'ADMINISTRADOR' && !window.confirm('Este rol permite modificar tarifas, tiempos y publicar cierres para TODOS los PDV. ¿Confirmas?')) return;
    const save = $('factPermSave'); save.disabled = true; status('Guardando en Supabase…');
    try {
      const record = {user_id:selectedUserId,rol,pdvs:rol === 'ADMINISTRADOR' ? [] : pdvs,activo,actualizado_en:new Date().toISOString()};
      const {error} = await client.from('facturacion_usuarios').upsert(record,{onConflict:'user_id'});
      if (error) throw error;
      status('Acceso guardado. El usuario puede abrir Facturación con la misma cuenta de Penalidades.');
      await loadMembers();
    } catch (e) { status('No se pudo guardar: ' + errorText(e), true); }
    finally { save.disabled = false; }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, {once:true});
  else initialize();
})();
