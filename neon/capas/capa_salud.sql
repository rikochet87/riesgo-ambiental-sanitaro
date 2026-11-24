-- Generado por scripts/06_sql_capas.py. No editar a mano: volver a correr el script.
begin;

-- capa_salud: 42 entidades, desde datos/salud/salud_gran_resistencia.geojson
delete from public.capa_salud;
insert into public.capa_salud (nombre, geom) values
  ('Puesto Sanitario Colonia Benítez', gis.st_setsrid(gis.st_makepoint(-58.9427944, -27.3304515), 4326)),
  ('Centro de Salud Barrio de los Pescadores', gis.st_setsrid(gis.st_makepoint(-58.8671698, -27.4603924), 4326)),
  ('Centro de Salud Tres Horquetas', gis.st_setsrid(gis.st_makepoint(-58.9776203, -27.3543202), 4326)),
  ('Centro de Salud El Salado', gis.st_setsrid(gis.st_makepoint(-59.1485153, -27.5291834), 4326)),
  ('Centro de Salud Barrio 500 Viviendas Doctor Ramón Carrillo', gis.st_setsrid(gis.st_makepoint(-58.9517239, -27.4935021), 4326)),
  ('Centro de Salud 4 de Junio', gis.st_setsrid(gis.st_makepoint(-58.9539027, -27.4923797), 4326)),
  ('Centro de Salud Mental La Lomita', gis.st_setsrid(gis.st_makepoint(-58.9284536, -27.4784507), 4326)),
  ('Centro de Salud Doctora Cecilia Grierson', gis.st_setsrid(gis.st_makepoint(-58.9490817, -27.4632429), 4326)),
  ('Centro de Salud Doctora Micucci', gis.st_setsrid(gis.st_makepoint(-58.9702259, -27.4844811), 4326)),
  ('Centro de Salud Barrio Güiraldes', gis.st_setsrid(gis.st_makepoint(-58.9896271, -27.4826255), 4326)),
  ('Centro de Salud Villa Urquiza', gis.st_setsrid(gis.st_makepoint(-58.9893027, -27.4756066), 4326)),
  ('Hospital Central de Odontología Leonor Soria', gis.st_setsrid(gis.st_makepoint(-58.9867177, -27.4568417), 4326)),
  ('Hospital Pediátrico Doctor Avelino Lorenzo Castelán', gis.st_setsrid(gis.st_makepoint(-58.9773008, -27.4568576), 4326)),
  ('Centro de Salud Villa General Belgrano', gis.st_setsrid(gis.st_makepoint(-59.0042485, -27.4603828), 4326)),
  ('Unidad Sanitaria Puerto Barranqueras', gis.st_setsrid(gis.st_makepoint(-58.9867539, -27.4465263), 4326)),
  ('Centro de Salud Villa Alvear', gis.st_setsrid(gis.st_makepoint(-59.0007805, -27.4476753), 4326)),
  ('Centro Odontológico Santa Apolonia', gis.st_setsrid(gis.st_makepoint(-59.0143205, -27.4518008), 4326)),
  ('Centro de Salud Barrio Santa Inés', gis.st_setsrid(gis.st_makepoint(-59.0201990, -27.4578219), 4326)),
  ('Centro de Salud Villa Pegoraro', gis.st_setsrid(gis.st_makepoint(-59.0209280, -27.4517168), 4326)),
  ('Centro de Salud Barrio Toba', gis.st_setsrid(gis.st_makepoint(-59.0050477, -27.4313037), 4326)),
  ('Centro de Salud Barrio MAPIC', gis.st_setsrid(gis.st_makepoint(-58.9865570, -27.4035421), 4326)),
  ('Hospital Eva Perón', gis.st_setsrid(gis.st_makepoint(-58.9434941, -27.4899124), 4326)),
  ('Hospital Doctor Julio C. Perrando', gis.st_setsrid(gis.st_makepoint(-58.9760630, -27.4588392), 4326)),
  ('Sala de Primeros Auxilios Colonia Cruce Viejo', gis.st_setsrid(gis.st_makepoint(-59.0717160, -27.3479368), 4326)),
  ('Centro de Salud Puerto Bastiani', gis.st_setsrid(gis.st_makepoint(-59.0923820, -27.3199919), 4326)),
  ('Centro de Salud Ciudad de los Milagros', gis.st_setsrid(gis.st_makepoint(-58.9624782, -27.5093063), 4326)),
  ('Centro de Salud Villa Forestación', gis.st_setsrid(gis.st_makepoint(-58.9396045, -27.4931764), 4326)),
  ('Centro de Salud Mental José F. Cusolito', gis.st_setsrid(gis.st_makepoint(-58.9156194, -27.4747586), 4326)),
  ('Centro de Salud Villa Hortensia', gis.st_setsrid(gis.st_makepoint(-58.9302312, -27.4738209), 4326)),
  ('Centro de Salud Inmaculada Concepción', gis.st_setsrid(gis.st_makepoint(-58.9668301, -27.4774841), 4326)),
  ('Centro de Salud San Fernando', gis.st_setsrid(gis.st_makepoint(-58.9789714, -27.4907417), 4326)),
  ('Centro de Salud General Obligado', gis.st_setsrid(gis.st_makepoint(-58.9721765, -27.4750870), 4326)),
  ('Centro de Salud Villa Los Lirios', gis.st_setsrid(gis.st_makepoint(-58.9661283, -27.4632712), 4326)),
  ('Centro de Salud Villa Don Alberto', gis.st_setsrid(gis.st_makepoint(-59.0103058, -27.4715909), 4326)),
  ('Centro de Salud Barrio Santa Catalina', gis.st_setsrid(gis.st_makepoint(-58.9761493, -27.4384644), 4326)),
  ('Centro de Salud Villa Río Negro', gis.st_setsrid(gis.st_makepoint(-58.9779426, -27.4253554), 4326)),
  ('Centro de Salud Villa Odorico', gis.st_setsrid(gis.st_makepoint(-58.9916376, -27.4330749), 4326)),
  ('Centro de Salud Villa Barberán', gis.st_setsrid(gis.st_makepoint(-59.0347767, -27.4524944), 4326)),
  ('Centro de Salud Néstor C. Kirchner', gis.st_setsrid(gis.st_makepoint(-59.0344047, -27.4628662), 4326)),
  ('Centro de Salud Barrio España', gis.st_setsrid(gis.st_makepoint(-59.0172811, -27.4451751), 4326)),
  ('Hospital Luis Fleitas', gis.st_setsrid(gis.st_makepoint(-59.0312296, -27.4156743), 4326)),
  ('Hospital Doctor Céspedes Oxley', gis.st_setsrid(gis.st_makepoint(-59.0898670, -27.3718746), 4326));

-- Índice guardado de los activos, con la capa nueva
select public.riesgo_recalcular_todo();

commit;
