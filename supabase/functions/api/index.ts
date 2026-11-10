// FAMIGLIA - Edge Function "api": utenti, membri, impegni (con privacy), inviti e promemoria
// Verifica JWT DISATTIVATA: l'accesso lo controlla questa funzione con nome utente e password.
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC") || "";
const PUSH_OK = !!(VAPID_PUBLIC && Deno.env.get("VAPID_PRIVATE"));
if (PUSH_OK) webpush.setVapidDetails("mailto:" + (Deno.env.get("VAPID_EMAIL") || "famiglia@example.com"), VAPID_PUBLIC, Deno.env.get("VAPID_PRIVATE")!);
// Codice del giro dei promemoria: lo genera 1-tabelle.sql nella tabella famiglia_config
let codiceCron = "";
async function cronValido(req: Request) {
  const dato = req.headers.get("x-cron") || "";
  if (!dato) return false;
  if (!codiceCron) {
    const { data } = await db.from("famiglia_config").select("valore").eq("chiave", "cron").maybeSingle();
    codiceCron = data?.valore || "";
  }
  return !!codiceCron && dato === codiceCron;
}

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "x-token, content-type", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "content-type": "application/json" } });
const fail = (msg: string, s = 400) => json({ error: msg }, s);
const nowIso = () => new Date().toISOString();
const inMin = (m: number) => new Date(Date.now() + m * 60000).toISOString();

// ---------- Sicurezza: password, codici, accessi (come in Spese)
const enc = new TextEncoder();
const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
async function sha(s: string) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)));
  return Array.from(d).map((x) => x.toString(16).padStart(2, "0")).join("");
}
const randTok = (n = 32) => b64u(crypto.getRandomValues(new Uint8Array(n)));
async function pbkdf2(pw: string, salt: Uint8Array, it: number) {
  const k = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: it }, k, 256));
}
async function hashPw(pw: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), it = 100000;
  return "pbkdf2$" + it + "$" + b64u(salt) + "$" + b64u(await pbkdf2(pw, salt, it));
}
async function checkPw(pw: string, stored: string | null) {
  if (!stored) return false;
  const [kind, it, s, h] = stored.split("$");
  if (kind !== "pbkdf2") return false;
  const got = b64u(await pbkdf2(pw, unb64u(s), Number(it)));
  let d = got.length ^ h.length;
  for (let i = 0; i < Math.min(got.length, h.length); i++) d |= got.charCodeAt(i) ^ h.charCodeAt(i);
  return d === 0;
}
const testo = (s: unknown, max: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const testoLungo = (s: unknown, max: number) => String(s ?? "").trim().slice(0, max);
const pulisciUser = (s: unknown) => String(s ?? "").trim().toLowerCase();
// Nome utente: lettere senza accenti, numeri, punto, trattino, trattino basso e @ (così vale anche un'email).
// Restituisce il motivo preciso se non va bene, altrimenti "".
function erroreUser(u: string) {
  if (!u) return "Scrivi un nome utente.";
  if (u.length < 3) return "Il nome utente è troppo corto: servono almeno 3 caratteri.";
  if (u.length > 50) return "Il nome utente è troppo lungo: al massimo 50 caratteri.";
  if (/\s/.test(u)) return "Il nome utente non può contenere spazi: usa per esempio un punto (ivano.perego).";
  const no = [...u].find((c) => !/[a-z0-9._@-]/.test(c));
  if (no) return `Nel nome utente il carattere «${no}» non è ammesso: usa lettere senza accenti, numeri, punto, trattino, trattino basso o @.`;
  return "";
}
const pwOk = (p: unknown) => typeof p === "string" && p.length >= 8 && p.length <= 200;
const MSG_PW = "La password deve avere almeno 8 caratteri.";
const COLORI_OK = /^#[0-9a-fA-F]{6}$/;

async function nuovaSessione(uid: number) {
  const token = randTok();
  const { error } = await db.from("famiglia_accessi_attivi").insert({ h: await sha(token), user_id: uid });
  if (error) throw new Error(error.message);
  await db.from("famiglia_utenti").update({ ultimo_accesso: nowIso() }).eq("id", uid);
  return token;
}
async function chiE(req: Request) {
  const t = req.headers.get("x-token") || "";
  if (!t) return null;
  const h = await sha(t);
  const { data } = await db.from("famiglia_accessi_attivi").select("user_id,ultimo_uso").eq("h", h).maybeSingle();
  if (!data) return null;
  if (Date.now() - Date.parse(data.ultimo_uso) > 3600e3) {
    await db.from("famiglia_accessi_attivi").update({ ultimo_uso: nowIso() }).eq("h", h);
    await db.from("famiglia_utenti").update({ ultimo_accesso: nowIso() }).eq("id", data.user_id);
  }
  return { uid: Number(data.user_id), h };
}
async function troppiTentativi(tipo: string, max: number) {
  const { data } = await db.from("famiglia_tentativi_falliti").select("id").eq("tipo", tipo).gte("at", inMin(-15));
  return (data || []).length >= max;
}
const segnaTentativo = (tipo: string) => db.from("famiglia_tentativi_falliti").insert({ tipo });
// L'utente con la sua famiglia; capo = è il Capofamiglia
async function utente(id: number) {
  const { data: u } = await db.from("famiglia_utenti").select("id,username,pass,famiglia_id").eq("id", id).maybeSingle();
  if (!u) return null;
  const { data: f } = await db.from("famiglia_famiglie").select("id,nome,capo_id").eq("id", u.famiglia_id).maybeSingle();
  if (!f) return null;
  return { ...u, fid: Number(u.famiglia_id), famiglia: f.nome as string, capo: Number(f.capo_id) === Number(u.id) };
}
// Un link (invito o nuova password) valido e non ancora usato; lo segna come usato una volta sola
async function prendiLink(codice: string, tipo: string) {
  const { data: l } = await db.from("famiglia_link").select("h,tipo,famiglia_id,user_id,membro_id,scade,usato").eq("h", await sha(codice)).maybeSingle();
  if (!l || l.tipo !== tipo || l.usato || Date.parse(l.scade) < Date.now()) return null;
  return l;
}
async function usaLink(h: string) {
  const { data } = await db.from("famiglia_link").update({ usato: nowIso() }).eq("h", h).is("usato", null).select("h");
  return !!data?.length;
}

// ---------- Date in ora italiana ("YYYY-MM-DD" e numeri di giorno)
const d2n = (s: string) => { const [y, m, d] = s.split("-").map(Number); return Math.round(Date.UTC(y, m - 1, d) / 864e5); };
const n2d = (n: number) => new Date(n * 864e5).toISOString().slice(0, 10);
const wd = (n: number) => ((new Date(n * 864e5).getUTCDay() + 6) % 7) + 1; // 1 = lunedì
const min = (hm: string | null) => (hm ? Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5)) : 0);
const isoData = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
const isoOra = (s: unknown) => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
function adessoRoma() {
  const p = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
  const [date, hm] = p.split(" ");
  return { date, hm, idx: d2n(date) * 1440 + min(hm) };
}
// Giorni (di inizio) in cui un impegno capita tra "da" e "a", ricorrenze comprese. Uguale a quella dell'app.
function occorrenze(e: any, da: string, a: string): string[] {
  const out: string[] = [];
  const s = d2n(e.giorno), D = d2n(da), A = d2n(a);
  const durata = e.giorno_fine ? Math.max(0, d2n(e.giorno_fine) - s) : 0;
  const fine = e.fino_a ? Math.min(d2n(e.fino_a), A) : A;
  const ecc = new Set<string>(e.eccezioni || []);
  const ok = (n: number) => n >= s && n + durata >= D && n <= A && !ecc.has(n2d(n));
  if (!e.ripeti) { if (ok(s)) out.push(n2d(s)); return out; }
  const da0 = Math.max(s, D - durata);
  if (e.ripeti === "giorno" || e.ripeti === "settimana") {
    const giorni: number[] = e.ripeti === "settimana" ? (e.giorni_sett?.length ? e.giorni_sett : [wd(s)]) : [1, 2, 3, 4, 5, 6, 7];
    for (let n = da0; n <= fine; n++) if (giorni.includes(wd(n)) && ok(n)) out.push(n2d(n));
    return out;
  }
  const [y0, m0, g0] = e.giorno.split("-").map(Number);
  const passo = e.ripeti === "anno" ? 12 : 1;
  for (let k = 0; k < 2400; k += passo) {
    const y = y0 + Math.floor((m0 - 1 + k) / 12), m = ((m0 - 1 + k) % 12) + 1;
    const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
    if (g0 > ultimo) continue;
    const n = Math.round(Date.UTC(y, m - 1, g0) / 864e5);
    if (n > fine) break;
    if (ok(n)) out.push(n2d(n));
  }
  return out;
}

