/* Protokół wyborów na memo (SPEC.md, sekcja „Protokół”) i zasady liczenia.
   Jeden moduł dla ekranu wyników, telefonu, panelu i skryptów Node.
   Przeglądarka: globalny Protokol (wymaga wcześniej vendor/sha256.min.js).
   Node: const Protokol = require('../app/lib/protokol.js'). */
(function (root, factory) {
  var sha = (typeof module === 'object' && module.exports)
    ? require('js-sha256').sha256
    : root.sha256;
  var m = factory(sha);
  if (typeof module === 'object' && module.exports) module.exports = m;
  else root.Protokol = m;
})(typeof self !== 'undefined' ? self : this, function (sha256) {
  'use strict';

  var PREFIX = 'wpwr1:';
  var MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
  var FAZY = ['reg', 'vote', 'commit', 'reveal', 'lapowka', 'rigreveal', 'end'];
  var FAZY_Z_RUNDA = { vote: true, commit: true, reveal: true };
  var MAX_NICK = 16;

  function idKandydatow(cfg) {
    return (cfg && cfg.kandydaci ? cfg.kandydaci : [{ id: 'A' }, { id: 'B' }, { id: 'C' }])
      .map(function (k) { return k.id; });
  }

  function dlugoscZnakow(t) { return Array.from(t).length; }

  function czyRunda(r) { return typeof r === 'number' && Math.floor(r) === r && r >= 1 && r <= 99; }

  /* ---------- budowanie memo ---------- */

  function zbuduj(e, pola) {
    var o = { e: e };
    Object.keys(pola).forEach(function (k) { o[k] = pola[k]; });
    return PREFIX + JSON.stringify(o);
  }
  function memoReg(e, nick) { return zbuduj(e, { t: 'reg', n: oczyscNick(nick) }); }
  function memoVote(e, r, c) { return zbuduj(e, { t: 'vote', r: r, c: c }); }
  function memoCommit(e, r, h) { return zbuduj(e, { t: 'commit', r: r, h: h }); }
  function memoReveal(e, r, c, s) { return zbuduj(e, { t: 'reveal', r: r, c: c, s: s }); }
  function memoPhase(e, p, r) { return zbuduj(e, { t: 'phase', p: p, r: FAZY_Z_RUNDA[p] ? r : 0 }); }

  function oczyscNick(n) {
    n = String(n == null ? '' : n).replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
    return Array.from(n).slice(0, MAX_NICK).join('');
  }

  /* ---------- parsowanie memo ---------- */

  /* Zwraca obiekt memo albo null (zły prefiks, inne e, złe pola). */
  function parsuj(tekst, cfg) {
    if (typeof tekst !== 'string') return null;
    var i = tekst.indexOf(PREFIX);
    if (i !== 0) return null;
    var o;
    try { o = JSON.parse(tekst.slice(PREFIX.length)); } catch (err) { return null; }
    if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
    if (cfg && o.e !== cfg.e) return null;
    var ids = idKandydatow(cfg);
    switch (o.t) {
      case 'reg':
        if (typeof o.n !== 'string') return null;
        var n = oczyscNick(o.n);
        if (!n || dlugoscZnakow(o.n) > MAX_NICK) return null;
        return { e: o.e, t: 'reg', n: n };
      case 'vote':
        if (!czyRunda(o.r) || ids.indexOf(o.c) < 0) return null;
        return { e: o.e, t: 'vote', r: o.r, c: o.c };
      case 'commit':
        if (!czyRunda(o.r) || typeof o.h !== 'string' || !/^[0-9a-f]{64}$/.test(o.h)) return null;
        return { e: o.e, t: 'commit', r: o.r, h: o.h };
      case 'reveal':
        if (!czyRunda(o.r) || ids.indexOf(o.c) < 0) return null;
        if (typeof o.s !== 'string' || !/^[0-9a-f]{32}$/.test(o.s)) return null;
        return { e: o.e, t: 'reveal', r: o.r, c: o.c, s: o.s };
      case 'phase':
        if (FAZY.indexOf(o.p) < 0) return null;
        if (FAZY_Z_RUNDA[o.p]) { if (!czyRunda(o.r)) return null; }
        return { e: o.e, t: 'phase', p: o.p, r: FAZY_Z_RUNDA[o.p] ? o.r : 0 };
      default:
        return null;
    }
  }

  /* Hash głosu ukrytego: hex SHA-256 z "e|r|c|s|pubkey" (UTF-8). */
  function hashCommit(e, r, c, s, pubkey) {
    return sha256(e + '|' + r + '|' + c + '|' + s + '|' + pubkey);
  }

  /* Memo z logów programu (websocket logsSubscribe): Program log: Memo (len N): "..." */
  function memoZLogow(logi) {
    if (!logi) return null;
    for (var i = 0; i < logi.length; i++) {
      var m = /^Program log: Memo \(len \d+\): "(.*)"$/.exec(logi[i]);
      if (m) {
        try { return JSON.parse('"' + m[1] + '"'); } catch (err) { return m[1].replace(/\\"/g, '"'); }
      }
    }
    return null;
  }

  function str(k) { return k == null ? '' : (typeof k === 'string' ? k : k.toString()); }

  /* Zdarzenie z logów transakcji: {sig, slot, czas, aktor, m} albo null.
     Bierzemy pierwsze wywołanie programu SPL Memo na najwyższym poziomie. Linie między
     „invoke [1]” a „success” pisze sam program Memo, więc „Signed by X” to prawdziwy podpisujący memo
     (Memo v2 odrzuca konta, które nie podpisały). Ta sama funkcja działa dla logów z websocketu
     (logsSubscribe) i z getTransaction (meta.logMessages), więc oba źródła liczą identycznie.
     Warunki: dokładnie jeden podpisujący memo, różny od sponsora; faza tylko od organizatora. */
  function zdarzenieZLogow(logi, sig, slot, cfg, czas) {
    if (!logi || !logi.length) return null;
    var start = 'Program ' + MEMO_PROGRAM + ' invoke [1]';
    var koniec = 'Program ' + MEMO_PROGRAM + ' success';
    for (var i = 0; i < logi.length; i++) {
      if (logi[i] !== start) continue;
      var podpisy = [], tekst = null, ok = false;
      for (var j = i + 1; j < logi.length; j++) {
        var l = logi[j];
        if (l === koniec) { ok = true; break; }
        if (l.indexOf('Program ' + MEMO_PROGRAM + ' failed') === 0) break;
        var mp = /^Program log: Signed by ([1-9A-HJ-NP-Za-km-z]{32,44})$/.exec(l);
        if (mp) { podpisy.push(mp[1]); continue; }
        var mm = /^Program log: Memo \(len \d+\): "(.*)"$/.exec(l);
        if (mm && tekst === null) {
          try { tekst = JSON.parse('"' + mm[1] + '"'); } catch (err) { tekst = null; }
        }
      }
      if (!ok || tekst === null || tekst.indexOf(PREFIX) !== 0) continue;
      var m = parsuj(tekst, cfg);
      if (!m) return null;
      if (podpisy.length !== 1 || podpisy[0] === cfg.sponsor.publicKey) return null;
      if (m.t === 'phase' && podpisy[0] !== cfg.organizator) return null;
      return { sig: sig, slot: slot, czas: czas || null, aktor: podpisy[0], m: m };
    }
    return null;
  }

  /* Z transakcji (getTransaction / getParsedTransaction) robi zdarzenie przez logi programu. */
  function zdarzenieZTransakcji(tx, sig, cfg) {
    if (!tx || !tx.meta || tx.meta.err) return null;
    sig = sig || (tx.transaction && tx.transaction.signatures && str(tx.transaction.signatures[0]));
    return zdarzenieZLogow(tx.meta.logMessages, sig, tx.slot, cfg, tx.blockTime);
  }

  /* Czy pole memo z getSignaturesForAddress może dotyczyć tych wyborów (filtr wstępny). */
  function memoDotyczy(memoPole, cfg) {
    return typeof memoPole === 'string' && memoPole.indexOf(PREFIX) >= 0 && memoPole.indexOf('"e":"' + cfg.e + '"') >= 0;
  }

  /* ---------- liczenie ---------- */

  /* zdarzenia: tablica w kolejności chronologicznej (slot, potem pozycja w bloku). */
  function policz(zdarzenia, cfg) {
    var ids = idKandydatow(cfg);
    var faza = { p: 'reg', r: 0, sig: null, slot: 0 };
    var glosujacy = {};
    var kolejnosc = [];
    var rundy = {};
    var ostatnie = [];

    function runda(r) {
      if (!rundy[r]) rundy[r] = { r: r, ogloszona: false, ukryta: false, jawne: {}, commity: {}, odkryte: {}, nieudaneOdkrycia: 0 };
      return rundy[r];
    }

    zdarzenia.forEach(function (ev) {
      if (!ev || !ev.m) return;
      var m = ev.m, pk = ev.aktor;
      ostatnie.push({ sig: ev.sig, aktor: pk, t: m.t, slot: ev.slot, czas: ev.czas });
      if (m.t === 'phase') {
        if (pk !== cfg.organizator) return;
        faza = { p: m.p, r: m.r, sig: ev.sig, slot: ev.slot };
        if (FAZY_Z_RUNDA[m.p]) {
          var R0 = runda(m.r);
          R0.ogloszona = true;
          if (m.p === 'commit' || m.p === 'reveal') R0.ukryta = true;
        }
        return;
      }
      if (m.t === 'reg') {
        if (!glosujacy[pk]) {
          glosujacy[pk] = { pubkey: pk, nick: m.n, regSig: ev.sig, rundy: {} };
          kolejnosc.push(pk);
        }
        return;
      }
      if (!glosujacy[pk]) return; // głos bez wcześniejszej rejestracji
      var R = runda(m.r);
      if (m.t === 'vote') {
        if (!R.jawne[pk]) R.jawne[pk] = { c: m.c, sig: ev.sig };
      } else if (m.t === 'commit') {
        if (!R.commity[pk]) R.commity[pk] = { h: m.h, sig: ev.sig };
      } else if (m.t === 'reveal') {
        var cm = R.commity[pk];
        if (cm && !R.odkryte[pk]) {
          if (hashCommit(cfg.e, m.r, m.c, m.s, pk) === cm.h) R.odkryte[pk] = { c: m.c, sig: ev.sig };
          else R.nieudaneOdkrycia++;
        }
      }
    });

    var listaRund = Object.keys(rundy).map(Number).sort(function (a, b) { return a - b; })
      .map(function (r) { return rundy[r]; })
      .filter(function (R) { return R.ogloszona; })
      .map(function (R) {
        var wyniki = {}; ids.forEach(function (id) { wyniki[id] = 0; });
        var zrodlo = R.ukryta ? R.odkryte : R.jawne;
        Object.keys(zrodlo).forEach(function (pk) {
          wyniki[zrodlo[pk].c]++;
          glosujacy[pk].rundy[R.r] = { c: zrodlo[pk].c, sig: zrodlo[pk].sig, ukryty: false };
        });
        if (R.ukryta) {
          Object.keys(R.commity).forEach(function (pk) {
            if (!R.odkryte[pk]) glosujacy[pk].rundy[R.r] = { c: null, sig: R.commity[pk].sig, ukryty: true };
          });
        }
        var suma = 0; ids.forEach(function (id) { suma += wyniki[id]; });
        return {
          r: R.r, ukryta: R.ukryta, wyniki: wyniki, suma: suma,
          liczbaCommit: Object.keys(R.commity).length,
          liczbaOdkryte: Object.keys(R.odkryte).length,
          nieudaneOdkrycia: R.nieudaneOdkrycia
        };
      });

    return {
      faza: faza,
      rundy: listaRund,
      glosujacy: kolejnosc.map(function (pk) { return glosujacy[pk]; }),
      liczbaZarejestrowanych: kolejnosc.length,
      ostatnie: ostatnie.slice(-30).reverse()
    };
  }

  /* ---------- pomocnicze ---------- */

  function etykietaFazy(faza) {
    if (!faza) return '';
    switch (faza.p) {
      case 'reg': return 'Rejestracja';
      case 'vote': return 'Runda ' + faza.r + ': głosowanie jawne';
      case 'commit': return 'Runda ' + faza.r + ': głosowanie ukryte';
      case 'reveal': return 'Runda ' + faza.r + ': odkrywanie głosów';
      case 'lapowka': return 'Łapówki';
      case 'rigreveal': return 'Ujawnienie';
      case 'end': return 'Koniec';
      default: return '';
    }
  }

  /* krótka etykieta na pasek telefonu (mieści się w jednej linii od 360 px) */
  function etykietaFazyKrotka(faza) {
    if (!faza) return '';
    switch (faza.p) {
      case 'vote': return 'Runda ' + faza.r + ' · jawne';
      case 'commit': return 'Runda ' + faza.r + ' · ukryte';
      case 'reveal': return 'Runda ' + faza.r + ' · odkrywanie';
      default: return etykietaFazy(faza);
    }
  }

  function etykietaTypu(t) {
    return { reg: 'rejestracja', vote: 'głos', commit: 'głos ukryty', reveal: 'odkrycie', phase: 'faza' }[t] || t;
  }

  function skrot(adres) {
    adres = str(adres);
    return adres.length > 10 ? adres.slice(0, 4) + '…' + adres.slice(-4) : adres;
  }

  function explorerTx(sig, cluster) {
    return 'https://explorer.solana.com/tx/' + sig + (cluster && cluster !== 'mainnet-beta' ? '?cluster=' + cluster : '');
  }
  function explorerAdres(a, cluster) {
    return 'https://explorer.solana.com/address/' + a + (cluster && cluster !== 'mainnet-beta' ? '?cluster=' + cluster : '');
  }

  function losoweBajty(n) {
    var b = new Uint8Array(n);
    var c = (typeof crypto !== 'undefined' && crypto.getRandomValues) ? crypto : require('crypto').webcrypto;
    c.getRandomValues(b);
    return b;
  }
  function hex(b) { return Array.from(b).map(function (x) { return (x < 16 ? '0' : '') + x.toString(16); }).join(''); }
  function nowaSol() { return hex(losoweBajty(16)); }
  /* liczba z [0, 1) z crypto.getRandomValues */
  function losowa() { var b = losoweBajty(4); return ((b[0] << 24 >>> 0) + (b[1] << 16) + (b[2] << 8) + b[3]) / 4294967296; }

  return {
    PREFIX: PREFIX, MEMO_PROGRAM: MEMO_PROGRAM, FAZY: FAZY, FAZY_Z_RUNDA: FAZY_Z_RUNDA, MAX_NICK: MAX_NICK,
    memoReg: memoReg, memoVote: memoVote, memoCommit: memoCommit, memoReveal: memoReveal, memoPhase: memoPhase,
    oczyscNick: oczyscNick, parsuj: parsuj, hashCommit: hashCommit, memoZLogow: memoZLogow,
    zdarzenieZTransakcji: zdarzenieZTransakcji, zdarzenieZLogow: zdarzenieZLogow, memoDotyczy: memoDotyczy, policz: policz,
    etykietaFazy: etykietaFazy, etykietaFazyKrotka: etykietaFazyKrotka, etykietaTypu: etykietaTypu, skrot: skrot,
    explorerTx: explorerTx, explorerAdres: explorerAdres, nowaSol: nowaSol, losowa: losowa, hex: hex
  };
});
