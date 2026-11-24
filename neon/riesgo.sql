-- =====================================================================
-- Basurales Gran Resistencia — índice de riesgo ambiental y sanitario (v2)
-- Ejecutar DESPUÉS de schema.sql, en el SQL Editor de Neon.
--
-- Riesgo (0–100) = promedio ponderado de cuatro componentes (0–1):
--   1. Amenaza ............ tamaño, quemas y crecimiento (satélite; si no hay,
--                           se estima con el relevamiento vecinal)
--   2. Exposición ......... población, escuelas y centros de salud a < X m
--   3. Vulnerabilidad ..... cercanía a agua (lagunas, ríos, canales) y
--                           zonas inundables
--   4. Reportes vecinales . cantidad y persistencia de reportes en rojo cerca
--
-- Si una capa todavía no está cargada, ese factor queda "sin datos" y los
-- pesos se reparten entre los factores que sí tienen datos.
-- Los pesos y radios iniciales son provisorios: calibrar con AHP y casos reales.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Capas de contexto (se cargan desde QGIS, siempre en EPSG:4326)
-- ---------------------------------------------------------------------
create table if not exists public.capa_escuelas (
  id      bigserial primary key,
  nombre  text,
  geom    gis.geometry(Point, 4326) not null
);

create table if not exists public.capa_salud (
  id      bigserial primary key,
  nombre  text,
  geom    gis.geometry(Point, 4326) not null
);

-- Lagunas (polígonos), ríos y canales (líneas)
create table if not exists public.capa_agua (
  id      bigserial primary key,
  nombre  text,
  tipo    text,            -- laguna, rio, canal, riacho...
  regimen text,            -- perenne / intermitente
  capa    text,            -- capa de origen (IGN)
  geom    gis.geometry(Geometry, 4326) not null
);
-- Si la tabla ya existía de una versión anterior:
alter table public.capa_agua add column if not exists regimen text;
alter table public.capa_agua add column if not exists capa text;

create table if not exists public.capa_inundable (
  id      bigserial primary key,
  nivel   text,            -- p. ej. alto / medio, según la fuente
  geom    gis.geometry(Geometry, 4326) not null
);

-- Radios censales con población y viviendas
create table if not exists public.capa_poblacion (
  id         bigserial primary key,
  codigo     text,
  poblacion  integer not null,
  viviendas  integer,
  geom       gis.geometry(Geometry, 4326) not null
);

create index if not exists capa_escuelas_geom_idx  on public.capa_escuelas  using gist (geom);
create index if not exists capa_salud_geom_idx     on public.capa_salud     using gist (geom);
create index if not exists capa_agua_geom_idx      on public.capa_agua      using gist (geom);
create index if not exists capa_inundable_geom_idx on public.capa_inundable using gist (geom);
create index if not exists capa_poblacion_geom_idx on public.capa_poblacion using gist (geom);

-- ---------------------------------------------------------------------
-- 2. Resultados del análisis satelital (los carga el script de Earth Engine)
-- ---------------------------------------------------------------------
create table if not exists public.amenaza_satelital (
  reporte_id       uuid primary key references public.reportes (id) on delete cascade,
  area_m2          numeric,   -- superficie del basural detectada
  quemas_12m       integer,   -- quemas detectadas en los últimos 12 meses (dNBR)
  crecimiento_pct  numeric,   -- variación de superficie en el último año (%)
  fecha_analisis   date not null default current_date
);

-- ---------------------------------------------------------------------
-- 3. Parámetros (una sola fila; se editan desde Tables o el SQL Editor)
-- ---------------------------------------------------------------------
create table if not exists public.parametros_riesgo (
  id                     boolean primary key default true check (id),
  radio_exposicion_m     integer not null default 300,  -- literatura: 250–500 m
  radio_agua_m           integer not null default 500,  -- más allá, sin efecto
  radio_reportes_m       integer not null default 300,
  peso_amenaza           numeric not null default 0.25,
  peso_exposicion        numeric not null default 0.25,
  peso_vulnerabilidad    numeric not null default 0.25,
  peso_reportes          numeric not null default 0.25,
  -- valores que equivalen a "máximo" (puntaje 1) en cada factor
  area_max_m2            numeric not null default 5000,
  quemas_max             integer not null default 4,
  poblacion_max          integer not null default 2000,
  escuelas_max           integer not null default 2,
  salud_max              integer not null default 1,
  reportes_max           integer not null default 5,
  dias_persistencia_max  integer not null default 180
);
insert into public.parametros_riesgo (id) values (true) on conflict (id) do nothing;

