// KREDYTY RM: współpraca z doradcą kredytowym (Natalia). Klienci dla Natalii od RM (i od Natalii do RM)
// oraz kampanie reklamowe na kredyt (miejsce, zdjęcie, termin, budżet, zapytania).
// Dane w bazie Zadań RM (Supabase, to samo logowanie). Bez config.js albo z ?proba: tryb próbny w tej przeglądarce.
const WERSJA = 'v1';

// rozliczenie wg warunków z maila do Natalii z 20.10.2026 (umowa jeszcze niepodpisana, do zmiany tutaj)
const STAWKA = { A: 0.01, B: 0.008 };      // RM od kwoty kredytu (brutto): A klient transakcji RM, B klient z marki RM
const DLA_NATALII = 0.10;                   // Natalia od prowizji RM netto za poleconą nieruchomość / klienta
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
  const osoby = [{ id: 'ja', imie: 'Rafał (próba)', rola: 'admin', aktywny: true }, { id: 'natalia', imie: 'Natalia', rola: 'doradca', aktywny: true }];
  // dane przykładowe, nieprawdziwe
  if (!czytaj('kr-proba-klienci', null)) pisz('kr-proba-klienci', [
    { id: 'k1', data: '2026-11-05', od_kogo: 'Biuro', klient: 'Klient A', telefon: '', nieruchomosc: 'Mieszkanie, ul. Przykładowa', zdolnosc: 'Tak', kredyt: 'Tak', kwota: 350000, zamkniecie: '2026-12-20', grupa: 'A', prowizja_rm: null, notatka: '', utworzyl: 'ja', zmieniono: new Date().toISOString() },
    { id: 'k2', data: '2026-11-12', od_kogo: 'Natalia', klient: 'Klient B', telefon: '', nieruchomosc: 'Dom, Przykładowo 1', zdolnosc: 'Tak', kredyt: 'W trakcie', kwota: null, zamkniecie: null, grupa: '', prowizja_rm: 12000, notatka: '', utworzyl: 'natalia', zmieniono: new Date().toISOString() }
  ]);
  const K = () => czytaj('kr-proba-klienci', []), M = () => czytaj('kr-proba-kampanie', []), Z = () => czytaj('kr-proba-zdjecia', {});
  return {
    demo: true,
    async init() { return { user, profil: osoby[0] }; },
    async zaloguj() { return { user, profil: osoby[0] }; },
    async wyloguj() {},
    async osoby() { return osoby; },
    async klienci() { return K().sort((a, b) => a.data.localeCompare(b.data)); },
    async zapiszKlienta(k, nowy) { pisz('kr-proba-klienci', nowy ? [...K(), { utworzyl: 'ja', ...k }] : K().map(x => x.id === k.id ? { ...x, ...k } : x)); return k; },
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
const S = { user: null, profil: null, osoby: [], klienci: [], kampanie: [], filtr: 'w_toku', odKogo: '', szukaj: '', filtrKamp: '', otwarty: null, f: null, urle: {} };
const rola = () => S.profil?.rola;
const admin = () => rola() === 'admin';
const mogeKampanie = () => ['admin', 'asystentka', 'doradca'].includes(rola());
const imie = (id) => (S.osoby.find(o => o.id === id)?.imie) || 'ktoś z zespołu';
const zamkniety = (k) => !!k.zamkniecie;
// ile RM dostaje od Natalii za klienta (1% / 0,8% kwoty kredytu) i ile Natalia od RM (10% prowizji RM netto)
const dlaRM = (k) => k.od_kogo === 'Biuro' && k.kredyt === 'Tak' && k.kwota ? Number(k.kwota) * (STAWKA[k.grupa] ?? STAWKA.A) : 0;
const dlaNatalii = (k) => k.od_kogo === 'Natalia' && zamkniety(k) && k.prowizja_rm ? Number(k.prowizja_rm) * DLA_NATALII : 0;

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
  let t = 'klienci'; try { t = localStorage.getItem('kr-zakladka') || t; } catch (e) {}
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
  const K = S.klienci, rok = dzis().slice(0, 4);
  const wToku = K.filter(k => !zamkniety(k)), zamk = K.filter(zamkniety);
  const sumaKredytow = K.filter(k => k.kredyt === 'Tak').reduce((s, k) => s + Number(k.kwota || 0), 0);
  const rm = K.reduce((s, k) => s + dlaRM(k), 0), nat = K.reduce((s, k) => s + dlaNatalii(k), 0);
  $('#klienci-kafle').innerHTML = `<div class="kafle kafle4">
    <div class="kafel"><b>${wToku.length}</b><span>w toku</span></div>
    <div class="kafel"><b>${zamk.filter(k => k.zamkniecie.startsWith(rok)).length}</b><span>zamknięte ${rok}</span></div>
    <div class="kafel"><b>${zl(sumaKredytow)}</b><span>kredyty udzielone</span></div>
    <div class="kafel"><b>${zl(rm)}</b><span>dla RM od Natalii</span></div>
  </div>${nat ? `<div class="small muted srodek">Dla Natalii od RM (10% prowizji RM netto): <b>${zl(nat)}</b></div>` : ''}`;

  const ile = (f) => K.filter(f).length;
  const zOd = (k) => !S.odKogo || k.od_kogo === S.odKogo;
  $('#klienci-filtry').innerHTML = [['w_toku', 'W toku', k => !zamkniety(k)], ['zamkniete', 'Zamknięte', zamkniety], ['wszystkie', 'Wszyscy', () => true]]
    .map(([k, n, f]) => `<button class="chip${S.filtr === k ? ' on' : ''}" data-filtr="${k}">${n} · ${ile(x => f(x) && zOd(x))}</button>`).join('')
    + '<span class="chips-sep"></span>'
    + [['', 'Wszyscy'], ['Biuro', 'Od RM dla Natalii'], ['Natalia', 'Od Natalii dla RM']]
      .map(([k, n]) => `<button class="chip chip-mala${S.odKogo === k ? ' on' : ''}" data-od="${k}">${n}</button>`).join('');

  const q = bezOgonkow(S.szukaj);
  const lista = K.filter(k => S.filtr === 'wszystkie' || (S.filtr === 'zamkniete') === zamkniety(k)).filter(zOd)
    .filter(k => !q || bezOgonkow(`${k.klient} ${k.nieruchomosc} ${k.notatka}`).includes(q))
    .sort((a, b) => S.filtr === 'zamkniete' ? b.zamkniecie.localeCompare(a.zamkniecie) : a.data.localeCompare(b.data));
  $('#klienci-lista').innerHTML = lista.length ? lista.map(k => {
    const zd = k.zdolnosc === 'Tak' ? '<span class="tag ok">zdolność ✓</span>' : k.zdolnosc === 'Nie' ? '<span class="tag zle">brak zdolności</span>' : '<span class="tag">zdolność ?</span>';
    const kr = k.kredyt ? `<span class="tag${k.kredyt === 'Tak' ? ' ok' : k.kredyt === 'Nie' ? ' zle' : ''}">kredyt: ${esc(k.kredyt.toLowerCase())}${k.kwota ? ' ' + zl(k.kwota) : ''}</span>` : '';
    const roz = dlaRM(k) ? `<span class="tag rm">RM: ${zl(dlaRM(k))}</span>` : dlaNatalii(k) ? `<span class="tag rm">Natalia: ${zl(dlaNatalii(k))}</span>` : '';
    return `<button class="klient${zamkniety(k) ? ' zamk' : ''}" data-klient="${k.id}">
      <div class="row-between"><b class="klient-imie">${esc(k.klient)}</b><span class="od od-${k.od_kogo === 'Biuro' ? 'rm' : 'nat'}">${k.od_kogo === 'Biuro' ? 'od RM' : 'od Natalii'}</span></div>
      ${k.nieruchomosc ? `<div class="klient-nier">🏠 ${esc(k.nieruchomosc)}</div>` : ''}
      <div class="tagi">${zd}${kr}${roz}</div>
      <div class="small muted">${dataPL(k.data)}${zamkniety(k) ? ` · ✅ zamknięte ${dataPL(k.zamkniecie)}` : ' · w toku'}${k.grupa ? ` · grupa ${k.grupa}` : ''}</div>
    </button>`;
  }).join('') : `<div class="pusto">${K.length ? 'Nic tu nie pasuje.' : 'Brak klientów. Dodaj pierwszego przyciskiem ＋.'}</div>`;
}
$('#klienci-filtry').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.filtr) S.filtr = b.dataset.filtr;
  if (b.dataset.od !== undefined) S.odKogo = b.dataset.od;
  rysujKlientow();
});
$('#szukaj').addEventListener('input', (e) => { S.szukaj = e.target.value; rysujKlientow(); });
$('#klienci-lista').addEventListener('click', (e) => { const b = e.target.closest('[data-klient]'); if (b) otworzKlienta(S.klienci.find(k => k.id === b.dataset.klient)); });
$('#fab-klient').addEventListener('click', () => otworzKlienta(null));

