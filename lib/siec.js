/* Komunikacja z Solaną: wysyłanie memo (fee payer = sponsor), odczyt fazy, odczyt historii sponsora.
   Przeglądarka: globalny Siec (wymaga solanaWeb3, Protokol, Base58). Node: require('./siec.js').

   Limity publicznego api.devnet.solana.com na jedno IP (zmierzone 28.10.2026):
   - sendTransaction: ok. 20 / 10 s; przy dalszym zasypywaniu blokada trwa (odrzucone też się liczą),
   - getSignaturesForAddress, getTransaction: ok. 10 / 10 s,
   - getLatestBlockhash, getSignatureStatuses i inne proste: ok. 40 / 10 s, wszystko razem ok. 100 / 10 s,
   - websocket: ok. 10 jednoczesnych połączeń.
   Cała sala może być za jednym IP, więc: na żywo websocket (gdy się uda połączyć), wysyłanie
   z kolejką i losowym, rosnącym odstępem między próbami, zapytania HTTP rzadkie i z rozrzutem. */
(function (root, factory) {
  var node = typeof module === 'object' && module.exports;
  var w3 = node ? require('@solana/web3.js') : root.solanaWeb3;
  var P = node ? require('./protokol.js') : root.Protokol;
  var m = factory(w3, P, root, node);
  if (node) module.exports = m; else root.Siec = m;
})(typeof self !== 'undefined' ? self : this, function (w3, P, root, node) {
  'use strict';

  function czekaj(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }
  function rozrzut(ms, proc) { return Math.round(ms * (1 - proc + 2 * proc * Math.random())); }

  /* Własne ponawianie zamiast wbudowanego w web3.js: przy limicie (429) web3 ponawia co 0,5-8 s
     bez rozrzutu, a zapytania odrzucone też liczą się do limitu, więc cała sala naraz potrafi
     zablokować IP na dłużej. Tu czekamy dłużej i losowo, żeby telefony się rozjechały w czasie. */
  function czyLimit(err) { return /429|Too Many Requests|Too many requests/i.test(String(err && (err.message || err))); }
  async function zPonowieniem(fn, proby) {
    var ostatni;
    for (var i = 0; i < (proby || 5); i++) {
      try { return await fn(); } catch (err) {
        ostatni = err;
        if (!czyLimit(err) && !/fetch|network|Failed to fetch|ECONN|ETIMEDOUT|socket/i.test(String(err && err.message))) throw err;
        await czekaj(rozrzut(Math.min(20000, 1500 * Math.pow(2, i)), 0.5));
      }
    }
    throw ostatni;
  }

  function polacz(cfg, url) {
    return new w3.Connection(url || cfg.rpc, { commitment: 'confirmed', wsEndpoint: cfg.ws || undefined, disableRetryOnRateLimit: true });
  }

  function keypairZSekretu(sekret) {
    if (typeof sekret === 'string') {
      var B = node ? require('./base58.js') : root.Base58;
      return w3.Keypair.fromSecretKey(B.dekoduj(sekret));
    }
    return w3.Keypair.fromSecretKey(Uint8Array.from(sekret));
  }

  function memoIx(aktor, tekst) {
    return new w3.TransactionInstruction({
      keys: [{ pubkey: aktor, isSigner: true, isWritable: false }],
      programId: new w3.PublicKey(P.MEMO_PROGRAM),
      data: new TextEncoder().encode(tekst)
    });
  }

  /* ---------- websocket JSON-RPC (subskrypcje z automatycznym ponowieniem) ---------- */
  function KlientWs(url) {
    this.url = url; this.ws = null; this.ok = false; this.id = 100; this.proby = 0;
    this.subs = [];          // {method, params, cb, jednorazowa, subId, reqId}
    this.naStan = [];        // cb(ok)
    this.zamkniety = false; this.otwarto = false;
    var self = this;
    // cała sala otwiera stronę naraz: websocket z rozrzutem (limit nowych połączeń na IP)
    setTimeout(function () { self.polacz(); }, Math.random() * (KlientWs.rozrzutStartu || 0));
  }
  KlientWs.rozrzutStartu = 8000;
  KlientWs.maxNieudanych = 4;
  KlientWs.prototype.polacz = function () {
    var self = this, ws;
    if (typeof WebSocket === 'undefined') return;
    try { ws = new WebSocket(this.url); } catch (err) { return this.ponow(); }
    this.ws = ws;
    ws.onopen = function () {
      self.proby = 0; self.otwarto = true;
      self.subs.forEach(function (s) { self.wyslijSub(s); });
      self.ustawStan(true);
      clearInterval(self.ping);
      // bez ruchu publiczne RPC potrafi zamknąć połączenie; tania wiadomość co 30 s
      self.ping = setInterval(function () {
        try { ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })); } catch (err) { /* nic */ }
      }, 30000);
    };
    ws.onmessage = function (ev) {
      var d; try { d = JSON.parse(ev.data); } catch (err) { return; }
      if (d.id !== undefined && d.id !== 1) {
        self.subs.forEach(function (s) { if (s.reqId === d.id && typeof d.result === 'number') s.subId = d.result; });
        return;
      }
      if (d.params && d.params.subscription !== undefined) {
        var s = null;
        self.subs.forEach(function (x) { if (x.subId === d.params.subscription) s = x; });
        if (!s) return;
        if (s.jednorazowa) self.subs = self.subs.filter(function (x) { return x !== s; });
        try { s.cb(d.params.result); } catch (err) { if (root.console) console.error(err); }
      }
    };
    ws.onclose = function () {
      clearInterval(self.ping);
      self.ws = null;
      self.subs.forEach(function (s) { s.subId = null; });
      self.ustawStan(false);
      self.ponow();
    };
    ws.onerror = function () { try { ws.close(); } catch (err) { /* nic */ } };
  };
  KlientWs.prototype.ponow = function () {
    if (this.zamkniety) return;
    var self = this;
    this.proby++;
    // publiczny devnet: ok. 10 websocketów na IP; odmowy też zjadają limit połączeń, więc kto się
    // nie zmieścił, próbuje rzadko (30-90 s) i po kilku nieudanych próbach zostaje na zapasie
    if (!this.otwarto && this.proby > KlientWs.maxNieudanych) return;
    var baza = this.otwarto ? 3000 * Math.pow(2, Math.min(this.proby, 4) - 1) : 45000;
    setTimeout(function () { self.polacz(); }, rozrzut(baza, 0.5));
  };
  KlientWs.prototype.ustawStan = function (ok) {
    var byl = this.ok; this.ok = ok;
    if (byl !== ok) this.naStan.forEach(function (cb) { try { cb(ok); } catch (err) { /* nic */ } });
  };
  KlientWs.prototype.wyslijSub = function (s) {
    if (!this.ws || this.ws.readyState !== 1) return;
    s.reqId = ++this.id;
    this.ws.send(JSON.stringify({ jsonrpc: '2.0', id: s.reqId, method: s.method, params: s.params }));
  };
  KlientWs.prototype.subskrybuj = function (method, params, cb, jednorazowa) {
    var s = { method: method, params: params, cb: cb, jednorazowa: !!jednorazowa, subId: null, reqId: null };
    this.subs.push(s);
    this.wyslijSub(s);
    var self = this;
    return { stop: function () {
      self.subs = self.subs.filter(function (x) { return x !== s; });
      if (s.subId !== null && self.ws && self.ws.readyState === 1) {
        var unsub = method.replace('Subscribe', 'Unsubscribe');
        self.ws.send(JSON.stringify({ jsonrpc: '2.0', id: ++self.id, method: unsub, params: [s.subId] }));
      }
    } };
  };
  KlientWs.prototype.zamknij = function () {
    this.zamkniety = true; clearInterval(this.ping);
    if (this.ws) try { this.ws.close(); } catch (err) { /* nic */ }
  };

  var klienciWs = {};
  /* jeden websocket na adres (telefon: cfg.ws albo z cfg.rpc; projektor może podać inny) */
  function ws(cfg, url) {
    if (typeof WebSocket === 'undefined') return null; // Node 20 nie ma WebSocket: skrypty używają pollingu
    url = url || cfg.ws || cfg.rpc.replace(/^http/, 'ws');
    if (!klienciWs[url]) klienciWs[url] = new KlientWs(url);
    return klienciWs[url];
  }

  /* ---------- wysyłanie ---------- */

  function base58(b) { return (node ? require('./base58.js') : root.Base58).koduj(b); }

  /* blockhash ważny ok. 60-90 s; jeden na połączenie, odświeżany co 30 s */
  var cacheHash = { conn: null, wartosc: null, kiedy: 0 };
  async function blockhash(conn, swiezy) {
    if (!swiezy && cacheHash.conn === conn && cacheHash.wartosc && Date.now() - cacheHash.kiedy < 30000) return cacheHash;
    var w = await conn.getLatestBlockhash('confirmed');
    cacheHash = { conn: conn, wartosc: w, kiedy: Date.now() };
    return cacheHash;
  }

  /* Potwierdzenie: websocket signatureSubscribe (bez zapytań HTTP), a zapasowo polling
     getSignatureStatuses: rzadko, gdy websocket działa, co 3-7 s, gdy go nie ma.
     Wynik: status albo null po limitMs; wyjątek tylko, gdy transakcja została odrzucona. */
  function potwierdz(conn, sig, cfg, limitMs) {
    var klient = cfg ? ws(cfg) : null;
    return new Promise(function (ok, blad) {
      var koniec = false, sub = null, timer = null;
      var start = Date.now();
      function zakoncz(e, st) {
        if (koniec) return; koniec = true;
        clearTimeout(timer); if (sub) sub.stop();
        if (e) blad(e); else ok(st);
      }
      if (klient) {
        sub = klient.subskrybuj('signatureSubscribe', [sig, { commitment: 'confirmed' }], function (wynik) {
          var v = wynik && wynik.value;
          if (v && v.err) zakoncz(new Error('Transakcja odrzucona: ' + JSON.stringify(v.err)));
          else zakoncz(null, { confirmationStatus: 'confirmed' });
        }, true);
      }
      function wsDziala() { return klient && klient.ok; }
      var przerwa = wsDziala() ? 9000 : 8000;
      async function sprawdz() {
        if (koniec) return;
        try {
          var st = (await conn.getSignatureStatuses([sig])).value[0];
          if (st && st.err) return zakoncz(new Error('Transakcja odrzucona: ' + JSON.stringify(st.err)));
          if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) return zakoncz(null, st);
        } catch (err) { /* limit albo sieć: spróbujemy znowu */ }
        if (Date.now() - start > (limitMs || 75000)) return zakoncz(null, null);
        przerwa = wsDziala() ? 10000 : Math.min(przerwa + 3000, 12000);
        timer = setTimeout(sprawdz, rozrzut(przerwa, 0.3));
      }
      timer = setTimeout(sprawdz, rozrzut(przerwa, 0.3));
    });
  }

  function bladTransakcji(err) {
    // prawdziwe odrzucenie (nie limit, nie sieć): nie ma sensu ponawiać
    var t = String(err && err.message);
    return /odrzucona|insufficient|InsufficientFunds|no record of a prior credit|Simulation failed|custom program error/i.test(t)
      && !czyLimit(err);
  }

  /* Wysyła memo podpisane przez aktora (opłata od sponsora) i ponawia do skutku, najdłużej limitMs.
     Cała sala klika naraz, a publiczny devnet przyjmuje ok. 20 transakcji / 10 s z jednego IP,
     więc: losowe opóźnienie pierwszej próby (opoznienieMs), po odmowie losowy, rosnący odstęp
     (ok. 5, 10, 20, 40 s ±60%), ta sama podpisana transakcja dopóki blockhash jest świeży.
     Odmowy też liczą się do limitu IP, więc ciasne ponawianie przedłuża blokadę całej sali.
     Duplikaty po ponownym podpisaniu są nieszkodliwe: liczy się pierwszy głos klucza w rundzie.
     naStan(etap, {proba}) dostaje: 'kolejka' (czeka na swoją kolej), 'ponawiam' (odmowa, czeka),
     'wysylam', 'potwierdzam'. Zwraca podpis potwierdzonej transakcji. */
  async function wyslijDoSkutku(conn, sponsorKp, aktorKp, tekst, o) {
    o = o || {};
    var start = Date.now(), limit = o.limitMs || 180000;
    function stan(e, info) { if (o.naStan) try { o.naStan(e, info || {}); } catch (err) { /* nic */ } }
    if (o.opoznienieMs) { stan('kolejka', { proba: 0 }); await czekaj(Math.random() * o.opoznienieMs); }
    var proba = 0, odmowy = 0, bh = null, surowa = null, sig = null, wyslane = [];
    while (Date.now() - start < limit) {
      proba++;
      try {
        if (!bh || Date.now() - bh.kiedy > 45000) {
          bh = await blockhash(conn, !!bh);
          var tx = new w3.Transaction({ feePayer: sponsorKp.publicKey, blockhash: bh.wartosc.blockhash, lastValidBlockHeight: bh.wartosc.lastValidBlockHeight });
          (o.instrukcjePrzed || []).forEach(function (ix) { tx.add(ix); });
          tx.add(memoIx(aktorKp.publicKey, tekst));
          tx.sign.apply(tx, [sponsorKp, aktorKp].concat(o.dodatkowiPodpisujacy || []));
          surowa = tx.serialize();
          sig = base58(tx.signature);
        }
        stan('wysylam', { proba: proba });
        try {
          await conn.sendRawTransaction(surowa, { skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 5 });
        } catch (err) {
          if (!/already been processed/i.test(String(err && err.message))) throw err;
        }
        if (wyslane.indexOf(sig) < 0) wyslane.push(sig);
        if (o.poWyslaniu) o.poWyslaniu(sig);
        stan('potwierdzam', { proba: proba });
        var st = await potwierdz(conn, sig, o.cfg, o.potwierdzenieMs || 40000);
        if (st) return sig;
        // brak potwierdzenia: może któraś wcześniejsza wersja jednak doszła
        try {
          var sts = (await conn.getSignatureStatuses(wyslane, { searchTransactionHistory: true })).value;
          for (var i = 0; i < sts.length; i++) if (sts[i] && !sts[i].err) return wyslane[i];
        } catch (e2) { /* nic */ }
        bh = null; // nowy blockhash i nowy podpis
      } catch (err) {
        // „Blockhash not found” przy symulacji: węzeł za load balancerem jest chwilę w tyle, nowy blockhash i dalej
        var nieaktualny = /Blockhash not found|block height exceeded|expired/i.test(String(err && err.message));
        if (nieaktualny) bh = null;
        else if (bladTransakcji(err)) throw err;
        odmowy++;
        stan('ponawiam', { proba: proba, blad: String(err && err.message).slice(0, 120) });
        await czekaj(rozrzut(Math.min(40000, 5000 * Math.pow(2, Math.min(odmowy, 4) - 1)), 0.6));
      }
    }
    throw new Error('Nie udało się wysłać w ' + Math.round(limit / 1000) + ' s');
  }

  /* ---------- tani i podpisany kanał fazy: konto nonce ----------
     Telefony bez websocketu (publiczny devnet daje ok. 10 na IP) muszą fazę odpytywać. Historia
     (getSignaturesForAddress + getTransaction) to ciężkie metody, ok. 10 / 10 s na IP dla całej sali.
     Dlatego faza jest też zapisana w koncie nonce (cfg.fazaKonto): jego „authority” to klucz fazy,
     wyprowadzony z klucza prywatnego organizatora i nazwy fazy. Zmienić authority może tylko
     posiadacz bieżącego klucza fazy, czyli organizator; telefon czyta konto lekką metodą getAccountInfo
     i tłumaczy authority na fazę z tabeli cfg.fazy (klucz publiczny -> „vote2” itd.). */
  function sha() { return node ? require('js-sha256').sha256 : root.sha256; }
  function hex(b) { return Array.from(b).map(function (x) { return (x < 16 ? '0' : '') + x.toString(16); }).join(''); }
  function nazwaKluczaFazy(p, r) { return p + (P.FAZY_Z_RUNDA[p] ? r : ''); }
  function kluczFazy(orgKp, nazwa) {
    return w3.Keypair.fromSeed(Uint8Array.from(sha().array(hex(orgKp.secretKey) + '|wpwr1-faza|' + nazwa)));
  }
  /* tabela do config.js: klucz publiczny -> nazwa fazy (reg, vote1..9, commit1..9, reveal1..9, lapowka, rigreveal, end) */
  function tabelaFaz(orgKp) {
    var t = {}, nazwy = ['reg', 'lapowka', 'rigreveal', 'end'];
    for (var r = 1; r <= 9; r++) nazwy.push('vote' + r, 'commit' + r, 'reveal' + r);
    nazwy.forEach(function (n) { t[kluczFazy(orgKp, n).publicKey.toBase58()] = n; });
    return t;
  }
  function fazaZNazwy(n) {
    var m = /^(reg|vote|commit|reveal|lapowka|rigreveal|end)(\d*)$/.exec(n || '');
    return m ? { p: m[1], r: m[2] ? Number(m[2]) : 0 } : null;
  }
  /* bieżąca faza z konta nonce: {p, r, slot} albo null */
  async function fazaZKonta(conn, cfg) {
    var w = await conn.getAccountInfoAndContext(new w3.PublicKey(cfg.fazaKonto), 'confirmed');
    if (!w.value) return null;
    var auth = w3.NonceAccount.fromAccountData(w.value.data).authorizedPubkey.toBase58();
    var f = fazaZNazwy(cfg.fazy && cfg.fazy[auth]);
    if (f) f.slot = w.context.slot;
    return f;
  }

  /* Zmiana fazy: memo „phase” podpisane przez organizatora (zapis i liczenie na projektorze)
     + w tej samej transakcji nonceAuthorize: authority konta fazy -> klucz nowej fazy. */
  async function wyslijFaze(conn, sponsorKp, orgKp, cfg, p, r, opcje) {
    var instr = [], podp = [];
    if (cfg.fazaKonto) {
      var konto = await conn.getAccountInfo(new w3.PublicKey(cfg.fazaKonto), 'confirmed');
      if (!konto) throw new Error('Brak konta fazy ' + cfg.fazaKonto + ' (node skrypty/setup.js)');
      var obecny = w3.NonceAccount.fromAccountData(konto.data).authorizedPubkey.toBase58();
      var tabela = tabelaFaz(orgKp);
      if (!tabela[obecny]) throw new Error('Konto fazy ma nieznany klucz (inny organizator?)');
      var stary = kluczFazy(orgKp, tabela[obecny]);
      var nowy = kluczFazy(orgKp, nazwaKluczaFazy(p, r));
      instr.push(w3.SystemProgram.nonceAuthorize({ noncePubkey: new w3.PublicKey(cfg.fazaKonto), authorizedPubkey: stary.publicKey, newAuthorizedPubkey: nowy.publicKey }));
      podp.push(stary);
    }
    return wyslijMemo(conn, sponsorKp, orgKp, P.memoPhase(cfg.e, p, r), Object.assign({ instrukcjePrzed: instr, dodatkowiPodpisujacy: podp, cfg: cfg }, opcje || {}));
  }

  /* Wersja dla skryptów (faza, boty): to samo, krótszy limit, bez opóźnienia. */
  function wyslijMemo(conn, sponsorKp, aktorKp, tekst, opcje) {
    opcje = Object.assign({ limitMs: 120000 }, opcje || {});
    return wyslijDoSkutku(conn, sponsorKp, aktorKp, tekst, opcje);
  }

  /* ---------- historia sponsora (ekran wyników) ----------
     getSignaturesForAddress(sponsor, until = najnowsza znana) co kilka sekund daje listę i kolejność
     (slot, transactionIndex) oraz pole memo do odfiltrowania innych wyborów. Podpisującego
     bierzemy z logów: na żywo z websocketu (logsSubscribe mentions = sponsor), a dla transakcji
     przegapionych przez websocket z getTransaction, powoli (limit RPC). Wyniki w pamięci i w localStorage. */
  function CzytnikHistorii(conn, cfg, opcje) {
    this.conn = conn; this.cfg = cfg; this.opcje = opcje || {};
    this.lista = [];      // chronologicznie: {sig, slot, ti, widziana}
    this.zdarzenia = {};  // sig -> zdarzenie | null (null = nie dotyczy / nieważne)
    this.zWs = {};        // sig -> zdarzenie z websocketu (także jeszcze nie na liście)
    this.najnowsza = null;
    this.ostatniGetTx = 0;
    this.kluczCache = 'wpwr1:historia:' + cfg.e + ':' + cfg.sponsor.publicKey;
    this.wczytajCache();
  }
  CzytnikHistorii.prototype.wczytajCache = function () {
    if (!this.opcje.cache) return;
    try {
      var c = JSON.parse(localStorage.getItem(this.kluczCache) || 'null');
      if (c && c.najnowsza && Array.isArray(c.lista)) {
        this.lista = c.lista; this.zdarzenia = c.zdarzenia || {}; this.najnowsza = c.najnowsza;
      }
    } catch (err) { /* brak localStorage */ }
  };
  CzytnikHistorii.prototype.zapiszCache = function () {
    if (!this.opcje.cache) return;
    try {
      localStorage.setItem(this.kluczCache, JSON.stringify({ najnowsza: this.najnowsza, lista: this.lista, zdarzenia: this.zdarzenia }));
    } catch (err) { /* pełne albo zablokowane */ }
  };
  /* Websocket: każda transakcja ze sponsorem. naZdarzenie() wołane od razu (wyniki bez czekania na polling). */
  CzytnikHistorii.prototype.sluchaj = function (naZdarzenie) {
    var klient = ws(this.cfg, this.opcje.wsUrl), self = this;
    if (!klient) return null;
    klient.subskrybuj('logsSubscribe', [{ mentions: [this.cfg.sponsor.publicKey] }, { commitment: 'confirmed' }], function (wynik) {
      var v = wynik && wynik.value;
      if (!v || v.err) return;
      var ev = P.zdarzenieZLogow(v.logs, v.signature, wynik.context && wynik.context.slot, self.cfg, Math.floor(Date.now() / 1000));
      if (!ev) return;
      self.zWs[v.signature] = ev;
      if (self.zdarzenia[v.signature] === undefined) self.zdarzenia[v.signature] = ev;
      if (naZdarzenie) naZdarzenie(ev);
    });
    return klient;
  };
  CzytnikHistorii.prototype.odswiez = async function () {
    var cfg = this.cfg, nowe = [], before, koniec = false, self = this;
    var pk = new w3.PublicKey(cfg.sponsor.publicKey);
    while (!koniec) {
      var opts = { limit: 1000 };
      if (this.najnowsza) opts.until = this.najnowsza;
      if (before) opts.before = before;
      var strona = await this.conn.getSignaturesForAddress(pk, opts, 'confirmed');
      for (var i = 0; i < strona.length; i++) {
        if (cfg.startSlot && strona[i].slot < cfg.startSlot) { koniec = true; break; }
        nowe.push(strona[i]);
      }
      if (strona.length < 1000) koniec = true;
      else before = strona[strona.length - 1].signature;
    }
    if (nowe.length) {
      this.najnowsza = nowe[0].signature;
      var teraz = Date.now();
      nowe.reverse().forEach(function (s) {
        if (s.err || !P.memoDotyczy(s.memo, cfg)) return;
        self.lista.push({ sig: s.signature, slot: s.slot, ti: typeof s.transactionIndex === 'number' ? s.transactionIndex : null, widziana: teraz });
      });
      // kolejność: slot, potem pozycja w bloku (transactionIndex; gdy RPC go nie poda, kolejność z listy)
      this.lista = this.lista.map(function (x, i) { return { x: x, i: i }; })
        .sort(function (a, b) {
          return a.x.slot - b.x.slot || ((a.x.ti != null && b.x.ti != null) ? a.x.ti - b.x.ti : 0) || a.i - b.i;
        }).map(function (o) { return o.x; });
    }
    // transakcje, których websocket nie dostarczył: getTransaction, najwyżej jedna na ok. 1,5 s
    var brak = this.lista.filter(function (x) { return self.zdarzenia[x.sig] === undefined && Date.now() - (x.widziana || 0) >= (self.opcje.zwloka != null ? self.opcje.zwloka : 4000); });
    var limit = this.opcje.getTxNaRaz || 2;
    for (var k = 0; k < brak.length && k < limit; k++) {
      var przerwa = 1500 - (Date.now() - this.ostatniGetTx);
      if (przerwa > 0) await czekaj(przerwa);
      this.ostatniGetTx = Date.now();
      try {
        var tx = await this.conn.getTransaction(brak[k].sig, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
        if (tx) this.zdarzenia[brak[k].sig] = P.zdarzenieZTransakcji(tx, brak[k].sig, cfg);
      } catch (err) { if (this.opcje.log) this.opcje.log(err); break; }
    }
    this.zapiszCache();
    return this.wynik();
  };
  CzytnikHistorii.prototype.brakujace = function () {
    var self = this;
    return this.lista.filter(function (x) { return self.zdarzenia[x.sig] === undefined; }).length;
  };
  CzytnikHistorii.prototype.wynik = function () {
    var self = this, naLiscie = {};
    var evs = this.lista.map(function (x) { naLiscie[x.sig] = true; return self.zdarzenia[x.sig]; }).filter(Boolean);
    // zdarzenia z websocketu, których lista jeszcze nie ma, na koniec (wg slotu)
    var dodatkowe = Object.keys(this.zWs).filter(function (s) { return !naLiscie[s]; })
      .map(function (s) { return self.zWs[s]; })
      .sort(function (a, b) { return (a.slot || 0) - (b.slot || 0); });
    return P.policz(evs.concat(dodatkowe), this.cfg);
  };

  /* ---------- faza z adresu organizatora (telefon, panel, boty) ----------
     Fazę przyjmujemy tylko podpisaną przez organizatora. Klucz sponsora jest publiczny, więc każdy
     może wysłać transakcję, która wspomina adres organizatora i ma memo „phase” podpisane swoim
     kluczem; dlatego zawsze sprawdzamy podpisującego memo w logach programu Memo („Signed by”):
     - na żywo: websocket logsSubscribe (mentions = organizator), logi są w powiadomieniu;
       publiczny devnet daje tylko ok. 10 websocketów na IP, reszta sali jedzie na zapasie,
     - zapas: co ok. 30 s konto fazy (getAccountInfo, patrz wyżej); bez konta fazy w config.js:
       getSignaturesForAddress(organizator) i getTransaction kandydata od najnowszego (ciężkie metody,
       ok. 10 / 10 s na IP), z weryfikacją podpisu; każdą transakcję sprawdzamy raz. */
  function CzytnikFazy(conn, cfg, naZmiane, opcje) {
    this.conn = conn; this.cfg = cfg; this.naZmiane = naZmiane; this.opcje = opcje || {};
    this.faza = { p: 'reg', r: 0, sig: null, slot: 0 };
    this.sprawdzone = {}; // sig -> zdarzenie|null
    this.timer = null; this.zatrzymany = false; this.wTrakcie = null; this.klient = null;
  }
  CzytnikFazy.prototype.start = function () {
    var self = this, cfg = this.cfg;
    if (this.opcje.ws !== false) this.klient = ws(cfg);
    if (this.klient) {
      this.klient.subskrybuj('logsSubscribe', [{ mentions: [cfg.organizator] }, { commitment: 'confirmed' }], function (wynik) {
        var v = wynik && wynik.value;
        if (!v || v.err) return;
        var ev = P.zdarzenieZLogow(v.logs, v.signature, wynik.context && wynik.context.slot, cfg);
        self.sprawdzone[v.signature] = ev; // null, gdy podpisał ktoś inny niż organizator
        if (ev) self.ustaw(ev);
      });
      this.klient.naStan.push(function (ok) {
        self.zaplanuj(ok ? rozrzut(3000, 0.9) : null); // po połączeniu: mogliśmy coś przegapić
      });
    }
    // cała sala otwiera stronę naraz: pierwszy odczyt z rozrzutem
    this.zaplanuj(Math.random() * (this.opcje.rozrzutStartu || 0));
  };
  CzytnikFazy.prototype.stop = function () { this.zatrzymany = true; clearTimeout(this.timer); };
  CzytnikFazy.prototype.wsOk = function () { return !!(this.klient && this.klient.ok); };
  CzytnikFazy.prototype.zaplanuj = function (za) {
    if (this.zatrzymany) return;
    var self = this;
    clearTimeout(this.timer);
    var co = za != null ? za : (this.wsOk() ? rozrzut(this.opcje.pollingZWs || 90000, 0.3) : rozrzut(this.opcje.polling || 30000, 0.3));
    this.timer = setTimeout(function () { self.tik().finally(function () { self.zaplanuj(); }); }, co);
  };
  /* jeden krok zapasu: konto fazy (lekkie getAccountInfo, podpisane przez organizatora),
     a bez konta fazy w config.js: ciężki odczyt historii z weryfikacją podpisu */
  CzytnikFazy.prototype.tik = async function () {
    if (!this.cfg.fazaKonto) { await this.sprawdz(); return; }
    try {
      var f = await fazaZKonta(this.conn, this.cfg);
      if (f) this.ustaw({ sig: 'konto:' + nazwaKluczaFazy(f.p, f.r), slot: f.slot, aktor: this.cfg.organizator, m: { t: 'phase', p: f.p, r: f.r } });
      if (this.opcje.naOdczyt) this.opcje.naOdczyt(null);
    } catch (err) {
      if (this.opcje.naOdczyt) this.opcje.naOdczyt(err);
    }
  };
  CzytnikFazy.prototype.ustaw = function (ev) {
    if (!ev || ev.m.t !== 'phase' || ev.aktor !== this.cfg.organizator) return;
    if (ev.sig === this.faza.sig || (ev.slot || 0) < (this.faza.slot || 0)) return;
    this.faza = { p: ev.m.p, r: ev.m.r, sig: ev.sig, slot: ev.slot || 0 };
    this.naZmiane(this.faza);
  };
  CzytnikFazy.prototype.sprawdz = function () {
    var self = this;
    if (this.wTrakcie) return this.wTrakcie;
    this.wTrakcie = (async function () {
      try {
        var lista = await self.conn.getSignaturesForAddress(new w3.PublicKey(self.cfg.organizator), { limit: 15 }, 'confirmed');
        for (var i = 0; i < lista.length; i++) {
          var s = lista[i];
          if (s.err || !P.memoDotyczy(s.memo, self.cfg) || s.memo.indexOf('"t":"phase"') < 0) continue;
          if (s.signature === self.faza.sig) break; // nic nowszego od obowiązującej fazy
          var ev = self.sprawdzone[s.signature];
          if (ev === undefined) {
            var tx = await self.conn.getTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
            if (!tx) throw new Error('transakcja jeszcze niedostępna'); // następnym razem
            ev = self.sprawdzone[s.signature] = P.zdarzenieZTransakcji(tx, s.signature, self.cfg);
          }
          if (ev) { self.ustaw(ev); break; } // najnowsza prawdziwa faza; fałszywe pomijamy
        }
        if (self.opcje.naOdczyt) self.opcje.naOdczyt(null);
        return true;
      } catch (err) {
        if (self.opcje.naOdczyt) self.opcje.naOdczyt(err);
        return false;
      } finally {
        self.wTrakcie = null;
      }
    })();
    return this.wTrakcie;
  };

  return {
    w3: w3, czekaj: czekaj, rozrzut: rozrzut, polacz: polacz, zPonowieniem: zPonowieniem, czyLimit: czyLimit, keypairZSekretu: keypairZSekretu, memoIx: memoIx,
    ws: ws, KlientWs: KlientWs, wyslijMemo: wyslijMemo, wyslijDoSkutku: wyslijDoSkutku, wyslijFaze: wyslijFaze, kluczFazy: kluczFazy, tabelaFaz: tabelaFaz, fazaZKonta: fazaZKonta, nazwaKluczaFazy: nazwaKluczaFazy, potwierdz: potwierdz,
    CzytnikHistorii: CzytnikHistorii, CzytnikFazy: CzytnikFazy
  };
});
