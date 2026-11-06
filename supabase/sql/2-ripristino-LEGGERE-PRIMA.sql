-- FAMIGLIA - RIPRISTINO DA UNA COPIA (solo in caso di emergenza)
-- Riporta i membri e gli impegni di UNA famiglia com'erano in una copia notturna.
-- Le modifiche fatte dopo quella copia si perdono. Account e password non vengono toccati.

-- 1) Trova il numero (id) della famiglia:
select id, nome, creato from public.famiglia_famiglie order by id;

-- 2) Guarda le copie disponibili:
select id, at from public.famiglia_copie_notturne order by at desc limit 10;

-- 3) Scrivi il numero della copia al posto di 0 e quello della famiglia al posto di 999 (ogni volta che compaiono),
--    poi togli i due trattini all'inizio delle righe sotto e premi Run:
-- begin;
-- delete from public.famiglia_impegni where famiglia_id = 999;
-- update public.famiglia_membri m set nome = r.nome, colore = r.colore, tipo = r.tipo, ordine = r.ordine, archiviato = r.archiviato
--   from public.famiglia_copie_notturne b, jsonb_populate_recordset(null::public.famiglia_membri, b.data->'membri') r
--   where b.id = 0 and m.id = r.id and r.famiglia_id = 999;
-- insert into public.famiglia_impegni
--   select r.* from public.famiglia_copie_notturne b, jsonb_populate_recordset(null::public.famiglia_impegni, b.data->'impegni') r
--   where b.id = 0 and r.famiglia_id = 999;
-- commit;