// ---------- Privacy: cosa vede un utente di un impegno
const CAMPI = "id,famiglia_id,tipo,titolo,giorno,giorno_fine,ora_inizio,ora_fine,luogo,note,visibilita,creato_da,membri,da_accompagnare,accompagna,ripeti,giorni_sett,fino_a,eccezioni,promemoria_min,aggiornato";
// Voci delle liste (spesa e cose da fare): sono di tutta la famiglia
const CAMPI_VOCE = "id,lista,testo,fatto,assegnato,giorno,creato_da,aggiornato";
const voce = (v: any) => ({ ...v, assegnato: v.assegnato == null ? null : Number(v.assegnato), creato_da: Number(v.creato_da) });
function perUtente(e: any, uid: number) {
  const mio = Number(e.creato_da) === uid;
  const base = { ...e, creato_da: Number(e.creato_da), membri: (e.membri || []).map(Number), accompagna: e.accompagna == null ? null : Number(e.accompagna), mio };
  if (mio || e.visibilita === "condiviso") return base;
  if (e.visibilita === "privato") return null;
  // "occupato": solo quando e per chi, nessun dettaglio
  return { ...base, tipo: "impegno", titolo: "Occupato", luogo: "", note: "", da_accompagnare: false, accompagna: null, promemoria_min: null };
}

