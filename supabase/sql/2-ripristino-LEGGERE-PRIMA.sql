-- FAMIGLIA - RIPRISTINO DA UNA COPIA (solo in caso di emergenza)
-- Riporta membri e impegni com'erano in una copia notturna. Le modifiche fatte dopo quella copia si perdono.
-- Gli utenti e le password non vengono toccati.

-- 1) Guarda le copie disponibili:
select id, at, jsonb_array_length(data->'membri') as membri, jsonb_array_length(data->'impegni') as impegni
from public.famiglia_copie_notturne order by at desc limit 10;

-- 2) Scegli il numero (id) della copia e scrivilo al posto di 0 (due volte), poi togli i due trattini
--    all'inizio delle righe sotto e premi Run:
-- begin;
-- delete from public.famiglia_impegni;
-- update public.famiglia_membri m set nome = r.nome, colore = r.colore, tipo = r.tipo, ordine = r.ordine, archiviato = r.archiviato
--   from public.famiglia_copie_notturne b, jsonb_populate_recordset(null::public.famiglia_membri, b.data->'membri') r
--   where b.id = 0 and m.id = r.id;
-- insert into public.famiglia_impegni
--   select r.* from public.famiglia_copie_notturne b, jsonb_populate_recordset(null::public.famiglia_impegni, b.data->'impegni') r
--   where b.id = 0;
-- commit;
