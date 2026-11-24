-- =====================================================================
-- Basurales Gran Resistencia — moderación (panel /admin)
-- Ejecutar DESPUÉS de schema.sql y riesgo.sql.
--
-- Un solo moderador, que entra con la clave ADMIN_CLAVE (cargada en Vercel).
-- Las funciones de /api/admin, una vez verificada la sesión, hacen
-- "set local role moderador" antes de cada consulta: lo que este rol no
-- puede hacer, el panel tampoco, aunque tenga un error.
--
-- El moderador puede: leer los reportes (con foto y descripción), cambiar
-- el estado, aprobar o despublicar la foto, quitarla, dejar una nota y
-- eliminar un reporte entero (desde 2026-11-22, a pedido; el panel pide
-- confirmación). No puede: cambiar la ubicación ni los datos del vecino.
-- =====================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'moderador') then
    create role moderador nologin;
  end if;
end $$;

-- Quien se conecta desde Vercel (el dueño de la base) tiene que poder
-- bajarse a este rol, igual que hace con anonymous.
grant moderador to current_user;

revoke all on public.reportes from moderador;
grant usage on schema public to moderador;
grant select on public.reportes to moderador;
-- foto: solo para quitarla (el panel nunca escribe otra cosa que null)
grant update (estado, foto_aprobada, foto, revisado_en, nota_admin, tamano_moderado) on public.reportes to moderador;
-- Eliminar un reporte entero. Su fila en amenaza_satelital se va con él (on delete cascade).
grant delete on public.reportes to moderador;
-- Recalcular el índice guardado del reporte moderado y sus vecinos (mapa por riesgo)
grant execute on function public.riesgo_recalcular_zona(uuid, double precision, double precision) to moderador;
grant select (reporte_id, total, clase) on public.riesgo_cache to moderador;
drop policy if exists "moderador_lee_riesgo" on public.riesgo_cache;
create policy "moderador_lee_riesgo" on public.riesgo_cache for select to moderador using (true);

-- La tabla tiene RLS: sin estas políticas el moderador no vería ni una fila
drop policy if exists "moderador_lee" on public.reportes;
create policy "moderador_lee" on public.reportes for select to moderador using (true);
drop policy if exists "moderador_elimina" on public.reportes;
create policy "moderador_elimina" on public.reportes for delete to moderador using (true);
drop policy if exists "moderador_modera" on public.reportes;
create policy "moderador_modera" on public.reportes for update to moderador using (true) with check (true);

alter table public.reportes
  drop constraint if exists nota_corta,
  add constraint nota_corta check (nota_admin is null or char_length(nota_admin) <= 500);

-- ---------------------------------------------------------------------
-- Tope de intentos de entrada al panel
-- ---------------------------------------------------------------------
-- Global y no por IP: una IP se cambia fácil. Con 10 fallidos en 15 minutos
-- se bloquea la entrada (también con la clave correcta) hasta que pasen.
-- Quien insista solo consigue dejarte afuera un rato; el sitio público sigue igual.
create table if not exists public.admin_intentos (
  creado_en timestamptz not null default now(),
  ok        boolean not null
);
alter table public.admin_intentos enable row level security;
revoke all on public.admin_intentos from anonymous, authenticated, moderador;

-- Anota el intento y dice si se puede entrar. La llama /api/admin/entrar
-- con el rol anonymous, después de comparar la clave.
create or replace function public.admin_intento(p_ok boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  fallidos integer;
begin
  delete from public.admin_intentos where creado_en < now() - interval '1 day';
  select count(*) into fallidos
  from public.admin_intentos
  where not ok and creado_en > now() - interval '15 minutes';
  insert into public.admin_intentos (ok) values (p_ok);
  return p_ok and fallidos < 10;
end;
$$;

revoke all on function public.admin_intento(boolean) from public;
grant execute on function public.admin_intento(boolean) to anonymous;

-- ---------------------------------------------------------------------
-- Copias de seguridad descargadas desde el panel
-- ---------------------------------------------------------------------
-- El ZIP se arma en el navegador del moderador; acá solo queda anotado
-- cuándo se bajó la última, para que el panel avise si pasa una semana.
create table if not exists public.admin_copias (
  hecha_en  timestamptz not null default now(),
  reportes  integer not null check (reportes >= 0),
  fotos     integer not null check (fotos >= 0)
);
alter table public.admin_copias enable row level security;
revoke all on public.admin_copias from anonymous, authenticated, moderador;
grant select, insert (reportes, fotos) on public.admin_copias to moderador;
drop policy if exists "moderador_ve_copias" on public.admin_copias;
create policy "moderador_ve_copias" on public.admin_copias for select to moderador using (true);
drop policy if exists "moderador_anota_copias" on public.admin_copias;
create policy "moderador_anota_copias" on public.admin_copias for insert to moderador with check (true);

-- ---------------------------------------------------------------------
-- Índice de riesgo para el panel: también de los pendientes y descartados
-- ---------------------------------------------------------------------
-- (riesgo_basural, la del público, solo calcula reportes ya publicados)
create or replace function public.riesgo_basural_moderacion(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.riesgo_calculo(p_id, false);
$$;

revoke all on function public.riesgo_basural_moderacion(uuid) from public;
grant execute on function public.riesgo_basural_moderacion(uuid) to moderador;