// ---------- Notifiche
async function mandaA(uids: number[], msg: { title: string; body: string; tag: string }) {
  if (!PUSH_OK || !uids.length) return 0;
  const { data } = await db.from("famiglia_push").select("endpoint,sub,user_id").in("user_id", uids);
  let n = 0;
  for (const s of data || []) {
    try { await webpush.sendNotification(s.sub, JSON.stringify(msg), { TTL: 6 * 3600, urgency: "high" }); n++; }
    catch (e) {
      console.error("push", e?.statusCode, e?.body || e?.message);
      if (e?.statusCode === 404 || e?.statusCode === 410) await db.from("famiglia_push").delete().eq("endpoint", s.endpoint);
    }
  }
  return n;
}
async function unaVolta(k: string) {
  const { error } = await db.from("famiglia_promemoria_inviati").insert({ k });
  return !error;
}
// Chi riceve il promemoria di un impegno
function destinatari(e: any, membri: Map<number, any>, tuttiUtenti: number[]) {
  const s = new Set<number>([Number(e.creato_da)]);
  if (e.visibilita !== "condiviso") return [...s];
  let conUtente = false;
  for (const id of e.membri || []) { const u = membri.get(Number(id))?.utente_id; if (u) { s.add(Number(u)); conUtente = true; } }
  const acc = e.accompagna ? membri.get(Number(e.accompagna))?.utente_id : null;
  if (acc) s.add(Number(acc));
  if (!conUtente && !acc) for (const u of tuttiUtenti) s.add(u);
  return [...s];
}
const nomi = (ids: number[], membri: Map<number, any>) => ids.map((i) => membri.get(Number(i))?.nome).filter(Boolean).join(", ");
const fmtGiorno = (d: string, oggi: string) => (d === oggi ? "Oggi" : d2n(d) - d2n(oggi) === 1 ? "Domani" : new Date(d2n(d) * 864e5).toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }));

async function giroPromemoria() {
  const ora = adessoRoma();
  const domani = n2d(d2n(ora.date) + 1);
  const { data: imp } = await db.from("famiglia_impegni").select(CAMPI).eq("cancellato", false);
  const { data: ms } = await db.from("famiglia_membri").select("id,nome,tipo,utente_id");
  const { data: us } = await db.from("famiglia_utenti").select("id,famiglia_id,riepilogo,riepilogo_ora");
  const membri = new Map<number, any>((ms || []).map((m: any) => [Number(m.id), m]));
  // Gli account di ogni famiglia: i messaggi "a tutti" restano dentro la famiglia
  const perFam = new Map<number, number[]>();
  for (const u of us || []) { const f = Number(u.famiglia_id); perFam.set(f, [...(perFam.get(f) || []), Number(u.id)]); }
  const tuttiDi = (e: any) => perFam.get(Number(e.famiglia_id)) || [];
  let inviati = 0;

  // 1) Promemoria dei singoli impegni (senza ora: alle 9 del giorno, meno l'anticipo scelto).
  //    I compleanni avvisano anche il giorno stesso.
  for (const e of imp || []) {
    const anticipi = new Set<number>();
    if (e.promemoria_min != null) anticipi.add(Number(e.promemoria_min));
    if (e.tipo === "compleanno") anticipi.add(0);
    if (!anticipi.size) continue;
    const giorniAvanti = Math.ceil(Math.max(...anticipi) / 1440) + 2;
    for (const g of occorrenze(e, ora.date, n2d(d2n(ora.date) + giorniAvanti))) {
      for (const ant of anticipi) {
        const quando = d2n(g) * 1440 + (e.ora_inizio ? min(e.ora_inizio) : 9 * 60) - ant;
        if (ora.idx < quando || ora.idx > quando + 15) continue;
        if (!(await unaVolta(`p|${e.id}|${g}|${ant}`))) continue;
        const chi = nomi(e.membri || [], membri), acc = e.accompagna ? membri.get(Number(e.accompagna))?.nome : "";
        const body = [fmtGiorno(g, ora.date) + (e.ora_inizio ? " alle " + e.ora_inizio : ""), chi, e.luogo, acc ? "accompagna " + acc : ""].filter(Boolean).join(" · ");
        inviati += await mandaA(destinatari(e, membri, tuttiDi(e)), { title: e.titolo, body, tag: `p-${e.id}-${g}-${ant}` });
      }
    }
  }

  // 2) Riepilogo all'orario scelto da ogni account (di base le 20): gli impegni di domani, o di oggi se è
  //    prima di mezzogiorno, con chi deve ancora essere accompagnato.
  //    Chi ha spento il riepilogo riceve alle 20 solo l'avviso "chi accompagna?".
  const minuti = min(ora.hm);
  for (const u of us || []) {
    const acceso = u.riepilogo !== false;
    const orario = acceso && isoOra(u.riepilogo_ora) ? u.riepilogo_ora : "20:00";
    if (minuti < min(orario) || minuti > min(orario) + 15) continue;
    const mattina = acceso && min(orario) < 12 * 60;
    const giorno = mattina ? ora.date : domani, quale = mattina ? "Oggi" : "Domani";
    if (!(await unaVolta(`sera|${u.id}|${giorno}`))) continue;
    {
      const uid = Number(u.id), fam = Number(u.famiglia_id);
      const righe: { ora: string; t: string }[] = [], mancanti: string[] = [];
      for (const e of (imp || []).filter((x: any) => Number(x.famiglia_id) === fam && occorrenze(x, giorno, giorno).length)) {
        if (Number(e.famiglia_id) !== fam) continue;
        const v = perUtente(e, uid);
        if (!v) continue;
        const bimbi = (e.membri || []).filter((i: number) => membri.get(Number(i))?.tipo === "bambino");
        const manca = e.visibilita !== "privato" && e.da_accompagnare && !e.accompagna && bimbi.length > 0;
        const chi = nomi(v.membri || [], membri);
        righe.push({ ora: v.ora_inizio || "", t: (v.ora_inizio ? v.ora_inizio + " " : "") + v.titolo + (chi ? ` (${chi})` : "") + (manca ? " – manca chi accompagna" : "") });
        if (manca) mancanti.push((e.ora_inizio ? e.ora_inizio + " " : "") + e.titolo + " (" + nomi(bimbi, membri) + ")");
      }
      righe.sort((a, b) => a.ora.localeCompare(b.ora));
      if (acceso && righe.length)
        inviati += await mandaA([uid], { title: `${quale}: ${righe.length} ${righe.length === 1 ? "impegno" : "impegni"}`, body: righe.map((r) => r.t).join(", "), tag: "riep-" + giorno });
      else if (mancanti.length && (!acceso || !mattina))
        inviati += await mandaA([uid], { title: `${quale}: chi accompagna?`, body: mancanti.join(", "), tag: "acc-" + giorno });
    }
  }
  return inviati;
}

