-- =====================================================================
-- Basurales Gran Resistencia — esquema v1 para Neon
-- Ejecutar completo en el SQL Editor de Neon (proyecto nuevo y vacío).
--
-- Modelo de seguridad:
--   * El público (rol anonymous) SOLO puede insertar reportes.
--     No puede leer, editar ni borrar, ni cambiar el estado.
--   * El público solo ve la vista reportes_publicos: reportes ya revisados,
--     con coordenadas redondeadas y sin comentario ni datos de moderación.
--   * La foto se guarda en la misma tabla y se sirve de a una, ya aprobada,
--     con la función foto_basural().
--   * La moderación se hace desde el SQL Editor / Tables de Neon.
--
-- Antes de ejecutarlo: Postgres database > Data API > Enable Data API,
-- en la rama que vayas a usar. Eso crea los roles anonymous y authenticated.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. PostGIS en su propio esquema
-- ---------------------------------------------------------------------
-- Va en "gis" y no en "public" para que la Data API no exponga las cientos
-- de funciones de PostGIS como endpoints.
create schema if not exists gis;
create extension if not exists postgis with schema gis;

-- Los roles los crea la Data API al habilitarla; esto es por si falta alguno.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anonymous') then
    create role anonymous nologin;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. Tabla principal
-- ---------------------------------------------------------------------
create table if not exists public.reportes (
  -- El id lo genera el navegador (crypto.randomUUID) para que los
  -- reintentos sin señal no dupliquen el reporte.
  id              uuid primary key,
  creado_en       timestamptz not null default now(),

  -- Ubicación (WGS84). geom la calcula el trigger, para usar en QGIS / PostGIS.
  lat             double precision not null,
  lon             double precision not null,
  geom            gis.geometry(Point, 4326),

  -- Relevamiento (todo opcional)
  tipo            text,
  tamano          text,
  quema           boolean,
  cerca_agua      boolean,
  cerca_escuela   boolean,
  antiguedad      text,
  descripcion     text,

  -- Foto (opcional)
  --   foto_entrada: lo que manda el navegador, en base64. El trigger la
  --                 convierte a binario y deja esta columna vacía.
  --   foto:         el binario que se guarda. El público nunca lo lee directo.
  foto_entrada    text,
  foto            bytea,

  -- Moderación (el público no puede escribir estas columnas)
  estado          text not null default 'pendiente',
  foto_aprobada   boolean not null default false,
  revisado_en     timestamptz,
  nota_admin      text,
  -- Tamaño corregido por el moderador mirando la foto (2026-11-24). El del
  -- vecino queda en "tamano", sin tocar; el índice y el mapa usan este si está.
  tamano_moderado text,

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
  constraint foto_pesa_poco check (
    foto is null or octet_length(foto) <= 400000      -- 400 KB
  ),
  constraint estado_valido check (
    estado in ('pendiente', 'verificado', 'en_gestion', 'resuelto', 'descartado')
  ),
  constraint tamano_moderado_valido check (
    tamano_moderado is null or tamano_moderado in ('bolsas', 'carretilla', 'camioneta', 'camion_o_mas')
  )
);

-- Bases creadas antes del 2026-11-24: agregar la corrección de tamaño
alter table public.reportes add column if not exists tamano_moderado text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tamano_moderado_valido') then
    alter table public.reportes add constraint tamano_moderado_valido check (
      tamano_moderado is null or tamano_moderado in ('bolsas', 'carretilla', 'camioneta', 'camion_o_mas'));
  end if;
end $$;

comment on table public.reportes is
  'Reportes vecinales de basurales. Semáforo: verificado=rojo, en_gestion=amarillo, resuelto=verde.';

create index if not exists reportes_geom_idx      on public.reportes using gist (geom);
create index if not exists reportes_creado_en_idx on public.reportes (creado_en);
create index if not exists reportes_estado_idx    on public.reportes (estado);