-- Nada de esto es accesible directamente por el público
revoke all on public.capa_escuelas, public.capa_salud, public.capa_agua,
              public.capa_inundable, public.capa_poblacion,
              public.amenaza_satelital, public.parametros_riesgo
  from anonymous, authenticated;
alter table public.capa_escuelas     enable row level security;
alter table public.capa_salud        enable row level security;
alter table public.capa_agua         enable row level security;
alter table public.capa_inundable    enable row level security;
alter table public.capa_poblacion    enable row level security;
alter table public.amenaza_satelital enable row level security;
alter table public.parametros_riesgo enable row level security;

-- ---------------------------------------------------------------------
-- 4. Auxiliar: promedio ponderado que ignora los valores sin datos (null)
-- ---------------------------------------------------------------------
create or replace function public.prom_ponderado(valores numeric[], pesos numeric[])
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case when sum(p) filter (where v is not null) > 0
              then sum(v * p) filter (where v is not null)
                   / sum(p) filter (where v is not null)
         end
  from unnest(valores, pesos) as t(v, p);
$$;

-- ---------------------------------------------------------------------
-- 5. Índice de riesgo de un basural (lo llama el popup del mapa)
-- ---------------------------------------------------------------------
-- El cálculo vive en riesgo_calculo, que nadie puede llamar directo. Lo usan
-- dos puertas: riesgo_basural (público, solo reportes publicados) y
-- riesgo_basural_moderacion (moderador, cualquier estado; en moderacion.sql).
create or replace function public.riesgo_calculo(p_id uuid, p_solo_publicados boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r   public.reportes;
  p   public.parametros_riesgo;
  s   public.amenaza_satelital;
  pt  gis.geography;
  buf gis.geometry;

  -- amenaza
  fuente text;  a_tam numeric;  a_que numeric;  a_cre numeric;  amenaza numeric;
  v_tam numeric;  v_que numeric;  v_cre numeric;
  -- exposición
  pob numeric;  viv numeric;  n_esc integer;  n_sal integer;  exposicion numeric;
  -- vulnerabilidad
  d_agua numeric;  agua_nombre text;  agua_tipo text;  en_inundable boolean;
  s_agua numeric;  s_inund numeric;  vulnerabilidad numeric;
  -- reportes
  n_rep integer;  dias integer;  reportes_s numeric;

  total numeric;  clase text;
begin
  -- Para el público, solo basurales ya revisados y visibles en el mapa;
  -- para el panel de moderación, cualquier reporte
  select * into r from public.reportes
  where id = p_id
    and (not p_solo_publicados or estado in ('verificado', 'en_gestion'));
  if not found then return null; end if;

  select * into p from public.parametros_riesgo limit 1;
  pt  := r.geom::gis.geography;
  buf := gis.st_buffer(pt, p.radio_exposicion_m)::gis.geometry;

  -- ---------------- 1. Amenaza ----------------
  -- Lo que releva el vecino (el tamaño, corregido por el moderador si lo hizo)
  v_tam := case coalesce(r.tamano_moderado, r.tamano) when 'bolsas' then 0.1 when 'carretilla' then 0.3
                         when 'camioneta' then 0.6 when 'camion_o_mas' then 1.0 end;
  v_que := case when r.quema then 1 else 0 end;
  -- la antigüedad informada se usa como indicio de persistencia
  v_cre := case r.antiguedad when 'dias' then 0.2 when 'semanas' then 0.4
                             when 'meses' then 0.7 when 'mas_de_un_anio' then 1.0 end;

  -- Lo que mide el satélite completa cada dato por separado (desde 2026-11-24;
  -- antes la fila satelital reemplazaba todo). Superficie y crecimiento, si
  -- están, reemplazan al vecino; las quemas se combinan y queda la señal más
  -- alta, porque a 20 m por píxel al satélite se le escapan las quemas chicas.
  -- Ojo: least(null, 1) devuelve 1 en PostgreSQL, por eso cada "case" explícito
  select * into s from public.amenaza_satelital where reporte_id = p_id;
  a_tam := case when s.area_m2 is not null
                then least(s.area_m2 / p.area_max_m2, 1) else v_tam end;
  a_que := case when s.quemas_12m is not null
                then greatest(v_que, least(s.quemas_12m::numeric / p.quemas_max, 1)) else v_que end;
  a_cre := case when s.crecimiento_pct is not null
                then greatest(least(s.crecimiento_pct / 100.0, 1), 0) else v_cre end;
  fuente := case
    when s.area_m2 is null and s.quemas_12m is null and s.crecimiento_pct is null then 'relevamiento'
    when s.area_m2 is not null and s.quemas_12m is not null and s.crecimiento_pct is not null then 'satelite'
    else 'mixta' end;
  amenaza := (select avg(x) from unnest(array[a_tam, a_que, a_cre]) as x);

  -- ---------------- 2. Exposición ----------------
  if exists (select 1 from public.capa_poblacion) then
    -- población del radio censal proporcional al área dentro del buffer
    select coalesce(sum(c.poblacion * gis.st_area(gis.st_intersection(c.geom, buf)::gis.geography)
                        / nullif(gis.st_area(c.geom::gis.geography), 0)), 0),
           coalesce(sum(coalesce(c.viviendas, 0) * gis.st_area(gis.st_intersection(c.geom, buf)::gis.geography)
                        / nullif(gis.st_area(c.geom::gis.geography), 0)), 0)
      into pob, viv
    from public.capa_poblacion c
    where gis.st_intersects(c.geom, buf);
  end if;

  if exists (select 1 from public.capa_escuelas) then
    select count(*) into n_esc from public.capa_escuelas e
    where gis.st_dwithin(e.geom::gis.geography, pt, p.radio_exposicion_m);
  end if;

  if exists (select 1 from public.capa_salud) then
    select count(*) into n_sal from public.capa_salud h
    where gis.st_dwithin(h.geom::gis.geography, pt, p.radio_exposicion_m);
  end if;

  -- Ojo: least(null, 1) devuelve 1 en PostgreSQL, por eso el "case" explícito
  exposicion := public.prom_ponderado(
    array[ case when pob   is not null then least(pob / p.poblacion_max, 1) end,
           case when n_esc is not null then least(n_esc::numeric / p.escuelas_max, 1) end,
           case when n_sal is not null then least(n_sal::numeric / p.salud_max, 1) end ],
    array[0.5, 0.25, 0.25]);

  -- ---------------- 3. Vulnerabilidad ambiental ----------------
  if exists (select 1 from public.capa_agua) then
    select gis.st_distance(a.geom::gis.geography, pt), a.nombre, a.tipo
      into d_agua, agua_nombre, agua_tipo
    from public.capa_agua a
    where gis.st_dwithin(a.geom::gis.geography, pt, p.radio_agua_m)
    order by gis.st_distance(a.geom::gis.geography, pt)
    limit 1;
    -- 1 hasta 50 m, baja lineal hasta 0 en el radio máximo
    s_agua := case when d_agua is null then 0
                   else greatest(0, least(1, 1 - (d_agua - 50) / greatest(p.radio_agua_m - 50, 1))) end;
  end if;

  if exists (select 1 from public.capa_inundable) then
    en_inundable := exists (select 1 from public.capa_inundable z
                            where gis.st_intersects(z.geom, r.geom));
    s_inund := case when en_inundable then 1 else 0 end;
  end if;

  vulnerabilidad := public.prom_ponderado(array[s_agua, s_inund], array[0.6, 0.4]);

  -- ---------------- 4. Reportes vecinales ----------------
  -- reportes activos (rojo) en la zona, incluido este, y cuánto hace del más viejo
  select count(*), coalesce(max(current_date - x.creado_en::date), 0)
    into n_rep, dias
  from public.reportes x
  where x.estado = 'verificado'
    and gis.st_dwithin(x.geom::gis.geography, pt, p.radio_reportes_m);

  reportes_s := 0.5 * least(n_rep::numeric / p.reportes_max, 1)
              + 0.5 * least(dias::numeric / p.dias_persistencia_max, 1);

  -- ---------------- Total ----------------
  total := 100 * public.prom_ponderado(
    array[amenaza, exposicion, vulnerabilidad, reportes_s],
    array[p.peso_amenaza, p.peso_exposicion, p.peso_vulnerabilidad, p.peso_reportes]);

  clase := case when total is null then null
                when total < 34 then 'bajo'
                when total < 67 then 'medio'
                else 'alto' end;

  return jsonb_build_object(
    'total', round(total),
    'clase', clase,
    'amenaza', jsonb_build_object(
      'puntaje', round(amenaza, 2), 'fuente', fuente,
      'tamano', round(a_tam, 2), 'quemas', round(a_que, 2), 'crecimiento', round(a_cre, 2),
      'tamano_corregido', r.tamano_moderado is not null and s.area_m2 is null,
      'area_m2', s.area_m2, 'quemas_12m', s.quemas_12m, 'crecimiento_pct', s.crecimiento_pct),
    'exposicion', jsonb_build_object(
      'puntaje', round(exposicion, 2), 'radio_m', p.radio_exposicion_m,
      'poblacion', round(pob), 'viviendas', round(viv), 'escuelas', n_esc, 'salud', n_sal),
    'vulnerabilidad', jsonb_build_object(
      'puntaje', round(vulnerabilidad, 2),
      'distancia_agua_m', round(d_agua), 'agua_nombre', agua_nombre, 'agua_tipo', agua_tipo,
      'radio_agua_m', p.radio_agua_m, 'zona_inundable', en_inundable),
    'reportes', jsonb_build_object(
      'puntaje', round(reportes_s, 2), 'radio_m', p.radio_reportes_m,
      'activos', n_rep, 'dias_persistencia', dias),
    'pesos', jsonb_build_object(
      'amenaza', p.peso_amenaza, 'exposicion', p.peso_exposicion,
      'vulnerabilidad', p.peso_vulnerabilidad, 'reportes', p.peso_reportes)
  );
end;
$$;

revoke all on function public.riesgo_calculo(uuid, boolean) from public;

-- Puerta pública: igual que siempre, solo reportes ya publicados
create or replace function public.riesgo_basural(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.riesgo_calculo(p_id, true);
$$;

revoke all on function public.riesgo_basural(uuid) from public;
grant execute on function public.riesgo_basural(uuid) to anonymous;

-- ---------------------------------------------------------------------
-- 6. Índice guardado, para pintar el mapa por riesgo (2026-11-24)
-- ---------------------------------------------------------------------
-- Calcular el índice tarda ~25 ms por reporte: para pintar todos los puntos
-- no se puede calcular en cada visita. Se guarda el último de cada reporte
-- activo y se recalcula:
--   - al moderar: el reporte y los activos a menos de radio_reportes_m
--     (el componente "reportes vecinales" depende de los vecinos);
--   - al cargar capas o datos satelitales: todos (riesgo_recalcular_todo);
--   - en cada visita al mapa: los 20 más viejos de un día, para que la
--     persistencia ("días del más antiguo") avance.
create table if not exists public.riesgo_cache (
  reporte_id    uuid primary key references public.reportes (id) on delete cascade,
  total         integer,
  clase         text,
  calculado_en  timestamptz not null default now()
);
alter table public.riesgo_cache enable row level security;
revoke all on public.riesgo_cache from public;

-- Guarda (o borra, si ya no está activo) el índice de un reporte
create or replace function public.riesgo_guardar(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare x jsonb;
begin
  if exists (select 1 from public.reportes where id = p_id and estado in ('verificado', 'en_gestion')) then
    x := public.riesgo_calculo(p_id, false);
    insert into public.riesgo_cache (reporte_id, total, clase, calculado_en)
    values (p_id, (x ->> 'total')::integer, x ->> 'clase', now())
    on conflict (reporte_id) do update
      set total = excluded.total, clase = excluded.clase, calculado_en = excluded.calculado_en;
  else
    delete from public.riesgo_cache where reporte_id = p_id;
  end if;
end;
$$;
revoke all on function public.riesgo_guardar(uuid) from public;

-- Después de moderar o eliminar un reporte: ese y los activos cercanos.
-- Recibe la ubicación aparte porque, al eliminar, el reporte ya no está.
create or replace function public.riesgo_recalcular_zona(p_id uuid, p_lat double precision, p_lon double precision)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  n integer := 0;
  radio integer := (select radio_reportes_m from public.parametros_riesgo limit 1);
  pt gis.geography := gis.st_setsrid(gis.st_makepoint(p_lon, p_lat), 4326)::gis.geography;
  v uuid;
begin
  perform public.riesgo_guardar(p_id);
  for v in select x.id from public.reportes x
           where x.id <> p_id and x.estado in ('verificado', 'en_gestion')
             and gis.st_dwithin(x.geom::gis.geography, pt, radio)
  loop
    perform public.riesgo_guardar(v);
    n := n + 1;
  end loop;
  return n + 1;
end;
$$;
revoke all on function public.riesgo_recalcular_zona(uuid, double precision, double precision) from public;

-- Todos los activos (al cargar capas o datos satelitales; lo corre el dueño de la base)
create or replace function public.riesgo_recalcular_todo()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare n integer := 0; v uuid;
begin
  delete from public.riesgo_cache c
  where not exists (select 1 from public.reportes x
                    where x.id = c.reporte_id and x.estado in ('verificado', 'en_gestion'));
  for v in select id from public.reportes where estado in ('verificado', 'en_gestion') loop
    perform public.riesgo_guardar(v);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.riesgo_recalcular_todo() from public;

-- En cada visita al mapa: hasta p_max índices faltantes o de más de un día.
-- Si otra visita ya está refrescando, no espera.
create or replace function public.riesgo_refrescar(p_max integer default 20)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare n integer := 0; v uuid;
begin
  if not pg_try_advisory_xact_lock(hashtext('riesgo_refrescar')) then return 0; end if;
  for v in select x.id from public.reportes x
           left join public.riesgo_cache c on c.reporte_id = x.id
           where x.estado in ('verificado', 'en_gestion')
             and (c.reporte_id is null or c.calculado_en < now() - interval '1 day')
           order by c.calculado_en nulls first
           limit least(greatest(p_max, 0), 50)
  loop
    perform public.riesgo_guardar(v);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.riesgo_refrescar(integer) from public;
grant execute on function public.riesgo_refrescar(integer) to anonymous;

-- El mapa público suma la clase de riesgo de cada punto. Se agregan columnas
-- al final: la vista base está en schema.sql.
create or replace view public.reportes_publicos
with (security_invoker = false)
as
select
  r.id,
  round(r.lat::numeric, 4)::double precision as lat,
  round(r.lon::numeric, 4)::double precision as lon,
  r.estado,
  r.tipo,
  coalesce(r.tamano_moderado, r.tamano) as tamano,
  r.quema,
  r.creado_en::date as fecha,
  (r.foto is not null and r.foto_aprobada) as tiene_foto,
  c.clase as riesgo_clase,
  c.total as riesgo_total
from public.reportes r
left join public.riesgo_cache c on c.reporte_id = r.id
where r.estado in ('verificado', 'en_gestion');
grant select on public.reportes_publicos to anonymous;

-- =====================================================================
-- Prueba manual:
--   select jsonb_pretty(public.riesgo_basural('<id de un reporte verificado>'));
-- Cambiar pesos o radios (y después recalcular lo guardado):
--   update public.parametros_riesgo set peso_vulnerabilidad = 0.35, peso_reportes = 0.15;
--   select public.riesgo_recalcular_todo();
-- =====================================================================
