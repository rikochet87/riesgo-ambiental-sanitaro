-- =====================================================================
-- Basurales Gran Resistencia — índice de riesgo ambiental y sanitario (v2)
-- Ejecutar DESPUÉS de schema.sql, en Supabase > SQL Editor.
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
  geom    extensions.geometry(Point, 4326) not null
);

create table if not exists public.capa_salud (
  id      bigserial primary key,
  nombre  text,
  geom    extensions.geometry(Point, 4326) not null
);

-- Lagunas (polígonos), ríos y canales (líneas)
create table if not exists public.capa_agua (
  id      bigserial primary key,
  nombre  text,
  tipo    text,            -- laguna, rio, canal, riacho...
  regimen text,            -- perenne / intermitente
  capa    text,            -- capa de origen (IGN)
  geom    extensions.geometry(Geometry, 4326) not null
);
-- Si la tabla ya existía de una versión anterior:
alter table public.capa_agua add column if not exists regimen text;
alter table public.capa_agua add column if not exists capa text;

create table if not exists public.capa_inundable (
  id      bigserial primary key,
  nivel   text,            -- p. ej. alto / medio, según la fuente
  geom    extensions.geometry(Geometry, 4326) not null
);

-- Radios censales con población y viviendas
create table if not exists public.capa_poblacion (
  id         bigserial primary key,
  codigo     text,
  poblacion  integer not null,
  viviendas  integer,
  geom       extensions.geometry(Geometry, 4326) not null
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
-- 3. Parámetros (una sola fila; se editan desde el Table Editor)
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
  from anon, authenticated;
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
create or replace function public.riesgo_basural(p_id uuid)
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
  pt  extensions.geography;
  buf extensions.geometry;

  -- amenaza
  fuente text;  a_tam numeric;  a_que numeric;  a_cre numeric;  amenaza numeric;
  -- exposición
  pob numeric;  viv numeric;  n_esc integer;  n_sal integer;  exposicion numeric;
  -- vulnerabilidad
  d_agua numeric;  agua_nombre text;  agua_tipo text;  en_inundable boolean;
  s_agua numeric;  s_inund numeric;  vulnerabilidad numeric;
  -- reportes
  n_rep integer;  dias integer;  reportes_s numeric;

  total numeric;  clase text;
begin
  -- Solo basurales ya revisados y visibles en el mapa público
  select * into r from public.reportes
  where id = p_id and estado in ('verificado', 'en_gestion', 'resuelto');
  if not found then return null; end if;

  select * into p from public.parametros_riesgo limit 1;
  pt  := r.geom::extensions.geography;
  buf := extensions.st_buffer(pt, p.radio_exposicion_m)::extensions.geometry;

  -- ---------------- 1. Amenaza ----------------
  select * into s from public.amenaza_satelital where reporte_id = p_id;
  if found then
    fuente := 'satelite';
    a_tam := least(coalesce(s.area_m2, 0) / p.area_max_m2, 1);
    a_que := least(coalesce(s.quemas_12m, 0)::numeric / p.quemas_max, 1);
    a_cre := greatest(least(coalesce(s.crecimiento_pct, 0) / 100.0, 1), 0);
  else
    fuente := 'relevamiento';
    a_tam := case r.tamano when 'bolsas' then 0.1 when 'carretilla' then 0.3
                           when 'camioneta' then 0.6 when 'camion_o_mas' then 1.0 end;
    a_que := case when r.quema then 1 else 0 end;
    -- sin satélite, la antigüedad informada se usa como indicio de persistencia
    a_cre := case r.antiguedad when 'dias' then 0.2 when 'semanas' then 0.4
                               when 'meses' then 0.7 when 'mas_de_un_anio' then 1.0 end;
  end if;
  amenaza := (select avg(x) from unnest(array[a_tam, a_que, a_cre]) as x);

  -- ---------------- 2. Exposición ----------------
  if exists (select 1 from public.capa_poblacion) then
    -- población del radio censal proporcional al área dentro del buffer
    select coalesce(sum(c.poblacion * extensions.st_area(extensions.st_intersection(c.geom, buf)::extensions.geography)
                        / nullif(extensions.st_area(c.geom::extensions.geography), 0)), 0),
           coalesce(sum(coalesce(c.viviendas, 0) * extensions.st_area(extensions.st_intersection(c.geom, buf)::extensions.geography)
                        / nullif(extensions.st_area(c.geom::extensions.geography), 0)), 0)
      into pob, viv
    from public.capa_poblacion c
    where extensions.st_intersects(c.geom, buf);
  end if;

  if exists (select 1 from public.capa_escuelas) then
    select count(*) into n_esc from public.capa_escuelas e
    where extensions.st_dwithin(e.geom::extensions.geography, pt, p.radio_exposicion_m);
  end if;

  if exists (select 1 from public.capa_salud) then
    select count(*) into n_sal from public.capa_salud h
    where extensions.st_dwithin(h.geom::extensions.geography, pt, p.radio_exposicion_m);
  end if;

  -- Ojo: least(null, 1) devuelve 1 en PostgreSQL, por eso el "case" explícito
  exposicion := public.prom_ponderado(
    array[ case when pob   is not null then least(pob / p.poblacion_max, 1) end,
           case when n_esc is not null then least(n_esc::numeric / p.escuelas_max, 1) end,
           case when n_sal is not null then least(n_sal::numeric / p.salud_max, 1) end ],
    array[0.5, 0.25, 0.25]);

  -- ---------------- 3. Vulnerabilidad ambiental ----------------
  if exists (select 1 from public.capa_agua) then
    select extensions.st_distance(a.geom::extensions.geography, pt), a.nombre, a.tipo
      into d_agua, agua_nombre, agua_tipo
    from public.capa_agua a
    where extensions.st_dwithin(a.geom::extensions.geography, pt, p.radio_agua_m)
    order by extensions.st_distance(a.geom::extensions.geography, pt)
    limit 1;
    -- 1 hasta 50 m, baja lineal hasta 0 en el radio máximo
    s_agua := case when d_agua is null then 0
                   else greatest(0, least(1, 1 - (d_agua - 50) / greatest(p.radio_agua_m - 50, 1))) end;
  end if;

  if exists (select 1 from public.capa_inundable) then
    en_inundable := exists (select 1 from public.capa_inundable z
                            where extensions.st_intersects(z.geom, r.geom));
    s_inund := case when en_inundable then 1 else 0 end;
  end if;

  vulnerabilidad := public.prom_ponderado(array[s_agua, s_inund], array[0.6, 0.4]);

  -- ---------------- 4. Reportes vecinales ----------------
  -- reportes activos (rojo) en la zona, incluido este, y cuánto hace del más viejo
  select count(*), coalesce(max(current_date - x.creado_en::date), 0)
    into n_rep, dias
  from public.reportes x
  where x.estado = 'verificado'
    and extensions.st_dwithin(x.geom::extensions.geography, pt, p.radio_reportes_m);

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

revoke all on function public.riesgo_basural(uuid) from public;
grant execute on function public.riesgo_basural(uuid) to anon;

-- =====================================================================
-- Prueba manual:
--   select jsonb_pretty(public.riesgo_basural('<id de un reporte verificado>'));
-- Cambiar pesos o radios:
--   update public.parametros_riesgo set peso_vulnerabilidad = 0.35, peso_reportes = 0.15;
-- =====================================================================