function otworzKlienta(k) {
  S.otwarty = { typ: 'klient', id: k?.id || null };
  S.f = k ? { ...k } : { data: dzis(), od_kogo: rola() === 'doradca' ? 'Natalia' : 'Biuro', klient: '', telefon: '', nieruchomosc: '', zdolnosc: '', kredyt: '', kwota: null, zamkniecie: null, grupa: 'A', prowizja_rm: null, notatka: '' };
  rysujKlienta(); otworzArkusz();
  if (!k) setTimeout(() => $('#f-klient')?.focus(), 80);
}
const chipy = (pole, opcje, wartosc) => opcje.map(([v, n]) => `<button type="button" class="chip chip-mala${wartosc === v ? ' on' : ''}" data-pole="${pole}" data-v="${esc(v)}">${n}</button>`).join('');
function rysujKlienta(usun) {
  const f = S.f, nowy = !S.otwarty.id;
  $('#ark-nr').textContent = nowy ? 'Nowy klient' : (zamkniety(f) ? '✅ Zamknięte' : 'W toku');
  $('#ark-tresc').innerHTML = `<form id="f-kl">
    <div class="sekcja-tytul">Od kogo</div>
    <div class="chips">${chipy('od_kogo', [['Biuro', '🏠 Od RM dla Natalii'], ['Natalia', '💼 Od Natalii dla RM']], f.od_kogo)}</div>
    <label>Imię i nazwisko klienta <input type="text" id="f-klient" maxlength="120" value="${esc(f.klient)}" required autocomplete="off"></label>
    <div class="grid2"><label>Data umowy <input type="date" id="f-data" value="${esc(f.data)}" required></label>
      <label>Telefon <input type="tel" id="f-tel" maxlength="40" value="${esc(f.telefon)}" autocomplete="off"></label></div>
    <label>Nieruchomość <input type="text" id="f-nier" maxlength="160" value="${esc(f.nieruchomosc)}" placeholder="np. Elbląg, ul. ... / nr oferty" autocomplete="off"></label>
    <div class="sekcja-tytul">Zdolność sprawdzona</div>
    <div class="chips">${chipy('zdolnosc', [['', 'Jeszcze nie'], ['Tak', 'Tak'], ['Nie', 'Nie']], f.zdolnosc)}</div>
    <div class="sekcja-tytul">Kredyt otrzymany</div>
    <div class="chips">${chipy('kredyt', [['', '—'], ...KREDYT.map(x => [x, x])], f.kredyt)}</div>
    <div class="grid2"><label>Kwota kredytu (zł) <input type="text" inputmode="decimal" id="f-kwota" value="${f.kwota ?? ''}" placeholder="np. 350000"></label>
      <label>Zamknięcie sprzedaży <input type="date" id="f-zamk" value="${esc(f.zamkniecie || '')}"></label></div>
    <div id="box-grupa"${f.od_kogo === 'Biuro' ? '' : ' hidden'}>
      <div class="sekcja-tytul">Grupa (ile RM dostaje od Natalii)</div>
      <div class="chips">${chipy('grupa', [['A', 'A · klient transakcji RM · 1%'], ['B', 'B · z marki RM (reklama, telefon) · 0,8%']], f.grupa)}</div>
    </div>
    <div id="box-prow"${f.od_kogo === 'Natalia' ? '' : ' hidden'}>
      <label>Prowizja RM netto z tej transakcji (zł) <input type="text" inputmode="decimal" id="f-prow" value="${f.prowizja_rm ?? ''}" placeholder="np. 12000, Natalia dostaje 10%"></label>
    </div>
    <label>Notatka <textarea id="f-not" maxlength="1000" rows="3" placeholder="np. bank, czego brakuje, termin aktu">${esc(f.notatka)}</textarea></label>
    <div class="stan-box rozl" id="f-rozl"></div>
    <button class="btn btn-main" type="submit">Zapisz</button>
  </form>
  ${!nowy && f.zmieniono ? `<p class="small muted">Ostatnia zmiana: ${dataPL(f.zmieniono)}${f.zmienil ? ', ' + esc(imie(f.zmienil)) : ''}</p>` : ''}
  ${!nowy && admin() ? (usun ? `<div class="potwierdz"><b>${esc(f.klient)}</b> zniknie z listy. Tego nie da się cofnąć.
      <div class="akcje-dol"><button class="link czerwony" data-akcja="usun-tak">Tak, usuń</button><button class="link" data-akcja="anuluj">Zostaw</button></div></div>`
    : '<div class="akcje-dol"><button class="link czerwony" data-akcja="usun">Usuń klienta</button></div>') : ''}`;
  rozliczenie();
}
function czytajKlienta() {
  const f = S.f; if (!$('#f-kl')) return f;
  Object.assign(f, { klient: $('#f-klient').value, data: $('#f-data').value, telefon: $('#f-tel').value, nieruchomosc: $('#f-nier').value,
    kwota: $('#f-kwota').value, zamkniecie: $('#f-zamk').value || null, prowizja_rm: $('#f-prow').value, notatka: $('#f-not').value });
  return f;
}
function rozliczenie() {
  const f = S.f, el = $('#f-rozl'); if (!el) return;
  const kwota = liczba($('#f-kwota')?.value), prow = liczba($('#f-prow')?.value);
  const p = { ...f, kwota, prowizja_rm: prow, zamkniecie: $('#f-zamk')?.value || null };
  if (f.od_kogo === 'Biuro') el.innerHTML = p.kredyt === 'Tak' && kwota ? `Dla RM od Natalii: <b>${zl(dlaRM(p))}</b> (${f.grupa === 'B' ? '0,8' : '1'}% kwoty kredytu, brutto)` : `Rozliczenie: ${f.grupa === 'B' ? '0,8' : '1'}% kwoty kredytu dla RM, gdy kredyt = Tak i jest kwota.`;
  else el.innerHTML = prow ? (p.zamkniecie ? `Dla Natalii od RM: <b>${zl(dlaNatalii(p))}</b> (10% prowizji RM netto, po wpływie prowizji)` : `Po zamknięciu sprzedaży dla Natalii: <b>${zl(prow * DLA_NATALII)}</b> (10% prowizji RM netto)`) : 'Rozliczenie: Natalia dostaje 10% prowizji RM netto, gdy sprzedaż się zamknie.';
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
  const klient = O.typ === 'klient';
  if (b.dataset.pole) {
    if (klient) czytajKlienta(); else czytajKampanie();
    S.f[b.dataset.pole] = b.dataset.v;
    $$(`[data-pole="${b.dataset.pole}"]`, $('#arkusz')).forEach(c => c.classList.toggle('on', c === b));
    if (klient) { $('#box-grupa').hidden = S.f.od_kogo !== 'Biuro'; $('#box-prow').hidden = S.f.od_kogo !== 'Natalia'; rozliczenie(); }
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
$('#arkusz').addEventListener('input', (e) => { if (['f-kwota', 'f-prow', 'f-zamk'].includes(e.target.id)) rozliczenie(); });
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
    const f = czytajKlienta(), kwota = liczba(f.kwota), prow = liczba(f.prowizja_rm);
    const klient = f.klient.trim().replace(/\s+/g, ' ');
    if (!klient) throw new Error('Wpisz imię i nazwisko klienta');
    if (Number.isNaN(kwota) || Number.isNaN(prow)) throw new Error('Kwoty wpisz samą liczbą, np. 350000');
    const nowy = !S.otwarty.id;
    const r = { id: S.otwarty.id || uuid(), data: f.data || dzis(), od_kogo: f.od_kogo, klient, telefon: f.telefon.trim(), nieruchomosc: f.nieruchomosc.trim(),
      zdolnosc: f.zdolnosc, kredyt: f.kredyt, kwota, zamkniecie: f.zamkniecie, grupa: f.od_kogo === 'Biuro' ? (f.grupa || 'A') : '',
      prowizja_rm: f.od_kogo === 'Natalia' ? prow : null, notatka: f.notatka.trim(), zmienil: S.user.id, zmieniono: new Date().toISOString() };
    await DB.zapiszKlienta(r, nowy);
    const i = S.klienci.findIndex(x => x.id === r.id);
    if (i >= 0) S.klienci[i] = { ...S.klienci[i], ...r }; else S.klienci.push({ utworzyl: S.user.id, ...r });
    toast(r.zamkniecie ? 'Zapisano, sprzedaż zamknięta ✅' : 'Zapisano'); zamknijArkusz();
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