-- ---------------------------------------------------------------------
-- 2. Trigger: calcula geom, convierte la foto y aplica los topes
-- ---------------------------------------------------------------------
-- Es security definer, así que el público no necesita permisos sobre el
-- esquema gis: todo el trabajo espacial lo hace esta función.
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
  -- Punto a partir de lat/lon
  new.geom := gis.st_setsrid(gis.st_makepoint(new.lon, new.lat), 4326);

  if tg_op = 'INSERT' then
    -- Tope global por hora
    select count(*) into recientes
    from public.reportes
    where creado_en > now() - interval '1 hour';

    if recientes >= tope_por_hora then
      raise exception 'Se alcanzó el límite de reportes por hora. Probá más tarde.'
        using errcode = 'P0001';
    end if;

    -- Mismo punto (menos de 20 m) en los últimos 10 minutos = duplicado.
    -- Se excluye el mismo id: si es el reintento de un reporte que ya llegó,
    -- tiene que fallar la clave primaria (23505) y no esto, así la app sabe
    -- que puede sacarlo de su cola.
    if exists (
      select 1
      from public.reportes r
      where r.creado_en > now() - interval '10 minutes'
        and r.id <> new.id
        and gis.st_dwithin(
              r.geom::gis.geography,
              gis.st_setsrid(gis.st_makepoint(new.lon, new.lat), 4326)::gis.geography,
              20)
    ) then
      raise exception 'Ya hay un reporte reciente en ese mismo lugar.'
        using errcode = 'P0002';
    end if;
  end if;

  -- Foto: llega en base64 y se guarda en binario
  if new.foto_entrada is not null then
    if length(new.foto_entrada) > 600000 then          -- ~450 KB de imagen
      raise exception 'La foto es demasiado grande.'
        using errcode = 'P0003';
    end if;
    begin
      new.foto := decode(new.foto_entrada, 'base64');
    exception when others then
      raise exception 'No se pudo leer la foto.' using errcode = 'P0003';
    end;
    new.foto_entrada := null;
  end if;

  new.descripcion := nullif(btrim(new.descripcion), '');
  return new;
end;
$$;

drop trigger if exists reportes_control_insercion on public.reportes;
create trigger reportes_control_insercion
  before insert or update of lat, lon, foto_entrada on public.reportes
  for each row execute function public.reportes_control_insercion();

-- ---------------------------------------------------------------------
-- 3. Permisos: el público solo inserta, y solo columnas del vecino
-- ---------------------------------------------------------------------
revoke all on public.reportes from anonymous, authenticated;

grant usage on schema public to anonymous;
grant insert (id, lat, lon, tipo, tamano, quema, cerca_agua, cerca_escuela,
              antiguedad, descripcion, foto_entrada)
  on public.reportes to anonymous;

alter table public.reportes enable row level security;

drop policy if exists "publico_solo_inserta" on public.reportes;
create policy "publico_solo_inserta"
  on public.reportes
  for insert
  to anonymous
  with check (true);
-- Sin políticas de select/update/delete: el público no lee, no edita, no borra.

-- ---------------------------------------------------------------------
-- 4. Vista pública (lo único que el público puede leer)
-- ---------------------------------------------------------------------
-- Solo reportes revisados. Coordenadas redondeadas a 4 decimales (~11 m).
-- Sin descripción y sin la foto: esa se pide de a una con foto_basural().
create or replace view public.reportes_publicos
with (security_invoker = false)
as
select
  id,
  round(lat::numeric, 4)::double precision as lat,
  round(lon::numeric, 4)::double precision as lon,
  estado,
  tipo,
  coalesce(tamano_moderado, tamano) as tamano,   -- la corrección del moderador, si hay
  quema,
  creado_en::date as fecha,
  (foto is not null and foto_aprobada) as tiene_foto
from public.reportes
where estado in ('verificado', 'en_gestion', 'resuelto');

revoke all on public.reportes_publicos from anonymous, authenticated;
grant select on public.reportes_publicos to anonymous;

-- ---------------------------------------------------------------------
-- 5. Foto de un basural, ya aprobada, de a una
-- ---------------------------------------------------------------------
-- Devuelve la imagen en base64 para mostrarla directo en la página.
-- Se pide solo al tocar el punto, así el mapa no arrastra las fotos.
create or replace function public.foto_basural(p_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  -- encode() corta en líneas de 76 caracteres; el navegador las necesita fuera
  select translate(encode(foto, 'base64'), E'\n', '')
  from public.reportes
  where id = p_id
    and foto_aprobada
    and foto is not null
    and estado in ('verificado', 'en_gestion', 'resuelto');
$$;

revoke all on function public.foto_basural(uuid) from public;
grant execute on function public.foto_basural(uuid) to anonymous;

-- =====================================================================
-- Consultas útiles para moderar (correr a mano en el SQL Editor)
-- =====================================================================
-- Pendientes, del más nuevo al más viejo (sin traer la foto):
--   select id, creado_en, lat, lon, tipo, tamano, quema, descripcion,
--          (foto is not null) as tiene_foto
--   from public.reportes where estado = 'pendiente' order by creado_en desc;
--
-- Ver una foto: en Neon, Tables > reportes, o exportarla con
--   \copy (select encode(foto,'base64') from public.reportes where id='...') to 'foto.txt'
-- y pegar el contenido en el navegador como data:image/jpeg;base64,<contenido>
--
-- Verificar (pasa a rojo en el mapa público) y aprobar la foto:
--   update public.reportes
--   set estado = 'verificado', foto_aprobada = true, revisado_en = now()
--   where id = '...';
--
-- Otros estados: 'en_gestion' (amarillo), 'resuelto' (verde), 'descartado'.