// ---------- Richieste
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);
  const path = url.pathname.replace(/^.*?\/api(?=\/|$)/, "") || "/";
  let b: any = {};
  if (req.method === "POST") { try { b = await req.json(); } catch { b = {}; } }
  try {
    // Giro di ogni minuto, chiamato da pg_cron con il codice di famiglia_config
    if (path === "/cron") {
      if (!(await cronValido(req))) return fail("unauthorized", 401);
      return json({ inviati: await giroPromemoria() });
    }
    if (path === "/vapid") return json({ chiave: PUSH_OK ? VAPID_PUBLIC : "" });

    // Invito aperto da un link: chi invita e in quale famiglia
    if (path === "/inizio") {
      let invito = null;
      if (url.searchParams.get("invito")) {
        const l = await prendiLink(url.searchParams.get("invito")!, "invito");
        if (l) {
          const [{ data: m }, { data: f }] = await Promise.all([
            l.membro_id ? db.from("famiglia_membri").select("nome").eq("id", l.membro_id).maybeSingle() : Promise.resolve({ data: null }),
            db.from("famiglia_famiglie").select("nome").eq("id", l.famiglia_id).maybeSingle(),
          ]);
          invito = { nome: (m as any)?.nome || "", famiglia: (f as any)?.nome || "" };
        }
      }
      return json({ invito });
    }

    // Registrazione libera: senza invito si crea una nuova famiglia e se ne diventa Capofamiglia;
    // con un invito si entra nella famiglia di chi ha invitato.
    if (path === "/registrati" && req.method === "POST") {
      if (await troppiTentativi("reg", 10)) return fail("Troppe registrazioni in poco tempo: riprova tra un quarto d'ora.", 429);
      const username = pulisciUser(b.username), nome = testo(b.nome, 30), nomeFam = testo(b.famiglia, 40);
      if (erroreUser(username)) return fail(erroreUser(username));
      if (!pwOk(b.password)) return fail(MSG_PW);
      let link: any = null;
      if (b.invito) {
        link = await prendiLink(String(b.invito), "invito");
        if (!link) { await segnaTentativo("reg"); return fail("L'invito non è valido o è scaduto: chiedine uno nuovo.", 403); }
      } else if (!nomeFam) return fail("Scrivi il nome della famiglia, per esempio Famiglia Rossi.");
      if (!link?.membro_id && !nome) return fail("Scrivi il tuo nome.");
      const { data: esiste } = await db.from("famiglia_utenti").select("id").eq("username", username).maybeSingle();
      if (esiste) return fail("Questo nome utente è già usato: scegline un altro.");
      if (link && !(await usaLink(link.h))) return fail("Questo invito è già stato usato: chiedine uno nuovo.");

      let fid = link ? Number(link.famiglia_id) : 0;
      if (!link) {
        const { data: f, error: ef } = await db.from("famiglia_famiglie").insert({ nome: nomeFam }).select("id").single();
        if (ef) return fail(ef.message, 500);
        fid = Number(f.id);
      }
      const { data: u, error } = await db.from("famiglia_utenti").insert({ famiglia_id: fid, username, pass: await hashPw(b.password) }).select("id").single();
      if (error) {
        if (!link) await db.from("famiglia_famiglie").delete().eq("id", fid);
        return fail(error.code === "23505" ? "Questo nome utente è già usato: scegline un altro." : error.message, error.code === "23505" ? 400 : 500);
      }
      if (!link) await db.from("famiglia_famiglie").update({ capo_id: u.id }).eq("id", fid);
      if (link?.membro_id) await db.from("famiglia_membri").update({ utente_id: u.id, archiviato: false, tipo: "adulto" }).eq("id", link.membro_id).eq("famiglia_id", fid);
      else await db.from("famiglia_membri").insert({ famiglia_id: fid, nome, colore: COLORI_OK.test(b.colore) ? b.colore : "#378ADD", tipo: "adulto", utente_id: u.id });
      await segnaTentativo("reg");
      return json({ token: await nuovaSessione(Number(u.id)), username });
    }
    // Accesso: dopo 5 password sbagliate l'utente resta bloccato 15 minuti
    if (path === "/accedi" && req.method === "POST") {
      if (await troppiTentativi("login", 30)) return fail("Troppi tentativi sbagliati: riprova tra un quarto d'ora.", 429);
      const { data: u } = await db.from("famiglia_utenti").select("id,pass,errori,bloccato_fino").eq("username", pulisciUser(b.username)).maybeSingle();
      if (u?.bloccato_fino && Date.parse(u.bloccato_fino) > Date.now()) return fail("Troppe password sbagliate: riprova tra un quarto d'ora.", 429);
      if (!u || !(await checkPw(String(b.password || ""), u.pass))) {
        await segnaTentativo("login");
        if (u) { const e = (u.errori || 0) + 1; await db.from("famiglia_utenti").update(e >= 5 ? { errori: 0, bloccato_fino: inMin(15) } : { errori: e }).eq("id", u.id); }
        return fail("Nome utente o password sbagliati.", 401);
      }
      await db.from("famiglia_utenti").update({ errori: 0, bloccato_fino: null }).eq("id", u.id);
      return json({ token: await nuovaSessione(Number(u.id)) });
    }
    // Nuova password da un link generato dal Capofamiglia (o da PannelloApp)
    if (path === "/reimposta" && req.method === "POST") {
      if (await troppiTentativi("reset", 20)) return fail("Troppi tentativi: riprova tra un quarto d'ora.", 429);
      if (!pwOk(b.password)) return fail(MSG_PW);
      const l = await prendiLink(String(b.codice || ""), "password");
      if (!l || !l.user_id) { await segnaTentativo("reset"); return fail("Il link non è valido o è scaduto: chiedine uno nuovo."); }
      if (!(await usaLink(l.h))) return fail("Il link è già stato usato.");
      await db.from("famiglia_accessi_attivi").delete().eq("user_id", l.user_id);
      const { data: u } = await db.from("famiglia_utenti").update({ pass: await hashPw(b.password), errori: 0, bloccato_fino: null }).eq("id", l.user_id).select("username").single();
      return json({ token: await nuovaSessione(Number(l.user_id)), username: u?.username || "" });
    }

    // ---- Da qui serve essere entrati
    const io = await chiE(req);
    if (!io) return fail("Accesso scaduto: rientra con nome utente e password.", 401);
    const me = await utente(io.uid);
    if (!me) return fail("Utente non trovato.", 401);
    const fid = me.fid; // da qui in poi tutto resta dentro questa famiglia

    // Tutto quello che serve all'app, già filtrato secondo la privacy
    if (path === "/dati") {
      const [{ data: us }, { data: ms }, { data: imp }, { data: fam }, { data: voci }, { data: prodotti }] = await Promise.all([
        db.from("famiglia_utenti").select("id,username,riepilogo,riepilogo_ora").eq("famiglia_id", fid).order("id"),
        db.from("famiglia_membri").select("id,nome,colore,tipo,utente_id,ordine,archiviato").eq("famiglia_id", fid).order("ordine").order("id"),
        db.from("famiglia_impegni").select(CAMPI).eq("famiglia_id", fid).eq("cancellato", false).order("giorno"),
        db.from("famiglia_famiglie").select("capo_id").eq("id", fid).maybeSingle(),
        db.from("famiglia_voci").select(CAMPI_VOCE).eq("famiglia_id", fid).order("creato"),
        db.from("famiglia_prodotti").select("nome,volte,lista").eq("famiglia_id", fid).order("volte", { ascending: false }).limit(1000),
      ]);
      const capoId = Number(fam?.capo_id);
      const membri = (ms || []).map((m: any) => ({ ...m, id: Number(m.id), utente_id: m.utente_id == null ? null : Number(m.utente_id) }));
      return json({
        io: { id: io.uid, username: me.username, capo: me.capo, membro: membri.find((m) => m.utente_id === io.uid)?.id ?? null,
              riepilogo: (us || []).find((u: any) => Number(u.id) === io.uid)?.riepilogo !== false,
              riepilogo_ora: (us || []).find((u: any) => Number(u.id) === io.uid)?.riepilogo_ora || "20:00" },
        voci: (voci || []).map(voce),
        prodotti: (prodotti || []).map((p: any) => ({ nome: p.nome, volte: Number(p.volte), lista: p.lista })),
        famiglia: { nome: me.famiglia },
        utenti: (us || []).map((u: any) => ({ id: Number(u.id), username: u.username, capo: Number(u.id) === capoId })),
        membri,
        impegni: (imp || []).map((e: any) => perUtente(e, io.uid)).filter(Boolean),
      });
    }

    // Crea o modifica un impegno
    if (path === "/impegno" && req.method === "POST") {
      const id = String(b.id || "");
      if (!/^[0-9a-f-]{36}$/i.test(id)) return fail("Impegno non valido.");
      const titolo = testo(b.titolo, 80);
      if (!titolo) return fail("Scrivi un titolo.");
      if (!isoData(b.giorno)) return fail("Scegli il giorno.");
      if (b.giorno_fine && (!isoData(b.giorno_fine) || b.giorno_fine < b.giorno)) return fail("Il giorno di fine è prima dell'inizio.");
      const oraI = b.ora_inizio ? String(b.ora_inizio) : null, oraF = b.ora_fine ? String(b.ora_fine) : null;
      if ((oraI && !isoOra(oraI)) || (oraF && !isoOra(oraF))) return fail("Orario non valido.");
      if (oraF && !oraI) return fail("Manca l'ora di inizio.");
      if (oraI && oraF && !b.giorno_fine && oraF < oraI) return fail("L'ora di fine è prima dell'inizio.");
      const { data: ms } = await db.from("famiglia_membri").select("id").eq("famiglia_id", fid);
      const validi = new Set((ms || []).map((m: any) => Number(m.id)));
      const membri = [...new Set((Array.isArray(b.membri) ? b.membri : []).map(Number))].filter((x) => validi.has(x));
      if (!membri.length) return fail("Scegli per chi è l'impegno.");
      const da_accompagnare = !!b.da_accompagnare;
      const accompagna = da_accompagnare && b.accompagna != null && validi.has(Number(b.accompagna)) ? Number(b.accompagna) : null;
      const ripeti = ["", "giorno", "settimana", "mese", "anno"].includes(b.ripeti) ? b.ripeti : "";
      const giorni_sett = ripeti === "settimana" ? [...new Set((Array.isArray(b.giorni_sett) ? b.giorni_sett : []).map(Number))].filter((x) => x >= 1 && x <= 7).sort() : [];
      const fino_a = ripeti && isoData(b.fino_a) && b.fino_a >= b.giorno ? b.fino_a : null;
      const promemoria_min = b.promemoria_min == null || b.promemoria_min === "" ? null : Math.max(0, Math.min(44640, Math.round(Number(b.promemoria_min) || 0))); // fino a un mese prima
      const tipo = ["impegno", "scadenza", "compleanno"].includes(b.tipo) ? b.tipo : "impegno";
      let visibilita = ["condiviso", "occupato", "privato"].includes(b.visibilita) ? b.visibilita : "condiviso";

      const { data: prima } = await db.from("famiglia_impegni").select("famiglia_id,creato_da,visibilita,eccezioni,cancellato").eq("id", id).maybeSingle();
      let creato_da = io.uid, eccezioni: string[] = [];
      if (prima) {
        if (Number(prima.famiglia_id) !== fid) return fail("Impegno non valido.", 403);
        if (prima.cancellato) return fail("Questo impegno è stato eliminato.", 410);
        const mio = Number(prima.creato_da) === io.uid;
        if (!mio && prima.visibilita !== "condiviso") return fail("Solo chi l'ha creato può modificare questo impegno.", 403);
        if (!mio) visibilita = prima.visibilita; // la visibilità la cambia solo chi l'ha creato
        creato_da = Number(prima.creato_da);
        eccezioni = prima.eccezioni || [];
      }
      // "Solo questo giorno" di un impegno che si ripete: nasce un impegno nuovo per quel giorno
      // e la serie salta quel giorno. Il nuovo impegno resta di chi ha creato la serie.
      let serie: any = null;
      const sost = b.sostituisce;
      if (sost) {
        if (prima || !isoData(sost.giorno)) return fail("Modifica non valida.");
        const { data: s } = await db.from("famiglia_impegni").select("id,creato_da,visibilita,ripeti,eccezioni,cancellato")
          .eq("id", String(sost.id || "")).eq("famiglia_id", fid).maybeSingle();
        if (!s || s.cancellato || !s.ripeti) return fail("L'impegno da modificare non c'è più.", 410);
        const mio = Number(s.creato_da) === io.uid;
        if (!mio && s.visibilita !== "condiviso") return fail("Solo chi l'ha creato può modificare questo impegno.", 403);
        if (!mio) visibilita = s.visibilita;
        creato_da = Number(s.creato_da);
        serie = s;
      }
      const riga = {
        id, famiglia_id: fid, tipo, titolo, giorno: b.giorno, giorno_fine: b.giorno_fine && b.giorno_fine !== b.giorno ? b.giorno_fine : null,
        ora_inizio: oraI, ora_fine: oraF, luogo: testo(b.luogo, 120), note: testoLungo(b.note, 2000), visibilita, creato_da,
        membri, da_accompagnare, accompagna, ripeti, giorni_sett, fino_a, eccezioni: ripeti ? eccezioni : [], promemoria_min, aggiornato: nowIso(), cancellato: false,
      };
      if (serie && riga.ripeti) return fail("Un singolo giorno non può ripetersi.");
      const { data, error } = await db.from("famiglia_impegni").upsert(riga).select(CAMPI).single();
      if (error) return fail(error.message, 500);
      if (serie) {
        const ecc = [...new Set([...(serie.eccezioni || []), sost.giorno])];
        await db.from("famiglia_impegni").update({ eccezioni: ecc, aggiornato: nowIso() }).eq("id", serie.id);
      }
      return json({ impegno: perUtente(data, io.uid) });
    }
    // Elimina un impegno, oppure salta un solo giorno di un impegno che si ripete
    if (path === "/impegno/elimina" && req.method === "POST") {
      const { data: e } = await db.from("famiglia_impegni").select("id,creato_da,visibilita,ripeti,eccezioni").eq("id", String(b.id || "")).eq("famiglia_id", fid).maybeSingle();
      if (!e) return json({ ok: true });
      if (Number(e.creato_da) !== io.uid && e.visibilita !== "condiviso") return fail("Solo chi l'ha creato può eliminare questo impegno.", 403);
      if (e.ripeti && isoData(b.solo_giorno)) {
        const ecc = [...new Set([...(e.eccezioni || []), b.solo_giorno])];
        await db.from("famiglia_impegni").update({ eccezioni: ecc, aggiornato: nowIso() }).eq("id", e.id);
      } else await db.from("famiglia_impegni").update({ cancellato: true, aggiornato: nowIso() }).eq("id", e.id);
      return json({ ok: true });
    }

    // Membri: chiunque della famiglia può aggiungerli o modificarli
    if (path === "/membro" && req.method === "POST") {
      const nome = testo(b.nome, 30);
      if (!nome) return fail("Scrivi il nome.");
      const riga: any = {
        nome, colore: COLORI_OK.test(b.colore) ? b.colore : "#1F6F5C",
        tipo: ["adulto", "bambino", "gruppo"].includes(b.tipo) ? b.tipo : "adulto",
        ordine: Math.round(Number(b.ordine) || 0), archiviato: !!b.archiviato,
      };
      if (b.id) {
        const { data: m } = await db.from("famiglia_membri").select("id,utente_id").eq("id", Number(b.id)).eq("famiglia_id", fid).maybeSingle();
        if (!m) return fail("Membro non trovato.", 404);
        if (m.utente_id && riga.archiviato) return fail("Chi ha un account non si può togliere dalla famiglia.");
        if (m.utente_id) riga.tipo = "adulto";
        const { error } = await db.from("famiglia_membri").update(riga).eq("id", m.id);
        if (error) return fail(error.message, 500);
      } else {
        const { error } = await db.from("famiglia_membri").insert({ ...riga, famiglia_id: fid });
        if (error) return fail(error.message, 500);
      }
      return json({ ok: true });
    }
    // Capofamiglia: invito per un adulto senza account (dura 7 giorni, si usa una volta)
    if (path === "/invito" && req.method === "POST") {
      if (!me.capo) return fail("Solo il Capofamiglia può invitare.", 403);
      const { data: m } = await db.from("famiglia_membri").select("id,nome,tipo,utente_id").eq("id", Number(b.membro_id)).eq("famiglia_id", fid).maybeSingle();
      if (!m) return fail("Membro non trovato.", 404);
      if (m.utente_id) return fail(m.nome + " ha già un account.");
      if (m.tipo !== "adulto") return fail("Si possono invitare solo gli adulti.");
      const codice = randTok(18);
      await db.from("famiglia_link").insert({ h: await sha(codice), tipo: "invito", famiglia_id: fid, membro_id: m.id, creato_da: io.uid, scade: inMin(7 * 24 * 60) });
      return json({ codice, nome: m.nome });
    }
    // Capofamiglia: cambia il nome della famiglia
    if (path === "/famiglia/nome" && req.method === "POST") {
      if (!me.capo) return fail("Solo il Capofamiglia può cambiare il nome della famiglia.", 403);
      const nome = testo(b.nome, 40);
      if (!nome) return fail("Scrivi il nome della famiglia.");
      await db.from("famiglia_famiglie").update({ nome }).eq("id", fid);
      return json({ ok: true });
    }
    // Capofamiglia: passa il ruolo a un altro adulto con account della stessa famiglia
    if (path === "/capo/passa" && req.method === "POST") {
      if (!me.capo) return fail("Solo il Capofamiglia può passare il ruolo.", 403);
      const { data: t } = await db.from("famiglia_utenti").select("id").eq("id", Number(b.user_id)).eq("famiglia_id", fid).maybeSingle();
      if (!t || Number(t.id) === io.uid) return fail("Scegli un altro adulto della famiglia con un account.");
      await db.from("famiglia_famiglie").update({ capo_id: t.id }).eq("id", fid);
      return json({ ok: true });
    }

    // Liste: aggiungi o modifica una voce (spesa o cosa da fare)
    if (path === "/voce" && req.method === "POST") {
      const id = String(b.id || "");
      if (!/^[0-9a-f-]{36}$/i.test(id)) return fail("Voce non valida.");
      const lista = b.lista === "cose" ? "cose" : "spesa";
      let testoV = testo(b.testo, 120);
      if (!testoV) return fail("Scrivi cosa aggiungere.");
      testoV = testoV.charAt(0).toUpperCase() + testoV.slice(1); // "latte" → "Latte", "lavare l'auto" → "Lavare l'auto"
      let assegnato: number | null = null;
      if (lista === "cose" && b.assegnato != null) {
        const { data: m } = await db.from("famiglia_membri").select("id").eq("id", Number(b.assegnato)).eq("famiglia_id", fid).maybeSingle();
        assegnato = m ? Number(m.id) : null;
      }
      const { data: prima } = await db.from("famiglia_voci").select("famiglia_id,creato_da").eq("id", id).maybeSingle();
      if (prima && Number(prima.famiglia_id) !== fid) return fail("Voce non valida.", 403);
      const riga = { id, famiglia_id: fid, lista, testo: testoV, fatto: !!b.fatto, assegnato,
        giorno: lista === "cose" && isoData(b.giorno) ? b.giorno : null, creato_da: prima ? Number(prima.creato_da) : io.uid, aggiornato: nowIso() };
      const { data, error } = await db.from("famiglia_voci").upsert(riga).select(CAMPI_VOCE).single();
      if (error) return fail(error.message, 500);
      // Una voce nuova: la ricorda per i suggerimenti della sua lista
      if (!prima) {
        const chiave = testoV.toLowerCase();
        const { data: p } = await db.from("famiglia_prodotti").select("volte").eq("famiglia_id", fid).eq("lista", lista).eq("chiave", chiave).maybeSingle();
        if (p) await db.from("famiglia_prodotti").update({ volte: Number(p.volte) + 1, nome: testoV, ultimo: nowIso() }).eq("famiglia_id", fid).eq("lista", lista).eq("chiave", chiave);
        else await db.from("famiglia_prodotti").insert({ famiglia_id: fid, lista, chiave, nome: testoV });
      }
      return json({ voce: voce(data) });
    }
    if (path === "/voce/elimina" && req.method === "POST") {
      await db.from("famiglia_voci").delete().eq("id", String(b.id || "")).eq("famiglia_id", fid);
      return json({ ok: true });
    }
    // Toglie un prodotto dai suggerimenti (per esempio se era scritto sbagliato)
    if (path === "/prodotto/elimina" && req.method === "POST") {
      await db.from("famiglia_prodotti").delete().eq("famiglia_id", fid).eq("lista", b.lista === "cose" ? "cose" : "spesa").eq("chiave", testo(b.nome, 120).toLowerCase());
      return json({ ok: true });
    }
    if (path === "/voci/togli-fatte" && req.method === "POST") {
      await db.from("famiglia_voci").delete().eq("famiglia_id", fid).eq("lista", b.lista === "cose" ? "cose" : "spesa").eq("fatto", true);
      return json({ ok: true });
    }
    // Impostazioni dell'account: riepilogo serale sì o no
    if (path === "/impostazioni" && req.method === "POST") {
      const imp: any = {};
      if (b.riepilogo !== undefined) imp.riepilogo = !!b.riepilogo;
      if (b.riepilogo_ora !== undefined) { if (!isoOra(b.riepilogo_ora)) return fail("Orario non valido."); imp.riepilogo_ora = b.riepilogo_ora; }
      await db.from("famiglia_utenti").update(imp).eq("id", io.uid);
      return json({ ok: true });
    }

    if (path === "/esci" && req.method === "POST") {
      if (b.tutti) await db.from("famiglia_accessi_attivi").delete().eq("user_id", io.uid);
      else await db.from("famiglia_accessi_attivi").delete().eq("h", io.h);
      if (b.endpoint) await db.from("famiglia_push").delete().eq("endpoint", String(b.endpoint));
      return json({ ok: true });
    }
    if (path === "/password" && req.method === "POST") {
      if (!(await checkPw(String(b.vecchia || ""), me.pass))) return fail("La password attuale non è giusta.");
      if (!pwOk(b.nuova)) return fail(MSG_PW);
      await db.from("famiglia_utenti").update({ pass: await hashPw(b.nuova) }).eq("id", io.uid);
      await db.from("famiglia_accessi_attivi").delete().eq("user_id", io.uid).neq("h", io.h); // esce dagli altri telefoni
      return json({ ok: true });
    }

    // Notifiche
    if (path === "/push/iscrivi" && req.method === "POST") {
      if (!b?.endpoint || !b?.keys) return fail("Iscrizione non valida.");
      const { error } = await db.from("famiglia_push").upsert({ endpoint: String(b.endpoint), sub: b, user_id: io.uid });
      return error ? fail(error.message, 500) : json({ ok: true });
    }
    if (path === "/push/togli" && req.method === "POST") {
      if (b?.endpoint) await db.from("famiglia_push").delete().eq("endpoint", String(b.endpoint)).eq("user_id", io.uid);
      return json({ ok: true });
    }
    if (path === "/push/prova" && req.method === "POST") {
      if (!PUSH_OK) return fail("Le notifiche non sono ancora configurate sul server (chiavi VAPID).", 503);
      return json({ inviati: await mandaA([io.uid], { title: "Famiglia", body: "Notifica di prova: funziona.", tag: "prova" }) });
    }

    // Capofamiglia: link per una nuova password di un familiare (24 ore)
    if (path === "/capo/link-password" && req.method === "POST") {
      if (!me.capo) return fail("Solo il Capofamiglia può farlo.", 403);
      const { data: target } = await db.from("famiglia_utenti").select("id,username").eq("id", Number(b.user_id)).eq("famiglia_id", fid).maybeSingle();
      if (!target) return fail("Utente non trovato.", 404);
      const codice = randTok(18);
      await db.from("famiglia_link").insert({ h: await sha(codice), tipo: "password", famiglia_id: fid, user_id: target.id, creato_da: io.uid, scade: inMin(24 * 60) });
      return json({ codice, username: target.username });
    }
    return fail("Richiesta non riconosciuta.", 404);
  } catch (e) {
    console.error(e);
    return fail("Errore del server: " + (e?.message || String(e)), 500);
  }
});
