// KREDYTY RM: klienci przekazani przez RM doradcom kredytowym (od v4 osobno Natalia i Jarek) + raport do druku/Excela
// oraz kampanie reklamowe na kredyt (miejsce, zdjęcie, termin, budżet, zapytania).
// Dane w bazie Zadań RM (Supabase, to samo logowanie). Bez config.js albo z ?proba: tryb próbny w tej przeglądarce.
const WERSJA = 'v6';

// rozliczenie: RM dostaje udział w prowizji doradcy; stawkę (np. 1,5 / 2 / 3% kwoty kredytu) podaje doradca.
// Stawka w % siedzi w kolumnie prowizja_rm. Natalia: podział 50/50 uzyskanej prowizji (ustalone 19.11, potwierdzone 22.11.2026), Jarek: warunki do wpisania (null = nie liczymy).
const DORADCY = {
  Natalia: { kto: 'Natalia', kogo: 'Natalii', komu: 'Natalii', udzial: 0.5 },
  Jarek: { kto: 'Jarek', kogo: 'Jarka', komu: 'Jarkowi', udzial: null }
};
const dor = (k) => DORADCY[k?.doradca] || DORADCY.Natalia;
const udzTxt = (d) => d.udzial ? Math.round(d.udzial * 100) + '%' : 'udział do ustalenia';
const podzTxt = (d) => d.udzial ? `${Math.round(d.udzial * 100)}/${100 - Math.round(d.udzial * 100)}` : 'do ustalenia';
// etapy klienta u doradcy (daty); od v3 zmiany zapisuje baza w kredyty_historia (migracja-v3.sql)
const ETAPY = [['kontakt', 'Pierwszy kontakt doradcy'], ['wniosek', 'Wniosek w banku'], ['decyzja', 'Decyzja banku'], ['umowa', 'Umowa kredytowa']];
const POLA = { data: 'Data przekazania', klient: 'Klient', telefon: 'Telefon', nieruchomosc: 'Nieruchomość', zdolnosc: 'Zdolność', kredyt: 'Kredyt',
  kwota: 'Kwota kredytu', prowizja_rm: 'Stawka doradcy', doradca: 'Doradca', zamkniecie: 'Zamknięcie sprzedaży', bank: 'Bank', kontakt: 'Pierwszy kontakt', wniosek: 'Wniosek w banku',
  decyzja: 'Decyzja banku', umowa: 'Umowa kredytowa', zaplacono: 'Zapłacono RM', faktura: 'Faktura', stawka_potw: 'Potwierdzenie stawki' };
