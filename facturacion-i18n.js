/* Facturación V2.4: Español / English / 简体中文.
   Traduce etiquetas de interfaz, NO datos de guías, nombres de PDV ni valores SQL. */
(function(root){'use strict';
 const KEY='facturacion_pdv_idioma';
 const translations={
  'Idioma':['Language','语言'],
  'SUPABASE AUTH · SIN SESIÓN':['SUPABASE AUTH · SIGNED OUT','SUPABASE AUTH · 未登录'],
  'Facturación PDV V2.4 · Supabase Auth y RLS · Borradores y cierres en Supabase; copia local en IndexedDB.':['PDV billing V2.4 · Supabase Auth/RLS · Cloud drafts and settlements; local IndexedDB cache.','PDV结算 V2.4 · Supabase Auth/RLS · 云端草稿与结算，本地IndexedDB缓存。'],
  'Facturación PDV V2.5 · Supabase Auth y RLS · Borradores y cierres en Supabase; copia local en IndexedDB.':['PDV billing V2.5 · Supabase Auth/RLS · Cloud drafts and settlements; local IndexedDB cache.','PDV结算 V2.5 · Supabase Auth/RLS · 云端草稿与结算，本地IndexedDB缓存。'],
  'Facturación':['Billing','结算'],
  'Facturación PDV · Liquidaciones multiusuario':['PDV billing · Multi-user settlements','PDV结算 · 多用户结算单'],
  'Tarifas, tiempos y liquidaciones · V2.4 · idiomas y borradores en Supabase':['Rates, delivery times and settlements · V2.4 · languages and cloud drafts','费率、时效与结算 · V2.4 · 多语言及云端草稿'],
  'Tarifas, tiempos y liquidaciones · V2.5 · selección masiva, tabla ampliada y borradores en Supabase':['Rates, time and settlement · V2.5 · bulk editing, expanded table and cloud drafts','费率、时效与结算 · V2.5 · 批量编辑、扩展表格与云端草稿'],
  'Salir':['Sign out','退出登录'],
  'Gestión de Guías':['Waybill Management','运单管理'],
  'Iniciar sesión':['Sign in','登录'],
  'Utiliza el mismo usuario y contraseña que en Gestión de Guías.':['Use your existing Waybill Management credentials.','使用运单管理平台的现有账号和密码。'],
  'Usuario o correo':['Username or email','用户名或邮箱'],
  'Contraseña':['Password','密码'],
  'Ingresar a Facturación':['Open Billing','进入结算'],
  'Liquidación operativa':['Operational settlement','运营结算'],
  'Importa MODULADOR.xlsx, establece los tiempos por distrito y PDV, configura las tarifas y calcula el pago por guía.':['Import MODULADOR.xlsx, set delivery times by district and PDV, configure rates and calculate each waybill payout.','导入 MODULADOR.xlsx，按地区和PDV设置时效、配置费率并计算每票运单费用。'],
  'Periodo de facturación':['Billing period','结算期间'],
  '＋ Cargar Excel local':['＋ Import Excel','＋ 导入Excel'],
  '⬇ Excel · selección':['⬇ Excel · selection','⬇ 导出所选Excel'],
  'Sin fuente cargada para el periodo.':['No source imported for this period.','该期间尚未导入数据源。'],
  'Sin registros':['No records','暂无记录'],
  'Configuración: pendiente de cargar':['Settings: not loaded yet','配置：尚未加载'],
  '☁ Guardar borrador en Supabase':['☁ Save draft to Supabase','☁ 保存草稿至Supabase'],
  '↥ Recuperar borrador Supabase':['↥ Restore Supabase draft','↥ 恢复Supabase草稿'],
  'Borrador remoto: sin consultar':['Cloud draft: not checked','云端草稿：未检查'],
  '⬇ Respaldar borrador de guías':['⬇ Download local draft backup','⬇ 下载本地草稿备份'],
  '↥ Restaurar respaldo':['↥ Restore backup','↥ 恢复备份'],
  'Las guías se guardan en Supabase Storage privado y se mantienen en el navegador como copia de trabajo. Los tiempos, tarifas y OK se sincronizan por periodo.':['Waybills are saved to private Supabase Storage, with a working copy in this browser. Times, rates and approvals sync by period.','运单保存于私有Supabase Storage，浏览器保留工作副本。时效、费率与审核按期间同步。'],
  'Guías del filtro':['Filtered waybills','筛选运单'],
  'Guías válidas':['Valid waybills','有效运单'],
  'Importe bruto':['Gross amount','总金额'],
  'Antes de descuentos':['Before deductions','扣减前'],
  'Descuentos':['Deductions','扣减金额'],
  'Reducción por exceso':['Late-delivery reduction','超时扣减'],
  'Neto a facturar':['Net payable','应付净额'],
  'Según configuración vigente':['Based on current settings','按当前设置'],
  'Sin cálculo':['Not calculated','未计算'],
  'Falta tiempo o tarifa':['Missing time or rate','缺少时效或费率'],
  'Filtros de visualización y exportación':['Display and export filters','显示与导出筛选'],
  'La tabla, los indicadores y el Excel utilizan exactamente los mismos PDV y destinos seleccionados.':['Table, KPIs and Excel use the same selected PDVs and destinations.','表格、指标和Excel使用相同的所选PDV和目的地。'],
  'Limpiar filtros':['Clear filters','清除筛选'],
  'Departamento':['Department','大区'],
  'Todos':['All','全部'],
  'Todas':['All','全部'],
  'Provincia':['Province','省/市'],
  'Distrito':['District','区县'],
  'Buscar guía o PDV':['Find waybill or PDV','搜索运单或PDV'],
  'PDV (selección múltiple)':['PDV (multi-select)','PDV（多选）'],
  'Todos los PDV':['All PDVs','全部PDV'],
  'Importa un Excel para seleccionar PDV':['Import an Excel file to select PDVs','导入Excel后选择PDV'],
  'Resumen por distrito':['District summary','区县汇总'],
  'Detalle de guías':['Waybill detail','运单明细'],
  'Tarifario PDV':['PDV rates','PDV费率'],
  'Reglas y umbrales':['Rules and thresholds','规则与阈值'],
  'Historial y cierre':['History and finalization','历史记录与结算锁定'],
  'Liquidaciones compartidas':['Shared settlements','共享结算单'],
  'Accesos y PDV':['Access and PDVs','权限与PDV'],
  'Resumen de tiempos y facturación':['Time and billing summary','时效与结算汇总'],
  '0 filas seleccionadas':['0 rows selected','已选择0行'],
  'Seleccionar página':['Select page','选择本页'],
  'Seleccionar todas las filtradas':['Select all filtered','选择全部筛选结果'],
  'Quitar selección':['Clear selection','清除所选'],
  'Configurar selección (0)':['Configure selection (0)','批量配置（0）'],
  'Vista compacta':['Compact view','紧凑视图'],
  'Vista normal':['Normal view','标准视图'],
  'Ampliar tabla':['Expand table','放大表格'],
  'Cerrar vista ampliada':['Close expanded view','关闭放大视图'],
  'Configurar tiempos en varias filas':['Configure times for multiple rows','批量配置多行时效'],
  'Seleccionar las filas de esta página':['Select rows on this page','选择本页所有行'],
  'Aplicar':['Apply','应用'],
  'Marca «Aplicar» únicamente en los campos que deseas modificar. Los demás valores de cada fila permanecerán intactos. Si marcas «Aplicar» y dejas el valor vacío, borrarás ese campo en todas las filas elegidas.':['Check Apply only for fields you want to change. Other values remain unchanged. Checked blank fields will be cleared for all selected rows.','仅勾选需修改字段的“应用”。其余字段保持不变。勾选后留空会清除所有所选行该字段。'],
  'Vacío = borrar valor':['Blank = clear value','留空=清除数值'],
  'Vacío = borrar observaciones':['Blank = clear notes','留空=清除备注'],
  'Esta operación actualiza los tiempos compartidos en Supabase y requiere revisar nuevamente los OK que correspondan.':['Updates shared times in Supabase and invalidates affected approvals.','此操作将更新Supabase共享时效，并使受影响的审核需要重新确认。'],
  'Guardar cambios masivos':['Save bulk changes','保存批量修改'],

  'Una fila por distrito y PDV. Pulsa':['One row per district and PDV. Click','每个区县与PDV一行。点击'],
  'Configurar':['Configure','配置'],
  'para registrar tiempos y observaciones.':['to set times and notes.','设置时效和备注。'],
  'Muestra mínima (10 guías)':['Minimum sample (10 waybills)','最小样本（10票）'],
  'Con muestra suficiente':['Sufficient sample','样本充足'],
  'Sin muestra suficiente':['Insufficient sample','样本不足'],
  'Mejor PDV':['Fastest PDV','最快PDV'],
  'Sin mejor PDV':['No eligible PDV','无合格PDV'],
  'Revisión OK':['Reviewed (OK)','审核状态'],
  'Con OK':['Approved','已审核'],
  'Sin OK':['Not approved','未审核'],
  'Umbral establecido':['Assigned threshold','设定阈值'],
  'Todos los umbrales':['All thresholds','全部阈值'],
  'Sin umbral':['Without threshold','无阈值'],
  'Tiempo establecido':['Assigned time','设定时效'],
  'Con dato':['With value','有数据'],
  'Sin dato':['Missing value','无数据'],
  'Tarifa':['Rate','费率'],
  'Con tarifa':['With rate','已设费率'],
  'Sin tarifa':['Missing rate','未设费率'],
  'Observaciones':['Notes','备注'],
  'Con observación':['With notes','有备注'],
  'Sin observación':['Without notes','无备注'],
  'Limpiar revisión':['Clear review filters','清除审核筛选'],
  'Umbral de simulación (h)':['Simulation threshold (h)','模拟阈值（小时）'],
  'Prueba 48, 72, 96 o cualquier número positivo de horas. Se mantienen las mismas tarifas, reducciones y exceso máximo.':['Try 48, 72, 96 or any positive number of hours. Rates, reductions and maximum excess stay unchanged.','可输入48、72、96或任意正数小时；费率、扣减比例及最大超时限制不变。'],
  'Solo comparación: no cambia el neto real, los OK ni las liquidaciones guardadas.':['Comparison only: actual net, approvals and saved settlements do not change.','仅用于比较：不改变实际净额、审核或已保存结算单。'],
  'Neto simulado: —':['Simulated net: —','模拟净额：—'],
  'Los filtros también se aplican a los indicadores, el detalle y el Excel del periodo. El OK se guarda en Supabase y se invalida cuando cambian los datos revisados. La simulación usa únicamente las guías con neto real calculado, para comparar los mismos casos.':['Filters also affect KPIs, detail and period Excel. OK is stored in Supabase and invalidated if reviewed values change. Simulation compares only waybills with an actual net payout.','筛选也适用于指标、明细和期间Excel。审核结果存于Supabase；审核数据变化后需重新确认。模拟仅比较已计算实际净额的运单。'],
  'Guías':['Waybills','运单数'],
  'Promedio logrado':['Average actual time','实际平均时效'],
  'Mejor tiempo':['Fastest average','最佳平均时效'],
  'Umbral':['Threshold','阈值'],
  'Consolidación':['Consolidation','集货'],
  'Retraslado':['Transfer','转运'],
  'Adicional':['Additional','额外时间'],
  'Necesario despacho':['Dispatch time','派送所需时间'],
  'Tarifa / tipo':['Rate / type','费率/类型'],
  'Bruto':['Gross','原始金额'],
  'Neto simulación 48 h':['Simulation net 48 h','48小时模拟净额'],
  'Diferencia vs 48 h':['Difference vs 48 h','与48小时差额'],
  'Neto':['Net','净额'],
  'Acción':['Action','操作'],
  'Carga el archivo de guías para comenzar.':['Import waybills to begin.','导入运单文件以开始。'],
  'Anterior':['Previous','上一页'],
  'Siguiente':['Next','下一页'],
  'Incluye exceso, tarifa aplicable, reducción y monto final. Los registros pendientes no se facturan automáticamente.':['Shows excess time, rate, reduction and net amount. Pending items are not billed automatically.','显示超时时间、适用费率、扣减和最终金额；待处理记录不会自动结算。'],
  'Estado':['Status','状态'],
  'Calculados':['Calculated','已计算'],
  'Sin tiempo base':['Missing base time','无基准时效'],
  'Pago cero por exceso':['Zero payout due to delay','超时不支付'],
  'Guía':['Waybill','运单号'],
  'Día reparto':['Delivery date','派送日期'],
  'Tiempo logrado':['Actual time','实际时效'],
  'Exceso':['Excess','超时'],
  '% reducción':['Reduction %','扣减比例'],
  '% pago':['Payout %','支付比例'],
  'Monto descuento':['Deduction amount','扣减金额'],
  'Tarifario por PDV':['Rates by PDV','PDV费率表'],
  'La tarifa zonal prevalece sobre la estándar. Los demás distritos conservan la tarifa estándar del PDV.':['District-specific rates override standard rates. Other districts use the PDV standard rate.','区县专属费率优先于标准费率，其他地区采用PDV标准费率。'],
  'Valores en soles · S/':['Values in Peruvian soles · S/','金额单位：秘鲁索尔 S/'],
  'Tipo':['Type','类型'],
  'Tarifa estándar / respaldo':['Standard / fallback rate','标准/默认费率'],
  'Distritos con excepción':['District exceptions','例外区县'],
  'Carga el Excel para identificar los PDV.':['Import Excel to identify PDVs.','导入Excel识别PDV。'],
  'Reglas globales de facturación':['Global billing rules','结算全局规则'],
  'Configuración para liquidaciones futuras. El historial finalizado conserva los valores con los que fue calculado.':['Settings for future settlements. Finalized history retains its original calculation settings.','用于未来结算的设置；已完成结算保留原始计算参数。'],
  'Descuento escalonado':['Tiered reductions','阶梯扣减'],
  'Reducción por bloque (%)':['Reduction per block (%)','每档扣减比例（%）'],
  'Horas por bloque':['Hours per block','每档小时数'],
  'Exceso máximo permitido (h)':['Maximum excess allowed (h)','最大允许超时（小时）'],
  'Mínimo para elegir mejor PDV':['Minimum waybills for fastest PDV','评选最快PDV的最少运单数'],
  'Periodo de referencia para el mejor tiempo':['Reference period for fastest time','最佳时效参考期间'],
  'Si no eliges otro periodo, se utiliza el mismo mes de la liquidación.':['If none is selected, the billing month is used.','不选择其他期间时，使用当前结算月份。'],
  'Guardar y recalcular':['Save and recalculate','保存并重新计算'],
  'Cómo se descuenta':['How deductions work','扣减规则说明'],
  'Si el tiempo logrado no supera el':['If actual time does not exceed the','若实际时效不超过'],
  'umbral establecido':['assigned threshold','设定阈值'],
  ', se paga 100%.':[', payout is 100%.','，支付100%。'],
  'Al superarlo, se reduce 10% inmediatamente. En cada frontera adicional de 24 horas se descuenta otro 10%.':['Once exceeded, payout drops by 10% immediately. Each additional 24-hour boundary subtracts another 10%.','一旦超过阈值立即扣减10%；每跨过额外24小时，再扣减10%。'],
  'Si el':['If','如果'],
  'exceso supera 120 horas':['excess exceeds 120 hours','超时超过120小时'],
  '(valor configurable), el pago es 0%.':['(configurable), payout is 0%.','（可配置），支付为0%。'],
  'Exactamente al límite máximo todavía se aplica el descuento escalonado. El 0% por máximo se activa cuando el exceso es':['At the exact excess limit, tiered reductions still apply. Zero payout activates only when excess is','恰好达到最大超时上限时仍按阶梯扣减；仅当超时'],
  'mayor':['greater than','大于'],
  'al límite.':['the limit.','上限时才支付0%。'],
  'Cierre e historial':['Finalization and history','结算锁定与历史'],
  'Las liquidaciones finalizadas se guardan como versiones independientes y no se recalculan al cambiar tarifas o tiempos.':['Finalized settlements keep independent versions and do not recalculate when rates or times change.','已完成结算以独立版本保存；费率或时效变化不会重新计算。'],
  'Liquidación en borrador':['Draft settlement','结算草稿'],
  'Configura todas las tarifas y tiempos pendientes antes de finalizar la liquidación.':['Complete all pending rates and times before finalizing.','完成所有待设置费率和时效后再锁定结算。'],
  'Finalizar y congelar periodo':['Finalize and lock period','完成并锁定期间'],
  'Importar configuración local de V1':['Import local V1 settings','导入V1本地配置'],
  'Recargar configuración de Supabase':['Reload Supabase settings','重新加载Supabase配置'],
  'Todavía no hay liquidaciones finalizadas.':['No finalized settlements yet.','暂无已完成结算。'],
  'Las liquidaciones cerradas se publican en Supabase con versión y bloqueo de edición. Los borradores se guardan en Supabase Storage privado; los cierres finalizados son independientes.':['Finalized settlements are versioned and immutable in Supabase. Drafts are stored in private Supabase Storage.','已完成结算在Supabase中带版本且不可修改；草稿保存在私有Supabase Storage。'],
  'Consulta únicamente los PDV autorizados. Cada cierre conserva las tarifas y tiempos aplicados.':['View only authorized PDVs. Each finalized settlement retains its rates and times.','仅查看授权PDV；每次结算保留对应费率与时效。'],
  'Actualizar cierres':['Refresh settlements','刷新结算单'],
  'Liquidación':['Settlement','结算单'],
  'Sin cierres publicados':['No published settlements','暂无已发布结算'],
  'Todos los autorizados':['All authorized PDVs','全部授权PDV'],
  'Buscar guía':['Search waybill','搜索运单'],
  'Exportación':['Export','导出'],
  'Excel publicado · filtro':['Published Excel · filtered','已发布Excel · 筛选'],
  'Selecciona una liquidación finalizada.':['Select a finalized settlement.','请选择已完成的结算单。'],
  'Guías permitidas':['Authorized waybills','授权运单'],
  'Resumen publicado por distrito y PDV':['Published summary by district and PDV','按区县和PDV的已发布汇总'],
  'Promedio':['Average','平均'],
  'Sin resultados.':['No results.','无结果。'],
  'Detalle publicado':['Published detail','已发布明细'],
  'Reducción':['Reduction','扣减'],
  'Accesos y alcance de PDV':['Users and PDV scope','用户权限与PDV范围'],
  'Autoriza usuarios YA existentes en Supabase Auth utilizando su UID. Este módulo no crea cuentas nuevas.':['Authorize EXISTING Supabase Auth users by UID; no new accounts are created.','使用UID授权Supabase Auth中已有用户；不创建新账号。'],
  'User UID (Authentication > Users)':['User UID (Authentication > Users)','用户UID（Authentication > Users）'],
  'Rol':['Role','角色'],
  'Encargado':['Manager','负责人'],
  'Administrador':['Administrator','管理员'],
  'PDV autorizados (separados por coma)':['Authorized PDVs (comma-separated)','授权PDV（逗号分隔）'],
  'Acceso':['Access','访问权限'],
  'Habilitado':['Enabled','已启用'],
  'Deshabilitado':['Disabled','已停用'],
  'Guardar acceso':['Save access','保存权限'],
  'Los roles PDV y Encargado solo consultan liquidaciones finalizadas de sus PDV asignados. Únicamente Administrador puede cambiar tarifas, tiempos y publicar cierres.':['PDVs and managers can only view finalized settlements for their assigned PDVs. Administrators manage rates, times and finalizations.','PDV及负责人只能查看授权PDV的已完成结算；管理员可修改费率、时效并发布结算。'],
  'PDV autorizados':['Authorized PDVs','授权PDV'],
  'Cargando…':['Loading…','加载中…'],
  'Facturación PDV V2.3 · Supabase Auth y RLS · Borradores y cierres en Supabase; copia local en IndexedDB.':['PDV billing V2.4 · Supabase Auth/RLS · Cloud drafts and settlements; local IndexedDB cache.','PDV结算 V2.4 · Supabase Auth/RLS · 云端草稿与结算，本地IndexedDB缓存。'],
  'Configurar tiempos del PDV':['Set PDV times','配置PDV时效'],
  'Consolidación (h)':['Consolidation (h)','集货（小时）'],
  'Retraslado (h)':['Transfer (h)','转运（小时）'],
  'Tiempo adicional (h)':['Additional time (h)','额外时间（小时）'],
  'Tiempo necesario de despacho (h)':['Dispatch time needed (h)','派送所需时间（小时）'],
  'Referencia manual (si los cuatro componentes están vacíos)':['Manual reference (if all four fields are empty)','手动参考值（四项均为空时）'],
  'Cancelar':['Cancel','取消'],
  'Guardar tiempos':['Save times','保存时效'],
  'Modalidad':['Mode','计费模式'],
  'Estándar':['Standard','标准'],
  'Zonal':['District-specific','分区'],
  'Tarifa estándar (S/)':['Standard rate (S/)','标准费率（S/）'],
  'Tarifas especiales por distrito':['Special district rates','区县特殊费率'],
  'Solo se aplican a las localidades indicadas; los demás distritos usan la estándar.':['Only applies to listed districts; all others use the standard rate.','仅适用于列出的区县；其他地区采用标准费率。'],
  'Guardar tarifas':['Save rates','保存费率'],
  'Autorizar usuarios para Facturación':['Authorize Billing users','授权结算用户'],
  'Cerrar ✕':['Close ✕','关闭 ✕'],
  'Usa la misma cuenta de Penalidades. Busca su correo de inicio de sesión y define qué PDV podrá consultar en Facturación.':['Use the same Penalidades account. Find the email and select which PDVs this user can view in Billing.','使用与罚款模块相同的账号。通过邮箱查找用户并指定可在结算中查看的PDV。'],
  'Correo del usuario (ya existe en Supabase Auth)':['User email (existing in Supabase Auth)','用户邮箱（已存在于Supabase Auth）'],
  'Buscar cuenta':['Find account','查找账号'],
  'Primero busca al usuario.':['Find the user first.','请先查找用户。'],
  'Rol de Facturación':['Billing role','结算角色'],
  'PDV (consulta)':['PDV (read-only)','PDV（只读）'],
  'Encargado (consulta)':['Manager (read-only)','负责人（只读）'],
  'Administrador (acceso total)':['Administrator (full access)','管理员（完整权限）'],
  'Estado de acceso':['Access status','访问状态'],
  'PDV autorizados (separados por coma o salto de línea)':['Authorized PDVs (commas or new lines)','授权PDV（逗号或换行分隔）'],
  'El rol administrador tiene acceso a todos los PDV y puede modificar tarifas. Los demás roles deben tener al menos un PDV.':['Administrators can access all PDVs and edit rates. Other roles require at least one authorized PDV.','管理员可访问全部PDV并修改费率；其他角色必须至少拥有一个授权PDV。'],
  'Guardar acceso':['Save access','保存权限'],
  'Abrir Facturación':['Open Billing','打开结算'],
  'Usuarios habilitados en Facturación':['Authorized Billing users','已授权的结算用户'],
  'Actualizar':['Refresh','刷新'],
  '👤 Accesos a Facturación':['👤 Billing access','👤 结算权限'],
  '💰 Ir a Facturación':['💰 Open Billing','💰 进入结算'],
  'Borrador remoto: sin consultar':['Cloud draft: not checked','云端草稿：未检查'],
  'Cuenta sin seleccionar':['No account selected','未选择账号'],
  'Borrador local sin sincronizar':['Local draft not synchronized','本地草稿未同步'],
  'Sin muestra suficiente':['Insufficient sample','样本不足']
 };
 const dynamicPatterns=[
  [/^Borrador remoto v(\d+) recuperado · (\d+) guías$/, (v,n)=>[`Cloud draft v${v} restored · ${n} waybills`,`已恢复云端草稿 v${v} · ${n}票运单`]],
  [/^Borrador sincronizado v(\d+) · (\d+) guías$/, (v,n)=>[`Draft synced v${v} · ${n} waybills`,`草稿已同步 v${v} · ${n}票运单`]],
  [/^Guardado en Supabase · v(\d+) · (\d+) guías$/, (v,n)=>[`Saved to Supabase · v${v} · ${n} waybills`,`已保存至Supabase · v${v} · ${n}票运单`]],
  [/^Neto simulación ([-\d.,]+) h$/,h=>[`Simulation net ${h} h`,`模拟净额 ${h} 小时`]],
  [/^Diferencia vs ([-\d.,]+) h$/,h=>[`Difference vs ${h} h`,`与${h}小时差额`]],
  [/^Neto simulado:\s*(.+)$/,v=>[`Simulated net: ${v}`,`模拟净额：${v}`]],
  [/^([\d.,]+) filas · ([\d.,]+) guías · ([\d.,]+) con OK$/, (a,b,c)=>[`${a} rows · ${b} waybills · ${c} approved`,`${a}行 · ${b}票运单 · ${c}条已审核`]],
  [/^Sin fuente cargada para (.+)$/,p=>[`No source for ${p}`,`${p} 无数据源`]],
  [/^(\d+) filas seleccionadas$/,n=>[`${n} rows selected`,`已选择${n}行`]],
  [/^Configurar selección \(?(\d+)\)?$/,n=>[`Configure selection (${n})`,`批量配置（${n}）`]],
  [/^Borrador (.+)$/,v=>[`Draft ${v}`,`草稿 ${v}`]]
 ];
 let lang='es';
 try{lang=localStorage.getItem(KEY)||'es';}catch(_){/* disabled storage */}
 if(!['es','en','zh'].includes(lang))lang='es';
 const originals=new WeakMap(), attributes=new WeakMap();
 function translateText(input,language=lang){
  const text=String(input??'');if(language==='es')return text;
  const normalized=text.trim();const t=translations[normalized];
  if(t){const lead=text.match(/^\s*/)?.[0]||'',trail=text.match(/\s*$/)?.[0]||'';return lead+t[language==='en'?0:1]+trail;}
  for(const [re,fn] of dynamicPatterns){const m=normalized.match(re);if(m){const v=fn(...m.slice(1));return v[language==='en'?0:1];}}
  return text;
 }
 function translateMessage(text){return translateText(text);}
 function visitNode(node){
  if(node.nodeType!==3)return;
  const parent=node.parentElement;
  if(!parent||parent.closest('script,style,textarea,code,pre,[contenteditable="true"]'))return;
  let rec=originals.get(node),value=node.nodeValue;
  if(!rec||value!==rec.output){rec={original:value,output:value};originals.set(node,rec);}
  const converted=translateText(rec.original);
  if(converted!==value){rec.output=converted;node.nodeValue=converted;}
 }
 function visitElement(el){
  if(!el||el.nodeType!==1)return;
  const props=['title','placeholder','aria-label'];
  let dict=attributes.get(el);if(!dict){dict={};attributes.set(el,dict);}
  for(const name of props){
    const current=el.getAttribute(name);if(current===null)continue;
    if(!dict[name]||current!==dict[name].output)dict[name]={original:current,output:current};
    const converted=translateText(dict[name].original);
    if(converted!==current){dict[name].output=converted;el.setAttribute(name,converted);}
  }
 }
 function translateUi(scope){
   const billingMode=!!document.querySelector('#factLang');
   if(!scope){
     if(billingMode)scope=document.body;
     else{
       // En Penalidades traducir SOLO el complemento de accesos a Facturación.
       for(const id of ['factPermModal','factPermOpen','factPermGo']){
         const widget=document.getElementById(id);if(widget)translateUi(widget);
       }
       return;
     }
   }
   if(!billingMode && scope===document.body){
     for(const id of ['factPermModal','factPermOpen','factPermGo']){
       const widget=document.getElementById(id);if(widget)translateUi(widget);
     }
     return;
   }
   if(!billingMode){
     const el=scope.nodeType===1?scope:scope.parentElement;
     if(!el||!(el.closest?.('#factPermModal, #factPermOpen, #factPermGo')||['factPermModal','factPermOpen','factPermGo'].includes(el.id)))return;
   }
   if(!scope)return;const work=[scope];
   while(work.length){
     const n=work.pop();if(n.nodeType===3){visitNode(n);continue;}
     if(n.nodeType!==1)continue;
     if(['SCRIPT','STYLE','TEXTAREA'].includes(n.tagName))continue;
     visitElement(n);
     for(let p=n.lastChild;p;p=p.previousSibling)work.push(p);
   }
   document.documentElement.lang=lang==='zh'?'zh-CN':lang;
   document.querySelectorAll('select[data-fact-lang],#factLang').forEach(sel=>{if(sel.value!==lang)sel.value=lang;});
 }
 function setLanguage(value){
   if(!['es','en','zh'].includes(value))return;
   lang=value;
   try{localStorage.setItem(KEY,value);}catch(_){/* ignore */}
   translateUi();root.dispatchEvent(new CustomEvent('facturacion-languagechange',{detail:{language:value}}));
 }
 let pending=[],scheduled=false;
 function requestTranslate(el){pending.push(el);if(scheduled)return;scheduled=true;
   setTimeout(()=>{const current=pending;pending=[];scheduled=false;for(const n of current)translateUi(n);},40);
 }
 function initialize(){
   document.addEventListener('change',e=>{if(e.target.matches('select[data-fact-lang],#factLang'))setLanguage(e.target.value);});
   translateUi();
   const observer=new MutationObserver(list=>{
     for(const mut of list)for(const node of mut.addedNodes)if(node.nodeType===1||node.nodeType===3)requestTranslate(node);
   });
   observer.observe(document.body,{childList:true,subtree:true});
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialize,{once:true});else initialize();
 root.FacturacionI18n={getLanguage:()=>lang,setLanguage,translateUi,translateText,translateMessage};
})(window);
