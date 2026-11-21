-- =====================================================================
-- Basurales Gran Resistencia — esquema v1
-- Ejecutar completo en Supabase > SQL Editor (proyecto nuevo y vacío).
--
-- Modelo de seguridad:
--   * El público (rol anon) SOLO puede insertar reportes y subir fotos.
--     No puede leer, editar ni borrar reportes, ni listar fotos.
--   * El público solo ve la vista reportes_publicos: reportes ya revisados,
--     con coordenadas redondeadas y sin campos de moderación.
--   * La moderación se hace desde el panel de Supabase (rol postgres).
-- =====================================================================

create extension if not exists postgis with schema extensions;

-- ---------------------------------------------------------------------
-- 1. Tabla principal
-- ---------------------------------------------------------------------
create table if not exists public.reportes (
  -- El id lo genera el navegador (crypto.randomUUID) para que los
  -- reintentos sin señal no dupliquen el reporte.
  id              uuid primary key,
  creado_en       timestamptz not null default now(),

  -- Ubicación (WGS84). geom se calcula sola para usar en QGIS / PostGIS.
  lat             double precision not null,
  lon             double precision not null,
  geom            extensions.geometry(Point, 4326)
                  generated always as (
                    extensions.st_setsrid(extensions.st_makepoint(lon, lat), 4326)
                  ) stored,

  -- Relevamiento (todo opcional)
  tipo            text,
  tamano          text,
  quema           boolean,
  cerca_agua      boolean,
  cerca_escuela   boolean,
  antiguedad      text,
  descripcion     text,

  -- Foto (opcional). Ruta dentro del bucket "fotos".
  foto_path       text,

  -- Moderación (el público no puede escribir estas columnas)
  estado          text not null default 'pendiente',
  foto_aprobada   boolean not null default false,
  revisado_en     timestamptz,
  nota_admin      text,

  -- Reglas de validación
  constraint dentro_gran_resistencia check (
    lat between -27.62 and -27.30 and lon between -59.15 and -58.85
  ),
  constraint tipo_valido check (
    tipo is null or tipo in
      ('domiciliario', 'verde_poda', 'escombros', 'mixto', 'neumaticos', 'otro')
  ),
  constraint tamano_valido check (
    tamano is null or tamano in ('bolsas', 'carretilla', 'camioneta', 'camion_o_mas')
  ),
  constraint antiguedad_valida check (
    antiguedad is null or antiguedad in
      ('dias', 'semanas', 'meses', 'mas_de_un_anio', 'no_se')
  ),
  constraint descripcion_corta check (
    descripcion is null or char_length(descripcion) <= 500
  ),
  constraint foto_path_valida check (
    foto_path is null or foto_path = 'reportes/' || id::text || '.jpg'
  ),
  constraint estado_valido check (
    estado in ('pendiente', 'verificado', 'en_gestion', 'resuelto', 'descartado')
  )
);

comment on table public.reportes is
  'Reportes vecinales de basurales. Semáforo: verificado=rojo, en_gestion=amarillo, resuelto=verde.';

create index if not exists reportes_geom_idx      on public.reportes using gist (geom);
create index if not exists reportes_creado_en_idx on public.reportes (creado_en);
create index if not exists reportes_estado_idx    on public.reportes (estado);

-- ---------------------------------------------------------------------
-- 2. Permisos: el público solo inserta, y solo columnas del vecino
-- ---------------------------------------------------------------------
revoke all on public.reportes from anon, authenticated;

grant insert (id, lat, lon, tipo, tamano, quema, cerca_agua, cerca_escuela,
              antiguedad, descripcion, foto_path)
  on public.reportes to anon;

alter table public.reportes enable row level security;

drop policy if exists "publico_solo_inserta" on public.reportes;
create policy "publico_solo_inserta"
  on public.reportes
  for insert
  to anon
  with check (true);
-- Sin políticas de select/update/delete: el público no lee, no edita, no borra.

-- ---------------------------------------------------------------------
-- 3. Topes: máximo por hora y anti-duplicado inmediato
-- ---------------------------------------------------------------------
create or replace function public.reportes_control_insercion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recientes integer;
  tope_por_hora constant integer := 200;   -- ajustar según el uso real
begin
  -- Tope global por hora
  select count(*) into recientes
  from public.reportes
  where creado_en > now() - interval '1 hour';

  if recientes >= tope_por_hora then
    raise exception 'Se alcanzó el límite de reportes por hora. Probá más tarde.'
      using errcode = 'P0001';
  end if;

  -- Mismo punto (menos de 20 m) en los últimos 10 minutos = duplicado
  if exists (
    select 1
    from public.reportes r
    where r.creado_en > now() - interval '10 minutes'
      and extensions.st_dwithin(
            r.geom::extensions.geography,
            extensions.st_setsrid(extensions.st_makepoint(new.lon, new.lat), 4326)::extensions.geography,
            20)
  ) then
    raise exception 'Ya hay un reporte reciente en ese mismo lugar.'
      using errcode = 'P0002';
  end if;

  new.descripcion := nullif(btrim(new.descripcion), '');
  return new;
end;
$$;

drop trigger if exists reportes_control_insercion on public.reportes;
create trigger reportes_control_insercion
  before insert on public.reportes
  for each row execute function public.reportes_control_insercion();

-- ---------------------------------------------------------------------
-- 4. Vista pública (lo único que el público puede leer)
-- ---------------------------------------------------------------------
-- Solo reportes revisados. Coordenadas redondeadas a 4 decimales (~11 m).
-- Sin descripción, sin foto y sin datos de moderación.
create or replace view public.reportes_publicos
with (security_invoker = false)
as
select
  id,
  round(lat::numeric, 4)::double precision as lat,
  round(lon::numeric, 4)::double precision as lon,
  estado,
  tipo,
  tamano,
  quema,
  creado_en::date as fecha
from public.reportes
where estado in ('verificado', 'en_gestion', 'resuelto');

revoke all on public.reportes_publicos from anon, authenticated;
grant select on public.reportes_publicos to anon;

-- ---------------------------------------------------------------------
-- 5. Fotos: bucket privado, el público sube pero no lista ni descarga
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos', 'fotos', false, 524288, array['image/jpeg'])   -- 512 KB máx.
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "publico_sube_fotos" on storage.objects;
create policy "publico_sube_fotos"
  on storage.objects
  for insert
  to anon
  with check (
    bucket_id = 'fotos'
    and name ~ '^reportes/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
  );
-- Sin política de select: nadie del público puede listar ni bajar fotos.
-- Vos las ves desde Storage en el panel de Supabase.

-- =====================================================================
-- Consultas útiles para moderar (correr a mano en el SQL Editor)
-- =====================================================================
-- Pendientes, del más nuevo al más viejo:
--   select id, creado_en, lat, lon, tipo, tamano, quema, descripcion, foto_path
--   from public.reportes where estado = 'pendiente' order by creado_en desc;
--
-- Verificar (pasa a rojo en el mapa público):
--   update public.reportes
--   set estado = 'verificado', revisado_en = now()
--   where id = '...';
--
-- Otros estados: 'en_gestion' (amarillo), 'resuelto' (verde), 'descartado'.
