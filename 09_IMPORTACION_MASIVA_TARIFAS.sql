-- FACTURACION PDV V2.9 · IMPORTACION MASIVA DE TARIFAS ZONALES
-- Ejecutar como postgres en Supabase SQL Editor, despues de la migracion 01.
-- No reemplaza tablas, no toca liquidaciones finalizadas y conserva tarifas no incluidas.
-- Una llamada = una transaccion: si algo falla, no se aplica ningun PDV del lote.
BEGIN;
CREATE OR REPLACE FUNCTION public.facturacion_importar_tarifas_masivo(
  p_periodo text,
  p_tarifas jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_item jsonb;
  v_pdv text;
  v_zones jsonb;
  v_ubigeos jsonb;
  v_datos jsonb;
  v_k text;
  v_v jsonb;
  v_mode text;
  v_standard numeric;
  v_pdv_count integer := 0;
  v_zone_count integer := 0;
BEGIN
  IF NOT (SELECT facturacion_private.es_admin()) THEN
    RAISE EXCEPTION 'Solo el administrador activo de Facturacion puede importar tarifas';
  END IF;
  IF p_periodo IS NULL OR p_periodo !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'Periodo de facturacion invalido';
  END IF;
  IF p_tarifas IS NULL OR jsonb_typeof(p_tarifas) <> 'array'
     OR jsonb_array_length(p_tarifas) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'La carga requiere entre 1 y 500 PDV por operacion';
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_tarifas) LOOP
    v_pdv := upper(btrim(coalesce(v_item->>'pdv', '')));
    IF v_pdv !~ '^[A-Z0-9][A-Z0-9_.-]{1,50}$' THEN
      RAISE EXCEPTION 'PDV invalido: %',v_pdv;
    END IF;
    v_zones := coalesce(v_item->'zones', '{}'::jsonb);
    v_ubigeos := coalesce(v_item->'ubigeos', '{}'::jsonb);
    IF jsonb_typeof(v_zones) <> 'object' OR jsonb_typeof(v_ubigeos) <> 'object' THEN
      RAISE EXCEPTION 'El mapa de zonas/UBIGEO no es valido para %',v_pdv;
    END IF;
    IF (SELECT count(*) FROM jsonb_each(v_zones))>5000 THEN
      RAISE EXCEPTION 'Demasiadas zonas en un solo PDV: %',v_pdv;
    END IF;
    FOR v_k,v_v IN SELECT key,value FROM jsonb_each(v_zones) LOOP
      IF cardinality(string_to_array(v_k,'|'))<>3 OR length(v_k)>250
         OR v_k<>upper(btrim(v_k)) OR jsonb_typeof(v_v)<>'number' THEN
        RAISE EXCEPTION 'Distrito o monto invalido en % / %',v_pdv,v_k;
      END IF;
      IF v_v::text::numeric < 0 OR v_v::text::numeric > 100000
         OR v_v::text::numeric <> round(v_v::text::numeric, 2) THEN
        RAISE EXCEPTION 'Tarifa invalida en % / %',v_pdv,v_k;
      END IF;
      v_zone_count:=v_zone_count+1;
    END LOOP;
    IF v_item ? 'standard' THEN
      IF jsonb_typeof(v_item->'standard') <> 'number' THEN
        RAISE EXCEPTION 'Tarifa estandar invalida para %',v_pdv;
      END IF;
      v_standard := (v_item->>'standard')::numeric;
      IF v_standard<0 OR v_standard>100000 OR v_standard<>round(v_standard,2) THEN
        RAISE EXCEPTION 'Tarifa estandar fuera de rango para %',v_pdv;
      END IF;
    END IF;
    IF NOT (v_item ? 'standard') AND v_zones='{}'::jsonb THEN
      RAISE EXCEPTION 'El PDV % no contiene tarifas a importar',v_pdv;
    END IF;
    v_mode := upper(coalesce(v_item->>'mode',''));
    IF v_mode<>'' AND v_mode NOT IN ('ESTANDAR','ZONAL') THEN
      RAISE EXCEPTION 'Modalidad de PDV invalida: %',v_pdv;
    END IF;
    IF v_mode='ESTANDAR' AND v_zones<>'{}'::jsonb THEN
      -- Una tarifa zonal explicita debe quedar aplicable, no oculta por modalidad.
      v_mode:='ZONAL';
    ELSIF v_mode='' AND v_zones<>'{}'::jsonb THEN
      v_mode:='ZONAL';
    END IF;
    v_datos := jsonb_build_object('zones',v_zones,'ubigeos',v_ubigeos,'updatedAt',now());
    IF v_mode<>'' THEN v_datos:=v_datos||jsonb_build_object('mode',v_mode);END IF;
    IF v_item ? 'standard' THEN v_datos:=v_datos||jsonb_build_object('standard',v_standard);END IF;

    INSERT INTO public.facturacion_tarifas(periodo,pdv,datos)
    VALUES(p_periodo,v_pdv,v_datos)
    ON CONFLICT(periodo,pdv) DO UPDATE SET
      datos = public.facturacion_tarifas.datos || EXCLUDED.datos ||
          jsonb_build_object(
            'zones', coalesce(public.facturacion_tarifas.datos->'zones','{}'::jsonb)
                     || coalesce(EXCLUDED.datos->'zones','{}'::jsonb),
            'ubigeos', coalesce(public.facturacion_tarifas.datos->'ubigeos','{}'::jsonb)
                        || coalesce(EXCLUDED.datos->'ubigeos','{}'::jsonb)
          );
    v_pdv_count:=v_pdv_count+1;
  END LOOP;
  RETURN jsonb_build_object('pdvs',v_pdv_count,'zonas',v_zone_count,'periodo',p_periodo);
END $$;

REVOKE ALL ON FUNCTION public.facturacion_importar_tarifas_masivo(text,jsonb) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.facturacion_importar_tarifas_masivo(text,jsonb) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