const STAWKI = [1.5, 2, 3];
const KREDYT = ['W trakcie', 'Tak', 'Nie', 'Bez kredytu'];
const MIEJSCA = ['Facebook / Instagram', 'Google', 'Strona www', 'Otodom / OLX', 'Baner', 'Witryna biura', 'Ulotki', 'Prasa / radio'];
const K_STATUS = { plan: 'Plan', aktywna: 'Aktywna', zakonczona: 'Zakończona' };

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isoDzien = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const dzis = () => isoDzien(new Date());
const dataPL = (iso) => { if (!iso) return ''; const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}.${m}.${y}`; };
const bezOgonkow = (t) => String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').trim();
const zl = (n) => Math.round(Number(n || 0)).toLocaleString('pl-PL') + ' zł';
const liczba = (t) => { if (String(t ?? '').trim() === '') return null; const n = Number(String(t).replace(/\s|zł/g, '').replace(',', '.')); return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN; };
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'x' + Date.now() + Math.random().toString(36).slice(2));

function toast(t, ms = 2600) {
  const el = $('#toast'); el.textContent = t; el.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { el.hidden = true; }, ms);
}

// zdjęcie zmniejszone do 1800 px (JPEG); gdy przeglądarka nie umie go odczytać (np. HEIC), idzie oryginał
async function zmniejsz(plik, max = 1800) {
  try {
    const bmp = await createImageBitmap(plik);
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
    return blob ? { blob, typ: 'image/jpeg', ext: 'jpg' } : { blob: plik, typ: plik.type, ext: (plik.name.split('.').pop() || 'jpg').toLowerCase() };
  } catch (e) { return { blob: plik, typ: plik.type || 'image/jpeg', ext: (plik.name.split('.').pop() || 'jpg').toLowerCase() }; }
}

// ===================== MAGAZYN DANYCH =====================
function magazynSupabase(cfg) {
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  });
  const blad = (e) => { if (e) throw new Error(e.message || String(e)); };
  const BUCKET = 'kredyty-kampanie';
  let user = null;
  async function profil() {
    const { data, error } = await sb.from('profile').select('*').eq('id', user.id).maybeSingle(); blad(error);
    if (!data || !data.aktywny) throw new Error('To konto nie jest aktywne w zespole RM.');
    return data;
  }
  return {
    demo: false,
    async init() { const { data } = await sb.auth.getSession(); user = data.session?.user || null; return user ? { user, profil: await profil() } : null; },
    async zaloguj(email, haslo) {
      const { data, error } = await sb.auth.signInWithPassword({ email: email.trim().toLowerCase(), password: haslo });
      if (error) throw new Error(/invalid/i.test(error.message) ? 'Zły e-mail albo hasło' : error.message);
      user = data.user; return { user, profil: await profil() };
    },
    async wyloguj() { await sb.auth.signOut(); },
    async osoby() { const { data, error } = await sb.from('profile').select('id, imie, rola, aktywny'); blad(error); return data; },
    async klienci() { const { data, error } = await sb.from('kredyty_klienci').select('*').order('data'); blad(error); return data; },
    async zapiszKlienta(k, nowy) {
      const q = nowy ? sb.from('kredyty_klienci').insert(k) : sb.from('kredyty_klienci').update(k).eq('id', k.id);
      const { error } = await q; blad(error); return k;
    },
    async historia(id) { const { data, error } = await sb.from('kredyty_historia').select('*').eq('klient_id', id).order('kiedy', { ascending: false }).limit(60); blad(error); return data; },
    async usunKlienta(id) { const { data, error } = await sb.from('kredyty_klienci').delete().eq('id', id).select('id'); blad(error); if (!data?.length) throw new Error('Usuwa tylko menedżer.'); },
    async kampanie() { const { data, error } = await sb.from('kredyty_kampanie').select('*').order('utworzono', { ascending: false }); blad(error); return data; },
    async zapiszKampanie(k, nowa) {
      const q = nowa ? sb.from('kredyty_kampanie').insert(k) : sb.from('kredyty_kampanie').update(k).eq('id', k.id);
      const { error } = await q; blad(error); return k;
    },
    async usunKampanie(k) {
      const sciezki = (k.zdjecia || []).map(z => z.sciezka);
      if (sciezki.length) await sb.storage.from(BUCKET).remove(sciezki);
      const { data, error } = await sb.from('kredyty_kampanie').delete().eq('id', k.id).select('id'); blad(error);
      if (!data?.length) throw new Error('Usuwa tylko menedżer.');
    },
    async wyslijZdjecie(kampId, z) {
      const sciezka = `${kampId}/${uuid()}.${z.ext}`;
      const { error } = await sb.storage.from(BUCKET).upload(sciezka, z.blob, { contentType: z.typ, upsert: false }); blad(error);
      return sciezka;
    },
    async urlZdjecia(sciezka) { const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(sciezka, 3600); blad(error); return data.signedUrl; },
    async usunZdjecie(sciezka) { const { error } = await sb.storage.from(BUCKET).remove([sciezka]); blad(error); },
    nasluchuj(fn) {
      let t; const odpal = () => { clearTimeout(t); t = setTimeout(fn, 400); };
      sb.channel('rm-kredyty')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'kredyty_klienci' }, odpal)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'kredyty_kampanie' }, odpal)
        .subscribe();
    }
  };
}

function magazynProbny() {
  const czytaj = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } };
  const pisz = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { toast('Brak miejsca w pamięci przeglądarki', 4000); } };
  const user = { id: 'ja', email: 'tryb próbny' };
  const osoby = [{ id: 'ja', imie: 'Rafał (próba)', rola: 'admin', aktywny: true }, { id: 'natalia', imie: 'Natalia', rola: 'doradca', aktywny: true }, { id: 'jarek', imie: 'Jarek', rola: 'doradca', aktywny: true }];
  // dane przykładowe, nieprawdziwe
  if (!czytaj('kr-proba-klienci', null)) pisz('kr-proba-klienci', [
    { id: 'k1', doradca: 'Natalia', data: '2026-11-05', od_kogo: 'Biuro', klient: 'Klient A', telefon: '', nieruchomosc: 'Mieszkanie, ul. Przykładowa', zdolnosc: 'Tak', kredyt: 'Tak', kwota: 350000, zamkniecie: '2026-12-20', grupa: '', prowizja_rm: 2, notatka: '', utworzyl: 'ja', zmieniono: new Date().toISOString() },
    { id: 'k3', doradca: 'Jarek', data: '2026-09-21', od_kogo: 'Biuro', klient: 'Klient C', telefon: '', nieruchomosc: 'Mieszkanie, ul. Próbna', zdolnosc: 'Tak', kredyt: 'W trakcie', kwota: null, zamkniecie: null, grupa: '', prowizja_rm: null, notatka: '', utworzyl: 'ja', zmieniono: new Date().toISOString() },
    { id: 'k2', doradca: 'Natalia', data: '2026-11-12', od_kogo: 'Biuro', klient: 'Klient B', telefon: '', nieruchomosc: 'Dom, Przykładowo 1', zdolnosc: 'Tak', kredyt: 'W trakcie', kwota: null, zamkniecie: null, grupa: '', prowizja_rm: null, notatka: '', utworzyl: 'natalia', zmieniono: new Date().toISOString() }
  ]);
  const H = () => czytaj('kr-proba-historia', []);
  function straznik(stary, k) {
    if (!stary) return k;
    const zmianaKwot = ['prowizja_rm', 'kwota'].some(x => String(stary[x] ?? '') !== String(k[x] ?? ''));
    if (k.stawka_potw && !stary.stawka_potw) k.stawka_potw_kiedy = new Date().toISOString();
    else if (zmianaKwot) { k.stawka_potw = null; k.stawka_potw_kiedy = null; }
    const nowe = { ...stary, ...k }, wpisy = Object.keys(POLA).filter(x => String(stary[x] ?? '') !== String(nowe[x] ?? ''))
      .map(x => ({ klient_id: k.id, kto: 'ja', kiedy: new Date().toISOString(), pole: x, bylo: stary[x] ?? null, jest: nowe[x] ?? null }));
    pisz('kr-proba-historia', [...H(), ...wpisy]); return k;
  }
  const K = () => czytaj('kr-proba-klienci', []), M = () => czytaj('kr-proba-kampanie', []), Z = () => czytaj('kr-proba-zdjecia', {});
  return {
    demo: true,
    async init() { return { user, profil: osoby[0] }; },
    async zaloguj() { return { user, profil: osoby[0] }; },
    async wyloguj() {},
    async osoby() { return osoby; },
    async klienci() { return K().sort((a, b) => a.data.localeCompare(b.data)); },
    async zapiszKlienta(k, nowy) { if (!nowy) straznik(K().find(x => x.id === k.id), k); pisz('kr-proba-klienci', nowy ? [...K(), { utworzyl: 'ja', ...k }] : K().map(x => x.id === k.id ? { ...x, ...k } : x)); return k; },
    async historia(id) { return H().filter(h => h.klient_id === id).reverse(); },
    async usunKlienta(id) { pisz('kr-proba-klienci', K().filter(x => x.id !== id)); },
    async kampanie() { return M(); },
    async zapiszKampanie(k, nowa) { pisz('kr-proba-kampanie', nowa ? [{ utworzyl: 'ja', utworzono: new Date().toISOString(), ...k }, ...M()] : M().map(x => x.id === k.id ? { ...x, ...k } : x)); return k; },
    async usunKampanie(k) { const z = Z(); (k.zdjecia || []).forEach(p => delete z[p.sciezka]); pisz('kr-proba-zdjecia', z); pisz('kr-proba-kampanie', M().filter(x => x.id !== k.id)); },
    async wyslijZdjecie(kampId, z) {
      const male = await zmniejsz(z.blob, 900); // w próbie mniejsze, żeby zmieścić się w pamięci przeglądarki
      const url = await new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(male.blob); });
      const sciezka = `${kampId}/${uuid()}.jpg`; pisz('kr-proba-zdjecia', { ...Z(), [sciezka]: url }); return sciezka;
    },
    async urlZdjecia(sciezka) { return Z()[sciezka] || ''; },
    async usunZdjecie(sciezka) { const z = Z(); delete z[sciezka]; pisz('kr-proba-zdjecia', z); },
    nasluchuj() {}
  };
}

const cfg = window.RM_CONFIG || {};
const DB = (cfg.supabaseUrl && !/[?&]proba/.test(location.search)) ? magazynSupabase(cfg) : magazynProbny();

// ===================== STAN =====================
const S = { user: null, profil: null, osoby: [], klienci: [], kampanie: [], filtr: 'w_toku', doradca: 'Natalia', okres: 'miesiac', rapOd: '', rapDo: '', szukaj: '', filtrKamp: '', otwarty: null, f: null, urle: {} };
const rola = () => S.profil?.rola;
const admin = () => rola() === 'admin';
const mogeKampanie = () => ['admin', 'asystentka', 'doradca'].includes(rola());
const imie = (id) => (S.osoby.find(o => o.id === id)?.imie) || 'ktoś z zespołu';
const zamkniety = (k) => !!k.zamkniecie;
const prowDoradcy = (k) => k.kredyt === 'Tak' && k.kwota && k.prowizja_rm ? Number(k.kwota) * Number(k.prowizja_rm) / 100 : 0;
const dlaRM = (k) => prowDoradcy(k) * (dor(k).udzial || 0);
// wybrany doradca (przełącznik u góry); konto doradcy widzi tylko siebie
const mojDoradca = () => rola() === 'doradca' && !DB.demo ? Object.keys(DORADCY).find(n => bezOgonkow(S.profil?.imie || '').startsWith(bezOgonkow(n).slice(0, 3))) || 'brak' : null;
const DS = () => DORADCY[S.doradca] || DORADCY.Natalia;
const mojiKlienci = () => S.klienci.filter(k => (k.doradca || 'Natalia') === S.doradca);
const procTxt = (v) => String(v).replace('.', ',') + '%';
const dniOd = (iso) => Math.floor((new Date(dzis()) - new Date(iso.slice(0, 10))) / 864e5);
const bezKredytu = (k) => k.kredyt === 'Nie' || k.kredyt === 'Bez kredytu';
const etap = (k) => bezKredytu(k) ? (k.kredyt === 'Nie' ? 'kredyt: nie' : 'bez kredytu') : (ETAPY.filter(([p]) => k[p]).pop()?.[1] || 'przekazany');
const brakKontaktu = (k) => !k.kontakt && !k.decyzja && !k.umowa && !zamkniety(k) && !bezKredytu(k) && dniOd(k.data) >= 1;
const doZaplaty = (k) => k.zaplacono ? 0 : dlaRM(k);
const potwierdzona = (k) => !!(k.prowizja_rm && k.stawka_potw);
const godzPL = (iso) => iso ? `${dataPL(iso)} ${new Date(iso).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}` : '';

// ===================== START =====================
async function start() {
  $$('[data-wersja]').forEach(el => el.textContent = WERSJA);
  if (DB.demo) { const b = $('#banner'); b.hidden = false; b.textContent = 'Tryb próbny: dane zostają tylko w tej przeglądarce (przykłady są nieprawdziwe).'; }
  try { const s = await DB.init(); if (s) await poZalogowaniu(s); else pokazLogowanie(); }
  catch (e) { pokazLogowanie(); $('#log-blad').textContent = e.message; }
}
function pokazLogowanie() {
  $$('.screen').forEach(el => el.hidden = true); $('#tabs').hidden = true; $('#btn-wyloguj').hidden = true;
  $('#ekran-logowanie').hidden = false;
}
$('#form-logowanie').addEventListener('submit', async (e) => {
  e.preventDefault(); $('#log-blad').textContent = '';
  try { await poZalogowaniu(await DB.zaloguj($('#log-email').value, $('#log-haslo').value)); }
  catch (err) { $('#log-blad').textContent = err.message; }
});
$('#btn-wyloguj').addEventListener('click', async () => { await DB.wyloguj(); location.reload(); });

async function poZalogowaniu({ user, profil }) {
  S.user = user; S.profil = profil;
  S.osoby = await DB.osoby();
  $('#ekran-logowanie').hidden = true; $('#tabs').hidden = false; $('#btn-wyloguj').hidden = false;
  $('#fab-kampania').hidden = !mogeKampanie();
  let t = 'klienci'; try { t = localStorage.getItem('kr-zakladka') || t; S.doradca = DORADCY[localStorage.getItem('kr-doradca')] ? localStorage.getItem('kr-doradca') : 'Natalia'; } catch (e) {}
  await odswiez();
  pokazZakladke(t === 'kampanie' ? 'kampanie' : 'klienci');
  DB.nasluchuj(() => odswiez());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) odswiez(); });
}

async function odswiez() {
  try {
    const [klienci, kampanie] = await Promise.all([DB.klienci(), DB.kampanie()]);
    S.klienci = klienci; S.kampanie = kampanie;
    rysuj();
  } catch (e) { toast('Nie udało się wczytać: ' + e.message, 5000); }
}
function rysuj() {
  const n = S.klienci.filter(k => !zamkniety(k)).length;
  $('#tab-ile').textContent = n ? n : '';
  if (!$('#arkusz').hidden) return; // nie przerywamy wpisywania w karcie
  if (zakladka === 'klienci') rysujKlientow();
  if (zakladka === 'kampanie') rysujKampanie();
}

// ===================== ZAKŁADKI =====================
let zakladka = 'klienci';
function pokazZakladke(t) {
  zakladka = t;
  try { localStorage.setItem('kr-zakladka', t); } catch (e) {}
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  $$('.screen').forEach(el => el.hidden = true);
  $('#ekran-' + t).hidden = false;
  rysuj();
  window.scrollTo(0, 0);
}
$('#tabs').addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) pokazZakladke(b.dataset.tab); });

// ===================== KLIENCI =====================
function rysujKlientow() {
  const md = mojDoradca(); if (md) S.doradca = md;
  $('#doradcy').innerHTML = md ? '' : Object.values(DORADCY).map(d => `<button class="chip${S.doradca === d.kto ? ' on' : ''}" data-doradca="${d.kto}">💼 ${d.kto} · ${S.klienci.filter(k => (k.doradca || 'Natalia') === d.kto).length}</button>`).join('');
  $('#btn-raport').innerHTML = Object.values(DORADCY).filter(d => !md || d.kto === md)
    .map(d => `<button class="btn btn-ghost" data-raport="${d.kto}">📄 Raport dla ${d.kogo}</button>`).join('');
  const K = mojiKlienci(), rok = dzis().slice(0, 4);
  const wToku = K.filter(k => !zamkniety(k)), zamk = K.filter(zamkniety);
  const sumaKredytow = K.filter(k => k.kredyt === 'Tak').reduce((s, k) => s + Number(k.kwota || 0), 0);
  const rm = K.reduce((s, k) => s + dlaRM(k), 0), doZap = K.reduce((s, k) => s + doZaplaty(k), 0);
  const bezKontaktu = K.filter(brakKontaktu).length, niepotw = K.filter(k => k.prowizja_rm && !k.stawka_potw).length;
  $('#klienci-kafle').innerHTML = `<div class="kafle kafle4">
    <div class="kafel"><b>${wToku.length}</b><span>w toku</span></div>
    <div class="kafel"><b>${zamk.filter(k => k.zamkniecie.startsWith(rok)).length}</b><span>zamknięte ${rok}</span></div>
    <div class="kafel"><b>${zl(sumaKredytow)}</b><span>kredyty udzielone</span></div>
    <div class="kafel"><b>${zl(doZap)}</b><span>RM do zapłaty</span></div>
  </div>
  <div class="small muted srodek">${DS().udzial ? `Dla RM razem ${zl(rm)}, zapłacone ${zl(rm - doZap)}` : `Udział RM u ${DS().kogo} do ustalenia`}${bezKontaktu ? ` · <b class="czerwony-txt">bez kontaktu ${DS().kogo}: ${bezKontaktu}</b>` : ''}${niepotw ? ` · stawka niepotwierdzona: ${niepotw}` : ''}</div>`;

  const ile = (f) => K.filter(f).length;
  $('#klienci-filtry').innerHTML = [['w_toku', 'W toku', k => !zamkniety(k)], ['zamkniete', 'Zamknięte', zamkniety], ['wszystkie', 'Wszyscy', () => true]]
    .map(([k, n, f]) => `<button class="chip${S.filtr === k ? ' on' : ''}" data-filtr="${k}">${n} · ${ile(f)}</button>`).join('');

  const q = bezOgonkow(S.szukaj);
  const lista = K.filter(k => S.filtr === 'wszystkie' || (S.filtr === 'zamkniete') === zamkniety(k))
    .filter(k => !q || bezOgonkow(`${k.klient} ${k.nieruchomosc} ${k.notatka} ${k.bank || ''}`).includes(q))
    .sort((a, b) => S.filtr === 'zamkniete' ? b.zamkniecie.localeCompare(a.zamkniecie) : a.data.localeCompare(b.data));
  $('#klienci-lista').innerHTML = lista.length ? lista.map(k => {
    const zd = k.zdolnosc === 'Tak' ? '<span class="tag ok">zdolność ✓</span>' : k.zdolnosc === 'Nie' ? '<span class="tag zle">brak zdolności</span>' : '<span class="tag">zdolność ?</span>';
    const et = `<span class="tag${bezKredytu(k) ? ' zle' : k.umowa ? ' ok' : ''}">${esc(etap(k))}${k.bank ? ' · ' + esc(k.bank) : ''}${k.kwota ? ' · ' + zl(k.kwota) : ''}</span>`;
    const kont = brakKontaktu(k) ? `<span class="tag zle">⏱ bez kontaktu ${dniOd(k.data)} dni</span>` : '';
    const roz = dlaRM(k) ? (k.zaplacono ? `<span class="tag ok">RM ${zl(dlaRM(k))} zapłacone ✓</span>` : `<span class="tag rm">RM do zapłaty ${zl(dlaRM(k))}</span>`) : '';
    const pot = k.prowizja_rm ? (k.stawka_potw ? `<span class="tag ok">stawka ${procTxt(k.prowizja_rm)} ✓</span>` : `<span class="tag">stawka ${procTxt(k.prowizja_rm)} niepotwierdzona</span>`) : '';
    return `<button class="klient${zamkniety(k) ? ' zamk' : ''}" data-klient="${k.id}">
      <b class="klient-imie">${esc(k.klient)}</b>
      ${k.nieruchomosc ? `<div class="klient-nier">🏠 ${esc(k.nieruchomosc)}</div>` : ''}
      <div class="tagi">${kont}${zd}${et}${pot}${roz}</div>
      <div class="small muted">przekazany ${dataPL(k.data)}${zamkniety(k) ? ` · ✅ sprzedaż zamknięta ${dataPL(k.zamkniecie)}` : ''}</div>
    </button>`;
  }).join('') : `<div class="pusto">${K.length ? 'Nic tu nie pasuje.' : 'Brak klientów. Dodaj pierwszego przyciskiem ＋.'}</div>`;
}
$('#doradcy').addEventListener('click', (e) => {
  const b = e.target.closest('[data-doradca]'); if (!b) return;
  S.doradca = b.dataset.doradca; try { localStorage.setItem('kr-doradca', S.doradca); } catch (er) {}
  rysujKlientow();
});
$('#klienci-filtry').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.filtr) S.filtr = b.dataset.filtr;
  rysujKlientow();
});
$('#szukaj').addEventListener('input', (e) => { S.szukaj = e.target.value; rysujKlientow(); });
$('#klienci-lista').addEventListener('click', (e) => { const b = e.target.closest('[data-klient]'); if (b) otworzKlienta(S.klienci.find(k => k.id === b.dataset.klient)); });
$('#fab-klient').addEventListener('click', () => otworzKlienta(null));

function otworzKlienta(k) {
  S.otwarty = { typ: 'klient', id: k?.id || null };
  S.f = k ? { ...k } : { data: dzis(), od_kogo: 'Biuro', klient: '', telefon: '', nieruchomosc: '', zdolnosc: '', kredyt: '', kwota: null, zamkniecie: null, grupa: '', prowizja_rm: null, notatka: '', doradca: S.doradca, bank: '', kontakt: null, wniosek: null, decyzja: null, umowa: null, zaplacono: null, faktura: '' };
  S.hist = null; rysujKlienta(); otworzArkusz(); if (k) wczytajHistorie(k.id);
  if (!k) setTimeout(() => $('#f-klient')?.focus(), 80);
}
const chipy = (pole, opcje, wartosc) => opcje.map(([v, n]) => `<button type="button" class="chip chip-mala${wartosc === v ? ' on' : ''}" data-pole="${pole}" data-v="${esc(v)}">${n}</button>`).join('');
function rysujKlienta(usun) {
  const f = S.f, nowy = !S.otwarty.id;
  const mogePotw = rola() === 'doradca' || DB.demo, d = dor(f);
  const potwBox = !f.prowizja_rm ? '' : f.stawka_potw
    ? `<div class="potw ok">✅ Stawka ${procTxt(f.prowizja_rm)} i kwota potwierdzone przez: ${esc(imie(f.stawka_potw))}${f.stawka_potw_kiedy ? ' ' + godzPL(f.stawka_potw_kiedy) : ''}</div>`
    : `<div class="potw">⏳ Stawka czeka na potwierdzenie ${d.kogo}${mogePotw ? '' : '. Zmiana stawki albo kwoty przez kogoś z biura kasuje potwierdzenie.'}</div>`;
  $('#ark-nr').textContent = nowy ? 'Nowy klient' : (zamkniety(f) ? '✅ Zamknięte' : 'W toku');
  $('#ark-tresc').innerHTML = `<form id="f-kl">
    ${mojDoradca() ? '' : `<div class="sekcja-tytul">Doradca</div>
    <div class="chips">${chipy('doradca', Object.values(DORADCY).map(x => [x.kto, '💼 ' + x.kto]), f.doradca || 'Natalia')}</div>`}
    <label>Imię i nazwisko klienta <input type="text" id="f-klient" maxlength="120" value="${esc(f.klient)}" required autocomplete="off"></label>
    <div class="grid2"><label>Data przekazania <input type="date" id="f-data" value="${esc(f.data)}" required></label>
      <label>Telefon <input type="tel" id="f-tel" maxlength="40" value="${esc(f.telefon)}" autocomplete="off"></label></div>
    <label>Nieruchomość <input type="text" id="f-nier" maxlength="160" value="${esc(f.nieruchomosc)}" placeholder="np. Elbląg, ul. ... / nr oferty" autocomplete="off"></label>
    <div class="sekcja-tytul">Zdolność sprawdzona</div>
    <div class="chips">${chipy('zdolnosc', [['', 'Jeszcze nie'], ['Tak', 'Tak'], ['Nie', 'Nie']], f.zdolnosc)}</div>

    <div class="sekcja-tytul">Etapy u doradcy (daty)</div>
    <div class="grid2">${ETAPY.map(([p, n]) => `<label>${n} <input type="date" id="f-${p}" value="${esc(f[p] || '')}"></label>`).join('')}</div>
    <label>Bank <input type="text" id="f-bank" maxlength="80" value="${esc(f.bank || '')}" placeholder="np. PKO BP" autocomplete="off"></label>

    <div class="sekcja-tytul">Kredyt otrzymany</div>
    <div class="chips">${chipy('kredyt', [['', '—'], ...KREDYT.map(x => [x, x])], f.kredyt)}</div>
    <div class="grid2"><label>Kwota kredytu (zł) <input type="text" inputmode="decimal" id="f-kwota" value="${f.kwota ?? ''}" placeholder="np. 350000"></label>
      <label>Zamknięcie sprzedaży <input type="date" id="f-zamk" value="${esc(f.zamkniecie || '')}"></label></div>
    <div class="sekcja-tytul">Prowizja doradcy (% kwoty kredytu, podaje doradca)</div>
    <div class="chips">${STAWKI.map(v => `<button type="button" class="chip chip-mala${Number(f.prowizja_rm) === v ? ' on' : ''}" data-stawka="${v}">${procTxt(v)}</button>`).join('')}
      <input type="text" inputmode="decimal" id="f-proc" class="mini-pole" value="${String(f.prowizja_rm ?? '').replace('.', ',')}" placeholder="inna %" aria-label="Stawka doradcy w procentach"></div>
    ${potwBox}
    <div class="stan-box rozl" id="f-rozl"></div>

    <div class="sekcja-tytul">Wypłata dla RM (podział ${podzTxt(d)})</div>
    <div class="grid2"><label>Zapłacono RM <input type="date" id="f-zaplacono" value="${esc(f.zaplacono || '')}"></label>
      <label>Nr faktury <input type="text" id="f-faktura" maxlength="60" value="${esc(f.faktura || '')}" autocomplete="off"></label></div>

    <label>Notatka <textarea id="f-not" maxlength="1000" rows="3" placeholder="np. czego brakuje, termin aktu">${esc(f.notatka)}</textarea></label>
    ${mogePotw && !nowy ? `<button class="btn btn-main" type="submit" data-potwierdz="1">✅ Zapisz i potwierdź stawkę i kwotę</button><button class="btn btn-ghost" type="submit">Zapisz bez potwierdzania</button>`
      : '<button class="btn btn-main" type="submit">Zapisz</button>'}
  </form>
  ${!nowy && f.zmieniono ? `<p class="small muted">Ostatnia zmiana: ${godzPL(f.zmieniono)}${f.zmienil ? ', ' + esc(imie(f.zmienil)) : ''}</p>` : ''}
  ${nowy ? '' : '<details class="historia" id="historia"><summary>Historia zmian</summary><div id="hist-tresc" class="small muted">Wczytuję…</div></details>'}
  ${!nowy && admin() ? (usun ? `<div class="potwierdz"><b>${esc(f.klient)}</b> zniknie z listy. Tego nie da się cofnąć.
      <div class="akcje-dol"><button class="link czerwony" data-akcja="usun-tak">Tak, usuń</button><button class="link" data-akcja="anuluj">Zostaw</button></div></div>`
    : '<div class="akcje-dol"><button class="link czerwony" data-akcja="usun">Usuń klienta</button></div>') : ''}`;
  rozliczenie();
  if (S.hist && S.hist.id === S.otwarty.id) pokazHistorie();
}

// historia zmian z bazy (kto, kiedy, było, jest)
async function wczytajHistorie(id) {
  S.hist = { id, wpisy: null };
  try { S.hist.wpisy = await DB.historia(id); } catch (e) { S.hist.wpisy = []; }
  if (S.otwarty?.id === id) pokazHistorie();
}
const wartoscTxt = (pole, v) => {
  if (v == null || v === '') return '—';
  if (pole === 'stawka_potw') return 'potwierdzone';
  if (pole === 'prowizja_rm') return procTxt(Number(v));
  if (pole === 'kwota') return zl(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return dataPL(v);
  return String(v);
};
function pokazHistorie() {
  const el = $('#historia'); if (!el || !S.hist?.wpisy) return;
  const W = S.hist.wpisy;
  el.querySelector('summary').textContent = `Historia zmian (${W.length})`;
  $('#hist-tresc').innerHTML = W.length ? `<ul class="hist">${W.map(h => `<li><span class="muted">${godzPL(h.kiedy)} · ${esc(imie(h.kto))}</span><br>
    ${esc(POLA[h.pole] || h.pole)}: ${h.pole === 'stawka_potw' ? (h.jest ? '✅ potwierdzone' : '⏳ potwierdzenie skasowane') : `${esc(wartoscTxt(h.pole, h.bylo))} → <b>${esc(wartoscTxt(h.pole, h.jest))}</b>`}</li>`).join('')}</ul>`
    : '<div class="small muted">Bez zmian od dodania. Historia liczy się od wersji v3.</div>';
}
function czytajKlienta() {
  const f = S.f; if (!$('#f-kl')) return f;
  Object.assign(f, { klient: $('#f-klient').value, data: $('#f-data').value, telefon: $('#f-tel').value, nieruchomosc: $('#f-nier').value,
    kwota: $('#f-kwota').value, zamkniecie: $('#f-zamk').value || null, prowizja_rm: $('#f-proc').value, notatka: $('#f-not').value,
    bank: $('#f-bank').value, zaplacono: $('#f-zaplacono').value || null, faktura: $('#f-faktura').value });
  ETAPY.forEach(([p]) => { f[p] = $('#f-' + p).value || null; });
  return f;
}
function rozliczenie() {
  const f = S.f, el = $('#f-rozl'); if (!el) return;
  const p = { ...f, kwota: liczba($('#f-kwota')?.value), prowizja_rm: liczba($('#f-proc')?.value) };
  $$('[data-stawka]', $('#arkusz')).forEach(c => c.classList.toggle('on', Number(c.dataset.stawka) === p.prowizja_rm));
  const d = dor(f);
  const kr = $$('[data-pole="kredyt"].on', $('#arkusz'))[0]?.dataset.v ?? p.kredyt;
  const szac = p.kwota && p.prowizja_rm && !['Nie', 'Bez kredytu'].includes(kr) ? p.kwota * p.prowizja_rm / 100 : 0;
  const pol = (x) => `RM <b>${zl(x * d.udzial)}</b>, ${d.kto} ${zl(x - x * d.udzial)}`;
  el.innerHTML = !d.udzial ? `Udział RM w prowizji ${d.kogo} jeszcze nie ustalony${prowDoradcy(p) ? `. Prowizja ${d.kogo}: ${zl(prowDoradcy(p))} (${procTxt(p.prowizja_rm)})` : ''}.`
    : szac && kr === 'Tak' ? `Prowizja ${d.kogo} ${zl(szac)} (${procTxt(p.prowizja_rm)}). Podział ${podzTxt(d)}: ${pol(szac)}`
    : szac ? `Szacunek, gdy kredyt zostanie udzielony: prowizja ${d.kogo} ${zl(szac)} (${procTxt(p.prowizja_rm)}), podział ${podzTxt(d)}: ${pol(szac)}`
    : `Rozliczenie ${podzTxt(d)}: uzyskaną prowizję ${d.kogo} dzielimy po połowie, RM i ${d.kto}. Kwota policzy się po wpisaniu kwoty kredytu i stawki.`;
}

// ===================== KAMPANIE =====================
function rysujKampanie() {
  const M = S.kampanie;
  const ile = (s) => M.filter(k => !s || k.status === s).length;
  $('#kampanie-filtry').innerHTML = [['', 'Wszystkie'], ['aktywna', 'Aktywne'], ['plan', 'Plan'], ['zakonczona', 'Zakończone']]
    .map(([k, n]) => `<button class="chip${S.filtrKamp === k ? ' on' : ''}" data-fk="${k}">${n} · ${ile(k)}</button>`).join('');
  const kol = { aktywna: 0, plan: 1, zakonczona: 2 };
  const lista = M.filter(k => !S.filtrKamp || k.status === S.filtrKamp).sort((a, b) => kol[a.status] - kol[b.status] || (b.od || '').localeCompare(a.od || ''));
  $('#kampanie-lista').innerHTML = lista.length ? lista.map(k => {
    const z = (k.zdjecia || [])[0];
    const koszt = k.budzet && k.leady ? ` · ${zl(k.budzet / k.leady)} za zapytanie` : '';
    return `<button class="kamp" data-kamp="${k.id}">
      <div class="kamp-foto">${z ? `<img data-zdj="${esc(z.sciezka)}" alt="">` : '<span>📣</span>'}${(k.zdjecia || []).length > 1 ? `<i>${k.zdjecia.length}</i>` : ''}</div>
      <div class="kamp-tresc">
        <div class="row-between"><b>${esc(k.nazwa)}</b><span class="st st-${k.status}">${K_STATUS[k.status]}</span></div>
        <div class="tagi">${(k.miejsca || []).map(m => `<span class="tag">📍 ${esc(m)}</span>`).join('') || '<span class="small muted">miejsce nie wpisane</span>'}</div>
        <div class="small muted">${k.od ? dataPL(k.od) : ''}${k.do_kiedy ? ' – ' + dataPL(k.do_kiedy) : ''}${k.budzet ? ' · ' + zl(k.budzet) : ''}${k.leady != null ? ' · zapytań: ' + k.leady : ''}${koszt}</div>
      </div>
    </button>`;
  }).join('') : `<div class="pusto">${M.length ? 'Nic tu nie pasuje.' : 'Brak kampanii. ' + (mogeKampanie() ? 'Dodaj pierwszą przyciskiem ＋: miejsce, zdjęcie reklamy, termin.' : '')}</div>`;
  wczytajMiniatury($('#kampanie-lista'));
}
async function wczytajMiniatury(el) {
  for (const img of $$('img[data-zdj]', el)) {
    const s = img.dataset.zdj;
    try {
      const c = S.urle[s];
      if (!c || c.do < Date.now()) S.urle[s] = { url: await DB.urlZdjecia(s), do: Date.now() + 50 * 60000 };
      img.src = S.urle[s].url;
    } catch (e) { img.replaceWith(Object.assign(document.createElement('span'), { textContent: '🖼️' })); }
  }
}
$('#kampanie-filtry').addEventListener('click', (e) => { const b = e.target.closest('[data-fk]'); if (b) { S.filtrKamp = b.dataset.fk; rysujKampanie(); } });
$('#kampanie-lista').addEventListener('click', (e) => { const b = e.target.closest('[data-kamp]'); if (b) otworzKampanie(S.kampanie.find(k => k.id === b.dataset.kamp)); });
$('#fab-kampania').addEventListener('click', () => otworzKampanie(null));

function otworzKampanie(k) {
  S.otwarty = { typ: 'kampania', id: k?.id || null };
  S.f = k ? { ...k, miejsca: [...(k.miejsca || [])], zdjecia: [...(k.zdjecia || [])] }
    : { id: uuid(), nazwa: '', miejsca: [], status: 'aktywna', od: dzis(), do_kiedy: null, budzet: null, leady: null, link: '', notatka: '', zdjecia: [] };
  rysujKampanieKarta(); otworzArkusz();
  if (!k) setTimeout(() => $('#m-nazwa')?.focus(), 80);
}
function rysujKampanieKarta(usun) {
  const f = S.f, nowa = !S.otwarty.id, ro = !mogeKampanie();
  const wszystkieM = [...new Set([...MIEJSCA, ...S.kampanie.flatMap(k => k.miejsca || []), ...f.miejsca])];
  $('#ark-nr').textContent = nowa ? 'Nowa kampania na kredyt' : 'Kampania na kredyt';
  $('#ark-tresc').innerHTML = `<form id="f-kamp"><fieldset ${ro ? 'disabled' : ''}>
    <label>Nazwa kampanii <input type="text" id="m-nazwa" maxlength="120" value="${esc(f.nazwa)}" required placeholder="np. Sprawdź zdolność w RM, listopad" autocomplete="off"></label>
    <div class="sekcja-tytul">Status</div>
    <div class="chips">${chipy('status', Object.entries(K_STATUS), f.status)}</div>
    <div class="sekcja-tytul">Miejsce (można kilka)</div>
    <div class="chips" id="m-miejsca">${wszystkieM.map(m => `<button type="button" class="chip chip-mala${f.miejsca.includes(m) ? ' on' : ''}" data-miejsce="${esc(m)}">${esc(m)}</button>`).join('')}</div>
    <div class="dodaj-wiersz"><input type="text" id="m-inne" maxlength="60" placeholder="Inne miejsce, np. tablica w Kauflandzie" autocomplete="off"><button type="button" class="btn btn-ghost" data-akcja="miejsce">Dodaj</button></div>
    <div class="grid2" style="margin-top:12px"><label>Od <input type="date" id="m-od" value="${esc(f.od || '')}"></label>
      <label>Do <input type="date" id="m-do" value="${esc(f.do_kiedy || '')}"></label></div>
    <div class="grid2"><label>Budżet (zł) <input type="text" inputmode="decimal" id="m-budzet" value="${f.budzet ?? ''}"></label>
      <label>Ile zapytań <input type="text" inputmode="numeric" id="m-leady" value="${f.leady ?? ''}"></label></div>
    <label>Link (reklama, post, strona) <input type="url" id="m-link" maxlength="500" value="${esc(f.link)}" placeholder="https://"></label>
    <label>Notatka <textarea id="m-not" maxlength="1000" rows="3" placeholder="tekst reklamy, grupa docelowa, co zadziałało">${esc(f.notatka)}</textarea></label>
    </fieldset>
    <div class="sekcja-tytul">Zdjęcia reklamy</div>
    <div class="galeria" id="m-galeria">${f.zdjecia.map(z => `<div class="gal"><img data-zdj="${esc(z.sciezka)}" data-pokaz="${esc(z.sciezka)}" alt="">${ro ? '' : `<button type="button" class="gal-x" data-usun-zdj="${esc(z.sciezka)}" aria-label="Usuń zdjęcie">✕</button>`}</div>`).join('')}
      ${ro ? '' : '<button type="button" class="gal-dodaj" data-akcja="zdjecie">📷<span>Dodaj zdjęcie</span></button>'}</div>
    ${f.link ? `<p class="small"><a href="${esc(f.link)}" target="_blank" rel="noopener">Otwórz link kampanii ↗</a></p>` : ''}
    ${ro ? '' : '<button class="btn btn-main" type="submit">Zapisz</button>'}
  </form>
  ${!nowa && admin() ? (usun ? `<div class="potwierdz">Kampania <b>${esc(f.nazwa)}</b> i jej zdjęcia znikną. Tego nie da się cofnąć.
      <div class="akcje-dol"><button class="link czerwony" data-akcja="usun-tak">Tak, usuń</button><button class="link" data-akcja="anuluj">Zostaw</button></div></div>`
    : '<div class="akcje-dol"><button class="link czerwony" data-akcja="usun">Usuń kampanię</button></div>') : ''}`;
  wczytajMiniatury($('#m-galeria'));
}
function czytajKampanie() {
  const f = S.f; if (!$('#f-kamp')) return f;
  Object.assign(f, { nazwa: $('#m-nazwa').value, od: $('#m-od').value || null, do_kiedy: $('#m-do').value || null,
    budzet: $('#m-budzet').value, leady: $('#m-leady').value, link: $('#m-link').value, notatka: $('#m-not').value });
  return f;
}
function rekordKampanii() {
  const f = czytajKampanie(), budzet = liczba(f.budzet), leady = liczba(f.leady);
  const nazwa = f.nazwa.trim().replace(/\s+/g, ' ');
  if (!nazwa) throw new Error('Wpisz nazwę kampanii');
  if (Number.isNaN(budzet) || Number.isNaN(leady)) throw new Error('Budżet i zapytania wpisz samą liczbą');
  let link = f.link.trim(); if (link && !/^https?:\/\//i.test(link)) link = 'https://' + link;
  return { id: f.id, nazwa, miejsca: f.miejsca, status: f.status, od: f.od, do_kiedy: f.do_kiedy, budzet, leady: leady == null ? null : Math.round(leady), link, notatka: f.notatka.trim(), zdjecia: f.zdjecia };
}
async function zapiszKampanie(zamknij) {
  const r = rekordKampanii();
  const nowa = !S.otwarty.id;
  await DB.zapiszKampanie(r, nowa);
  S.otwarty.id = r.id;
  const i = S.kampanie.findIndex(x => x.id === r.id);
  if (i >= 0) S.kampanie[i] = { ...S.kampanie[i], ...r }; else S.kampanie.unshift(r);
  if (zamknij) { toast('Zapisano'); zamknijArkusz(); }
}

// ===================== RAPORT DLA NATALII (klienci przekazani przez RM) =====================
const OKRESY = [['miesiac', 'Ten miesiąc'], ['poprzedni', 'Poprzedni miesiąc'], ['rok', 'Ten rok'], ['wszystko', 'Wszystko'], ['wlasny', 'Od do']];
const MIES = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];
function zakres() {
  const d = new Date(), y = d.getFullYear(), m = d.getMonth();
  const pierwszy = (yy, mm) => isoDzien(new Date(yy, mm, 1)), ostatni = (yy, mm) => isoDzien(new Date(yy, mm + 1, 0));
  if (S.okres === 'miesiac') return { od: pierwszy(y, m), do: ostatni(y, m), opis: `${MIES[m]} ${y}` };
  if (S.okres === 'poprzedni') { const p = new Date(y, m - 1, 1); return { od: pierwszy(p.getFullYear(), p.getMonth()), do: ostatni(p.getFullYear(), p.getMonth()), opis: `${MIES[p.getMonth()]} ${p.getFullYear()}` }; }
  if (S.okres === 'rok') return { od: `${y}-01-01`, do: `${y}-12-31`, opis: `rok ${y}` };
  if (S.okres === 'wlasny') return { od: S.rapOd || '0000', do: S.rapDo || '9999', opis: `${S.rapOd ? dataPL(S.rapOd) : 'od początku'} do ${S.rapDo ? dataPL(S.rapDo) : 'dziś'}` };
  return { od: '0000', do: '9999', opis: 'cała współpraca' };
}
function daneRaportu() {
  const z = zakres();
  const L = mojiKlienci().filter(k => k.data >= z.od && k.data <= z.do).sort((a, b) => a.data.localeCompare(b.data));
  const udz = L.filter(k => k.kredyt === 'Tak');
  return { z, L, ileKredytow: udz.length, sumaKredytow: udz.reduce((s, k) => s + Number(k.kwota || 0), 0),
    nat: L.reduce((s, k) => s + prowDoradcy(k), 0), rm: L.reduce((s, k) => s + dlaRM(k), 0),
    bezStawki: udz.filter(k => !k.prowizja_rm).length, doZap: L.reduce((s, k) => s + doZaplaty(k), 0),
    niepotw: L.filter(k => k.prowizja_rm && !k.stawka_potw).length };
}
const zdolnoscTxt = (k) => k.zdolnosc || 'nie sprawdzona';
const kredytTxt = (k) => k.kredyt || 'brak informacji';
const stanTxt = (k) => k.zamkniecie ? 'zamknięte ' + dataPL(k.zamkniecie) : 'w toku';

function otworzRaport() { S.otwarty = { typ: 'raport' }; rysujRaport(); otworzArkusz(); }
function rysujRaport() {
  const R = daneRaportu(), pusto = R.L.length ? '' : ' disabled';
  $('#ark-nr').textContent = `Raport dla ${DS().kogo}`;
  $('#ark-tresc').innerHTML = `
    <div class="sekcja-tytul">Okres (data przekazania klienta)</div>
    <div class="chips">${OKRESY.map(([k, n]) => `<button type="button" class="chip chip-mala${S.okres === k ? ' on' : ''}" data-okres="${k}">${n}</button>`).join('')}</div>
    ${S.okres === 'wlasny' ? `<div class="grid2"><label>Od <input type="date" id="rap-od" value="${esc(S.rapOd)}"></label><label>Do <input type="date" id="rap-do" value="${esc(S.rapDo)}"></label></div>` : ''}
    <div class="kafle kafle4">
      <div class="kafel"><b>${R.L.length}</b><span>przekazanych</span></div>
      <div class="kafel"><b>${R.ileKredytow}</b><span>z kredytem</span></div>
      <div class="kafel"><b>${zl(R.sumaKredytow)}</b><span>kwota kredytów</span></div>
      <div class="kafel"><b>${zl(R.rm)}</b><span>dla RM (${udzTxt(DS())})</span></div>
    </div>
    <div class="small muted srodek">Zapłacone ${zl(R.rm - R.doZap)} · do zapłaty <b>${zl(R.doZap)}</b>${R.niepotw ? ` · stawka niepotwierdzona: ${R.niepotw}` : ''}</div>
    ${R.bezStawki ? `<div class="info">Brak stawki doradcy u ${R.bezStawki} ${R.bezStawki === 1 ? 'klienta' : 'klientów'} z kredytem, więc nie liczą się do sumy. ${DS().kto} wpisuje stawkę w karcie klienta.</div>` : ''}
    ${R.L.length ? `<table class="rap-tab"><tbody>${R.L.map(k => `<tr><td>${dataPL(k.data)}</td><td><b>${esc(k.klient)}</b><div class="small muted">${esc(k.nieruchomosc)}${k.nieruchomosc ? ' · ' : ''}${esc(etap(k))}${k.bank ? ' · ' + esc(k.bank) : ''}${k.kwota ? ' · ' + zl(k.kwota) : ''}${k.prowizja_rm ? ' · ' + procTxt(k.prowizja_rm) + (k.stawka_potw ? ' ✓' : ' (niepotw.)') : ''}${brakKontaktu(k) ? ' · ⏱ bez kontaktu' : ''}</div></td><td class="r">${dlaRM(k) ? zl(dlaRM(k)) + `<div class="small ${k.zaplacono ? 'ok-txt' : 'muted'}">${k.zaplacono ? 'zapł. ' + dataPL(k.zaplacono) : 'do zapłaty'}</div>` : ''}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td></td><td>Razem dla RM</td><td class="r">${zl(R.rm)}</td></tr></tfoot></table>` : '<div class="pusto">W tym okresie nie ma przekazanych klientów.</div>'}
    <button class="btn btn-main" data-akcja="rap-druk"${pusto}>🖨️ Drukuj albo zapisz PDF</button>
    <button class="btn btn-ghost" data-akcja="rap-csv"${pusto}>📊 Pobierz do Excela</button>
    <button class="btn btn-ghost" data-akcja="rap-kopiuj"${pusto}>📋 Kopiuj do maila lub SMS</button>
    <p class="small muted">${DS().udzial ? `RM dostaje ${udzTxt(DS())} prowizji ${DS().kogo}.` : `Udział RM w prowizji ${DS().kogo} jeszcze nie ustalony.`} Prowizja doradcy = stawka (% kwoty kredytu) razy kwota udzielonego kredytu.</p>`;
}
function drukujRaport() {
  const R = daneRaportu();
  const el = $('#druk'); el.className = 'raport';
  el.innerHTML = `<div class="druk-glowa"><img src="logo.png" alt=""><h1>Klienci przekazani: ${esc(DS().kto)}</h1></div>
    <div>Okres: <b>${esc(R.z.opis)}</b> · stan na ${dataPL(dzis())}</div>
    <div class="druk-podsum"><div><b>${R.L.length}</b>klientów</div><div><b>${R.ileKredytow}</b>z udzielonym kredytem</div><div><b>${zl(R.sumaKredytow)}</b>kwota kredytów</div><div><b>${zl(R.nat)}</b>prowizja doradcy</div><div><b>${zl(R.rm)}</b>dla RM (${udzTxt(DS())})</div><div><b>${zl(R.rm - R.doZap)}</b>zapłacone</div><div><b>${zl(R.doZap)}</b>do zapłaty</div></div>
    <table><thead><tr><th>Lp.</th><th>Przekazany</th><th>Klient</th><th>Telefon</th><th>Nieruchomość</th><th>Kontakt</th><th>Etap</th><th>Bank</th><th class="r">Kwota</th><th class="r">Stawka</th><th class="r">Prow. doradcy</th><th class="r">Dla RM</th><th>Zapłacono</th></tr></thead>
    <tbody>${R.L.map((k, i) => `<tr><td>${i + 1}</td><td>${dataPL(k.data)}</td><td>${esc(k.klient)}</td><td>${esc(k.telefon)}</td><td>${esc(k.nieruchomosc)}</td>
      <td>${k.kontakt ? dataPL(k.kontakt) : brakKontaktu(k) ? 'brak' : ''}</td><td>${esc(etap(k))}</td><td>${esc(k.bank || '')}</td>
      <td class="r">${k.kwota ? zl(k.kwota) : ''}</td><td class="r">${k.prowizja_rm ? procTxt(k.prowizja_rm) + (k.stawka_potw ? ' ✓' : ' ?') : ''}</td>
      <td class="r">${prowDoradcy(k) ? zl(prowDoradcy(k)) : ''}</td><td class="r">${dlaRM(k) ? zl(dlaRM(k)) : ''}</td><td>${k.zaplacono ? dataPL(k.zaplacono) + (k.faktura ? ', ' + esc(k.faktura) : '') : dlaRM(k) ? 'do zapłaty' : ''}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="8">Razem</td><td class="r">${zl(R.sumaKredytow)}</td><td></td><td class="r">${zl(R.nat)}</td><td class="r">${zl(R.rm)}</td><td>do zapłaty ${zl(R.doZap)}</td></tr></tfoot></table>
    <div class="druk-nota">${DS().udzial ? `Rozliczenie ${podzTxt(DS())}: RM Nieruchomości otrzymuje ${udzTxt(DS())} uzyskanej prowizji doradcy kredytowego od każdego przekazanego klienta.` : 'Udział RM w prowizji doradcy do ustalenia.'} Stawkę prowizji podaje doradca: ✓ potwierdzona przez doradcę w aplikacji, ? czeka na potwierdzenie. Pełna historia zmian każdego klienta jest w aplikacji Kredyty RM. Dokument zawiera dane osobowe klientów, służy tylko do rozliczenia między stronami.</div>`;
  window.print();
}
function csvRaport() {
  const R = daneRaportu(), q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const kw = (n) => n ? String(Math.round(Number(n) * 100) / 100).replace('.', ',') : '';
  const wiersze = [['Lp.', 'Data przekazania', 'Klient', 'Telefon', 'Nieruchomość', 'Zdolność', 'Pierwszy kontakt', 'Wniosek', 'Decyzja', 'Umowa kredytowa', 'Etap', 'Bank', 'Kredyt',
      'Kwota kredytu', 'Stawka doradcy %', 'Stawka potwierdzona', 'Prowizja doradcy', 'Dla RM', 'Zapłacono', 'Faktura', 'Zamknięcie sprzedaży', 'Notatka'],
    ...R.L.map((k, i) => [i + 1, dataPL(k.data), k.klient, k.telefon, k.nieruchomosc, zdolnoscTxt(k), dataPL(k.kontakt), dataPL(k.wniosek), dataPL(k.decyzja), dataPL(k.umowa), etap(k), k.bank,
      kredytTxt(k), kw(k.kwota), kw(k.prowizja_rm), k.prowizja_rm ? (k.stawka_potw ? 'tak ' + dataPL(k.stawka_potw_kiedy) : 'nie') : '', kw(prowDoradcy(k)), kw(dlaRM(k)),
      dataPL(k.zaplacono), k.faktura, dataPL(k.zamkniecie), k.notatka]),
    ['', '', 'RAZEM', '', '', '', '', '', '', '', '', '', '', kw(R.sumaKredytow), '', '', kw(R.nat), kw(R.rm), 'do zapłaty ' + kw(R.doZap), '', '', '']];
  const blob = new Blob(['﻿' + wiersze.map(w => w.map(q).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `Klienci dla ${DS().kogo} ${R.z.opis}.csv`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
async function kopiujRaport() {
  const R = daneRaportu();
  const t = [`Klienci przekazani przez RM dla ${DS().kogo}, ${R.z.opis}:`,
    ...R.L.map((k, i) => `${i + 1}. ${dataPL(k.data)} ${k.klient}${k.nieruchomosc ? ', ' + k.nieruchomosc : ''}${k.kwota ? ', kredyt ' + zl(k.kwota) : ''}, etap: ${etap(k)}${k.bank ? ' (' + k.bank + ')' : ''}${k.prowizja_rm ? ', stawka ' + procTxt(k.prowizja_rm) : ''}${dlaRM(k) ? ', dla RM ' + zl(dlaRM(k)) + (k.zaplacono ? ' zapłacone ' + dataPL(k.zaplacono) : ' do zapłaty') : ''}`),
    '', `Razem: ${R.L.length} klientów, kredyty ${zl(R.sumaKredytow)}, ${DS().udzial ? `dla RM (${udzTxt(DS())} prowizji) ${zl(R.rm)}, z tego do zapłaty ${zl(R.doZap)}` : 'udział RM do ustalenia'}.`].join('\n');
  try { await navigator.clipboard.writeText(t); toast('Skopiowane, wklej w maila lub SMS'); } catch (e) { toast('Nie udało się skopiować', 4000); }
}
$('#btn-raport').addEventListener('click', (e) => {
  const b = e.target.closest('[data-raport]'); if (!b) return;
  S.doradca = b.dataset.raport; try { localStorage.setItem('kr-doradca', S.doradca); } catch (er) {}
  rysujKlientow(); otworzRaport();
});

// ===================== KARTA: wspólne zdarzenia =====================
function otworzArkusz() { $('#tlo').hidden = false; $('#arkusz').hidden = false; document.body.style.overflow = 'hidden'; }
function zamknijArkusz() { $('#tlo').hidden = true; $('#arkusz').hidden = true; document.body.style.overflow = ''; S.otwarty = null; S.f = null; rysuj(); }
$('#tlo').addEventListener('click', zamknijArkusz);
$('#ark-zamknij').addEventListener('click', zamknijArkusz);
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('#podglad').hidden) { $('#podglad').hidden = true; return; }
  if (!$('#arkusz').hidden) zamknijArkusz();
});
$('#podglad').addEventListener('click', () => { $('#podglad').hidden = true; });

$('#arkusz').addEventListener('click', async (e) => {
  const O = S.otwarty; if (!O) return;
  const img = e.target.closest('[data-pokaz]');
  if (img && img.src) { $('#podglad img').src = img.src; $('#podglad').hidden = false; return; }
  const b = e.target.closest('button'); if (!b) return;
  if (O.typ === 'raport') {
    if (b.dataset.okres) { S.okres = b.dataset.okres; rysujRaport(); }
    if (b.dataset.akcja === 'rap-druk') drukujRaport();
    if (b.dataset.akcja === 'rap-csv') csvRaport();
    if (b.dataset.akcja === 'rap-kopiuj') kopiujRaport();
    return;
  }
  if (b.dataset.stawka) { $('#f-proc').value = b.dataset.stawka.replace('.', ','); rozliczenie(); return; }
  const klient = O.typ === 'klient';
  if (b.dataset.pole) {
    if (klient) czytajKlienta(); else czytajKampanie();
    S.f[b.dataset.pole] = b.dataset.v;
    $$(`[data-pole="${b.dataset.pole}"]`, $('#arkusz')).forEach(c => c.classList.toggle('on', c === b));
    if (klient) { if (b.dataset.pole === 'doradca') { czytajKlienta(); rysujKlienta(); } else rozliczenie(); }
    return;
  }
  if (b.dataset.miejsce) {
    const m = b.dataset.miejsce;
    S.f.miejsca = S.f.miejsca.includes(m) ? S.f.miejsca.filter(x => x !== m) : [...S.f.miejsca, m];
    b.classList.toggle('on', S.f.miejsca.includes(m)); return;
  }
  const a = b.dataset.akcja;
  if (a === 'miejsce') {
    const m = $('#m-inne').value.trim().replace(/\s+/g, ' ').slice(0, 60); if (!m) { $('#m-inne').focus(); return; }
    czytajKampanie(); if (!S.f.miejsca.includes(m)) S.f.miejsca.push(m); rysujKampanieKarta(); return;
  }
  if (a === 'zdjecie') {
    try { if (!S.otwarty.id) { await zapiszKampanie(false); toast('Kampania zapisana, wybierz zdjęcie'); } }
    catch (err) { toast(err.message, 4000); $('#m-nazwa')?.focus(); return; }
    $('#plik-zdjecie').click(); return;
  }
  if (b.dataset.usunZdj) {
    if (!confirm('Usunąć to zdjęcie?')) return;
    const s = b.dataset.usunZdj;
    try {
      czytajKampanie(); S.f.zdjecia = S.f.zdjecia.filter(z => z.sciezka !== s);
      await zapiszKampanie(false); await DB.usunZdjecie(s).catch(() => {}); rysujKampanieKarta(); toast('Zdjęcie usunięte');
    } catch (err) { toast('Nie udało się: ' + err.message, 5000); }
    return;
  }
  if (a === 'usun') { if (klient) { czytajKlienta(); rysujKlienta(true); } else { czytajKampanie(); rysujKampanieKarta(true); } return; }
  if (a === 'anuluj') { if (klient) rysujKlienta(); else rysujKampanieKarta(); return; }
  if (a === 'usun-tak') {
    try {
      if (klient) { await DB.usunKlienta(O.id); S.klienci = S.klienci.filter(x => x.id !== O.id); }
      else { await DB.usunKampanie(S.kampanie.find(x => x.id === O.id) || S.f); S.kampanie = S.kampanie.filter(x => x.id !== O.id); }
      toast('Usunięte'); zamknijArkusz();
    } catch (err) { toast('Nie udało się: ' + err.message, 5000); }
  }
});
$('#arkusz').addEventListener('change', (e) => { if (['rap-od', 'rap-do'].includes(e.target.id)) { S[e.target.id === 'rap-od' ? 'rapOd' : 'rapDo'] = e.target.value; rysujRaport(); } });
$('#arkusz').addEventListener('input', (e) => { if (['f-kwota', 'f-zamk', 'f-proc'].includes(e.target.id)) rozliczenie(); });
$('#arkusz').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'm-inne') { e.preventDefault(); $('[data-akcja="miejsce"]').click(); } });

$('#plik-zdjecie').addEventListener('change', async (e) => {
  const pliki = [...e.target.files]; e.target.value = '';
  if (!pliki.length || !S.f) return;
  czytajKampanie();
  let n = 0;
  for (const p of pliki) {
    toast(`Wysyłam ${n + 1} z ${pliki.length}…`, 20000);
    try { const sciezka = await DB.wyslijZdjecie(S.f.id, await zmniejsz(p)); S.f.zdjecia.push({ sciezka, nazwa: p.name.slice(0, 80) }); n++; }
    catch (err) { toast('Nie wysłało się: ' + err.message, 5000); break; }
  }
  if (!n) return;
  try { await zapiszKampanie(false); rysujKampanieKarta(); toast(n === 1 ? 'Zdjęcie dodane' : `Dodane zdjęcia: ${n}`); }
  catch (err) { toast('Nie zapisało się: ' + err.message, 5000); }
});

$('#arkusz').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('[type=submit]'); if (btn) btn.disabled = true;
  try {
    if (e.target.id === 'f-kamp') { await zapiszKampanie(true); return; }
    if (e.target.id !== 'f-kl') return;
    const f = czytajKlienta(), kwota = liczba(f.kwota), proc = liczba(f.prowizja_rm);
    const klient = f.klient.trim().replace(/\s+/g, ' ');
    if (!klient) throw new Error('Wpisz imię i nazwisko klienta');
    if (proc != null && proc > 10) throw new Error('Wpisz stawkę w procentach, np. 2 albo 1,5');
    if (Number.isNaN(kwota) || Number.isNaN(proc)) throw new Error('Kwoty wpisz samą liczbą, np. 350000');
    const nowy = !S.otwarty.id;
    const r = { id: S.otwarty.id || uuid(), data: f.data || dzis(), od_kogo: 'Biuro', klient, telefon: f.telefon.trim(), nieruchomosc: f.nieruchomosc.trim(),
      zdolnosc: f.zdolnosc, kredyt: f.kredyt, kwota, zamkniecie: f.zamkniecie, grupa: '', prowizja_rm: proc, doradca: f.doradca || S.doradca, notatka: f.notatka.trim(), zmienil: S.user.id, zmieniono: new Date().toISOString(),
      bank: (f.bank || '').trim(), kontakt: f.kontakt, wniosek: f.wniosek, decyzja: f.decyzja, umowa: f.umowa, zaplacono: f.zaplacono, faktura: (f.faktura || '').trim() };
    if (e.submitter?.dataset.potwierdz) { if (!proc || !kwota) throw new Error('Wpisz kwotę kredytu i stawkę, żeby potwierdzić'); r.stawka_potw = S.user.id; }
    await DB.zapiszKlienta(r, nowy);
    const i = S.klienci.findIndex(x => x.id === r.id);
    if (i >= 0) S.klienci[i] = { ...S.klienci[i], ...r }; else S.klienci.push({ utworzyl: S.user.id, ...r });
    toast(r.stawka_potw ? 'Zapisano i potwierdzono ✅' : r.zamkniecie ? 'Zapisano, sprzedaż zamknięta ✅' : 'Zapisano'); zamknijArkusz(); odswiez();
  } catch (err) { toast(err.message.startsWith('Wpisz') || err.message.startsWith('Kwoty') || err.message.startsWith('Budżet') ? err.message : 'Nie zapisało się: ' + err.message, 5000); }
  finally { if (btn) btn.disabled = false; }
});

// ===================== SERVICE WORKER =====================
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
  let przeladowano = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (przeladowano || !$('#arkusz').hidden || ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
    przeladowano = true; location.reload();
  });
}

start();
