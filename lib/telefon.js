/* Telefon głosującego (index.html). Portfel w localStorage tej przeglądarki, opłaty płaci sponsor. */
(function () {
  'use strict';
  var cfg = window.WYBORY_CONFIG, P = window.Protokol, S = window.Siec, w3 = window.solanaWeb3;
  var $ekran = document.getElementById('ekran');
  var $faza = document.getElementById('faza');
  var $stopka = document.getElementById('stopka');
  var $nakladka = document.getElementById('nakladka');

  /* ---------- localStorage (zawsze w try/catch: tryb prywatny, blokada, pełna pamięć) ---------- */
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (err) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); return true; } catch (err) { return false; } }

  function wczytajPortfel() {
    var zapis = lsGet('wpwr1:portfel');
    if (zapis) { try { return S.keypairZSekretu(zapis); } catch (err) { /* uszkodzony: nowy */ } }
    var kp = w3.Keypair.generate(); // crypto.getRandomValues, działa też bez HTTPS
    lsSet('wpwr1:portfel', Base58.koduj(kp.secretKey));
    return kp;
  }

  var portfel = wczytajPortfel();
  var pk = portfel.publicKey.toBase58();
  var sponsor = S.keypairZSekretu(cfg.sponsor.secretKey);
  var conn = S.polacz(cfg);
  var KLUCZ_STANU = 'wpwr1:stan:' + cfg.e + ':' + pk;
  var stan = (function () {
    try { var s = JSON.parse(lsGet(KLUCZ_STANU) || 'null'); if (s && s.glosy) return s; } catch (err) { /* nic */ }
    return { nick: null, regSig: null, glosy: {} };
  })();
  function zapiszStan() { lsSet(KLUCZ_STANU, JSON.stringify(stan)); }

  var faza = { p: 'reg', r: 0 };
  var fazaZnana = false;
  var ui = { tryb: null, etap: null, kandydat: null, runda: null, blad: null, dowod: null, nick: '', saldo: null, saldoStan: null, odkrywanie: false };
  // losowe opóźnienie pierwszej próby: cała sala klika naraz, a devnet przyjmuje ok. 2 transakcje / s z IP
  var KOLEJKA_MS = cfg.kolejkaMs != null ? cfg.kolejkaMs : 20000;
  var KOLEJKA_REG_MS = cfg.kolejkaRegMs != null ? cfg.kolejkaRegMs : 6000;
  function naEtap(e) { ui.etap = e; render(); }
  var ostatniKlucz = null;

  /* ---------- pomocnicze ---------- */
  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function kandydat(id) {
    for (var i = 0; i < cfg.kandydaci.length; i++) if (cfg.kandydaci[i].id === id) return cfg.kandydaci[i];
    return { id: id, nazwa: id, kolor: '#A9B0D0' };
  }
  function kolorTekstu(hex) {
    var n = parseInt(hex.slice(1), 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    var lin = function (c) { return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    var L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    return L > 0.25 ? '#0F1222' : '#FFFFFF';
  }
  function linkTx(sig) { return P.explorerTx(sig, cfg.cluster); }
  function nazwa(id) { return esc(kandydat(id).nazwa); }

  /* ---------- widoki ---------- */
  function widokRejestracji() {
    if (ui.tryb === 'wysylam') return widokWysylania();
    return '<div class="karta">' +
      '<h1>Rejestracja</h1>' +
      '<p>Nic nie instalujesz. Twój portfel powstał właśnie w tej przeglądarce.</p>' +
      '<div class="adres">' + esc(P.skrot(pk)) + '</div>' +
      '</div>' +
      '<form class="karta" id="f-reg" novalidate>' +
      '<label for="nick">Twój nick</label>' +
      '<input id="nick" type="text" maxlength="' + P.MAX_NICK + '" autocomplete="off" autocapitalize="off" spellcheck="false" value="' + esc(ui.nick) + '">' +
      '<p class="drugorzedny">Bez prawdziwego nazwiska: nick trafi na publiczny blockchain.</p>' +
      (ui.blad ? '<p class="blad-tekst">' + esc(ui.blad) + '</p>' : '') +
      '<button class="przycisk" type="submit">Odbierz kartę do głosowania</button>' +
      '</form>';
  }

  function widokWysylania(tekst) {
    var opis = '';
    if (!tekst) {
      if (ui.etap === 'kolejka') { tekst = 'W kolejce do blockchaina…'; opis = 'Cała sala wysyła naraz, twoja transakcja pójdzie za chwilę.'; }
      else if (ui.etap === 'ponawiam') { tekst = 'W kolejce do blockchaina, ponawiam…'; opis = 'Sieć jest zajęta, strona sama spróbuje ponownie. Nie zamykaj jej.'; }
      else tekst = 'Wysyłam na blockchain…';
    }
    return '<div class="karta srodek" id="wysylanie"><div class="kolko"></div><h2>' + esc(tekst) + '</h2>' +
      (opis ? '<p class="drugorzedny">' + esc(opis) + '</p>' : '') + '</div>';
  }

  function widokCzekania() {
    return '<div class="karta srodek">' +
      '<h1>Czekamy na start głosowania</h1>' +
      '<p class="drugorzedny">Twoja karta do głosowania: <b>' + esc(stan.nick) + '</b></p>' +
      '</div>';
  }

  function widokGlosowania(ukryte) {
    if (ui.tryb === 'wysylam') return widokWysylania();
    if (ui.tryb === 'potwierdz' && ui.runda === faza.r) {
      var k = kandydat(ui.kandydat);
      return '<div class="karta srodek">' +
        '<h1>Twój wybór</h1>' +
        '<button class="kandydat" style="background:' + k.kolor + ';color:' + kolorTekstu(k.kolor) + ';cursor:default" tabindex="-1" aria-hidden="true"><span class="litera">' + esc(k.id) + '</span>' + esc(k.nazwa) + '</button>' +
        '<p class="wybor">Potwierdzasz?</p>' +
        (ui.blad ? '<p class="blad-tekst">' + esc(ui.blad) + '</p>' : '') +
        '<button class="przycisk" data-akcja="glosuj">Tak, głosuję</button>' +
        '<button class="przycisk drugi" data-akcja="anuluj">Wróć</button>' +
        '</div>';
    }
    var h = '<h1 class="pytanie">' + esc(cfg.pytanie) + '</h1>';
    if (ukryte) h += '<div class="uwaga">Tym razem wyniki są ukryte do końca</div>';
    h += '<div class="kandydaci">';
    cfg.kandydaci.forEach(function (k) {
      h += '<button class="kandydat" data-akcja="wybierz" data-id="' + esc(k.id) + '" style="background:' + k.kolor + ';color:' + kolorTekstu(k.kolor) + '">' +
        '<span class="litera">' + esc(k.id) + '</span>' + esc(k.nazwa) + '</button>';
    });
    return h + '</div>';
  }

  function widokZapisany(g) {
    if (g.typ === 'commit') {
      return '<div class="karta srodek">' +
        '<div class="duzy-znak zamek"><svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg></div>' +
        '<h1>Głos zaszyfrowany</h1>' +
        '<p class="wybor">Twój wybór: <b>' + nazwa(g.wybor) + '</b></p>' +
        '<p class="drugorzedny">Na blockchainie jest tylko skrót głosu. Strona sama go odkryje, gdy prowadzący otworzy urnę.</p>' +
        '<a class="przycisk drugi" href="' + linkTx(g.sig) + '" target="_blank" rel="noopener">Zobacz w Explorerze</a>' +
        '</div>';
    }
    return '<div class="karta srodek">' +
      '<div class="duzy-znak ok">✓</div>' +
      '<h1>Głos zapisany</h1>' +
      '<p class="wybor">Twój wybór: <b>' + nazwa(g.wybor) + '</b></p>' +
      '<a class="przycisk drugi" href="' + linkTx(g.sig) + '" target="_blank" rel="noopener">Zobacz w Explorerze</a>' +
      '<button class="przycisk" data-akcja="dowod" data-sig="' + esc(g.sig) + '">Pokaż dowód głosu</button>' +
      '</div>';
  }

  function widokOdkrywania() {
    var g = stan.glosy[faza.r];
    if (!g || g.typ !== 'commit' || !g.potwierdzony) {
      return '<div class="karta srodek"><h1>Odkrywanie głosów</h1><p class="drugorzedny">Brak twojego głosu w tej rundzie.</p></div>';
    }
    if (g.revealSig && g.revealOk) {
      return '<div class="karta srodek">' +
        '<div class="duzy-znak ok">✓</div>' +
        '<h1>Głos odkryty</h1>' +
        '<p class="wybor">Twój wybór: <b>' + nazwa(g.wybor) + '</b></p>' +
        '<a class="przycisk drugi" href="' + linkTx(g.revealSig) + '" target="_blank" rel="noopener">Zobacz w Explorerze</a>' +
        '</div>';
    }
    if (ui.blad && !ui.odkrywanie) {
      return '<div class="karta srodek"><h1>Odkrywanie głosu</h1><p class="blad-tekst">' + esc(ui.blad) + '</p>' +
        '<button class="przycisk" data-akcja="odkryj">Spróbuj jeszcze raz</button></div>';
    }
    return ui.etap === 'kolejka' || ui.etap === 'ponawiam' ? widokWysylania() : widokWysylania('Odkrywam głos…');
  }

  /* Karta salda $MUALA: na ekranie końcowym i (od 12.11) na każdym ekranie po rejestracji,
     żeby przekupieni od razu widzieli łapówkę. */
  function kartaSalda() {
    var saldo;
    if (ui.saldoStan === 'czytam') saldo = '<p class="drugorzedny">Sprawdzam…</p>';
    else if (ui.saldoStan === 'blad') saldo = '<p class="blad-tekst">Nie udało się odczytać salda. Spróbuj za chwilę.</p>';
    else if (ui.saldo !== null) saldo = '<div class="saldo">' + esc(ui.saldo) + ' ' + esc(cfg.muala.nazwa) + '</div>';
    else saldo = '';
    return '<div class="karta">' +
      '<h2>Saldo ' + esc(cfg.muala.nazwa) + '</h2>' +
      '<p class="drugorzedny">Token na mainnecie Solany, na adresie twojego portfela ' + esc(P.skrot(pk)) + '.</p>' +
      saldo +
      '<button class="przycisk" data-akcja="saldo"' + (ui.saldoStan === 'czytam' ? ' disabled' : '') + '>Sprawdź</button>' +
      '</div>';
  }

  /* Faza „Łapówki”: telefon sam sprawdza saldo $MUALA na mainnecie i mówi, czy łapówkarz zapłacił.
     Celowo bez „bo głosowałeś na Hawajską”: podmieniony głos też dostaje łapówkę (zapowiedź ujawnienia). */
  function widokLapowki() {
    var naglowek, opis;
    if (ui.saldoStan === 'czytam' || (ui.saldoStan === null && ui.saldo === null)) {
      naglowek = '<h1>Sprawdzam twój portfel…</h1>';
      opis = '<p class="drugorzedny">Czy łapówkarz ci zapłacił? Czytam saldo $MUALA z mainnetu Solany.</p>';
    } else if (ui.saldoStan === 'blad') {
      naglowek = '<h1>Łapówki</h1>';
      opis = '<p class="blad-tekst">Nie udało się odczytać salda. Kliknij „Sprawdź” za chwilę.</p>';
    } else if (ui.saldoLiczba > 0) {
      naglowek = '<div class="duzy-znak ok">$</div><h1>Dostałeś łapówkę</h1>';
      opis = '<div class="saldo">' + esc(ui.saldo) + ' ' + esc(cfg.muala.nazwa) + '</div>' +
        '<p class="drugorzedny">Prawdziwy token na mainnecie Solany. Łapówkarz nie prosił cię o żaden dowód: przeczytał twój głos z łańcucha.</p>';
    } else {
      naglowek = '<h1>Bez łapówki</h1>';
      opis = '<p class="drugorzedny">Na twoim portfelu nie ma ' + esc(cfg.muala.nazwa) + '. Łapówkarz płacił tylko za głos na Hawajską w rundzie 2.</p>';
    }
    return '<div class="karta srodek">' + naglowek + opis +
      '<button class="przycisk drugi" data-akcja="saldo"' + (ui.saldoStan === 'czytam' ? ' disabled' : '') + '>Sprawdź jeszcze raz</button>' +
      '</div>';
  }

  function widokKonca() {
    return '<div class="karta srodek">' +
      '<h1>Dziękujemy za udział!</h1>' +
      '<p class="drugorzedny">Wybory zakończone. Wszystkie głosy zostają na blockchainie.</p>' +
      '</div>' +
      kartaSalda() +
      '<details id="eksport"><summary>Eksportuj portfel</summary><div class="wnetrze">' +
      '<p class="ostrzezenie">Klucz prywatny daje pełną kontrolę nad portfelem. Nie pokazuj go nikomu i nie wklejaj na stronach.</p>' +
      '<textarea class="klucz" id="klucz" readonly rows="3">' + esc(Base58.koduj(portfel.secretKey)) + '</textarea>' +
      '<button class="przycisk drugi" data-akcja="kopiuj">Kopiuj klucz</button>' +
      '<p class="drugorzedny">W Phantomie: Dodaj portfel, potem Importuj klucz prywatny.</p>' +
      '</div></details>';
  }

  function rundyJawne() {
    return Object.keys(stan.glosy).map(Number).sort(function (a, b) { return a - b; })
      .map(function (r) { var g = stan.glosy[r]; g.r = r; return g; })
      .filter(function (g) { return g.typ === 'vote' && g.potwierdzony; });
  }

  function nakladkaUjawnienia() {
    var jawne = rundyJawne();
    if (!jawne.length) return null;
    var podmienione = jawne.filter(function (g) { return g.wybor !== g.wyslany; });
    var wiele = jawne.length > 1;
    if (podmienione.length) {
      var h = '<div class="nakladka czerwona" id="ujawnienie"><div class="tresc"><h1>Twój głos został podmieniony.</h1>';
      podmienione.forEach(function (g) {
        h += '<p class="wiersz">' + (wiele ? 'Runda ' + g.r + ': t' : 'T') + 'wój wybór <b>' + nazwa(g.wybor) + '</b>, na blockchainie zapisano <b>' + nazwa(g.wyslany) + '</b>.</p>';
      });
      h += '<p>To był pokaz. Podmieniła strona w twoim telefonie, a blockchain wiernie zapisał to, co dostał.</p>';
      podmienione.forEach(function (g) {
        h += '<a class="przycisk bialy" href="' + linkTx(g.sig) + '" target="_blank" rel="noopener">Sprawdź w Explorerze' + (wiele ? ' (runda ' + g.r + ')' : '') + '</a>';
      });
      return h + '</div></div>';
    }
    var z = '<div class="nakladka zielona" id="ujawnienie"><div class="tresc"><h1>Twój głos dotarł bez zmian</h1>';
    jawne.forEach(function (g) {
      z += '<p class="wiersz">' + (wiele ? 'Runda ' + g.r + ': t' : 'T') + 'wój wybór <b>' + nazwa(g.wybor) + '</b>, na blockchainie zapisano <b>' + nazwa(g.wyslany) + '</b>.</p>';
    });
    jawne.forEach(function (g) {
      z += '<a class="przycisk ciemny" href="' + linkTx(g.sig) + '" target="_blank" rel="noopener">Sprawdź w Explorerze' + (wiele ? ' (runda ' + g.r + ')' : '') + '</a>';
    });
    return z + '</div></div>';
  }

  function nakladkaDowodu(sig) {
    return '<div class="nakladka dowod" id="dowod"><div class="tresc srodek">' +
      '<h1>Dowód głosu</h1>' +
      '<p class="drugorzedny">Kod prowadzi do twojej transakcji w Explorerze.</p>' +
      '<div class="qr-ramka">' + QR.svg(linkTx(sig)) + '</div>' +
      '<p class="mono">' + esc(sig.slice(0, 22) + '…') + '</p>' +
      '<button class="przycisk" data-akcja="zamknij">Zamknij</button>' +
      '</div></div>';
  }

  /* ---------- render ---------- */
  function biezacyWidok() {
    var w = widokFazy();
    // karta salda pod ekranem ujawnienia (łapówki i koniec mają ją we własnym widoku)
    if (stan.regSig && fazaZnana && faza.p === 'rigreveal') {
      w = { k: w.k + '|saldo|' + ui.saldoStan + '|' + ui.saldo, h: w.h + kartaSalda() };
    }
    return w;
  }
  function widokFazy() {
    if (!stan.regSig) return { k: 'reg|' + ui.tryb + '|' + ui.etap + '|' + ui.blad, h: widokRejestracji() };
    if (!fazaZnana) return { k: 'laczenie', h: widokWysylania('Łączę z blockchainem…') };
    var g = stan.glosy[faza.r];
    switch (faza.p) {
      case 'vote':
      case 'commit':
        if (g && !g.potwierdzony) return { k: 'wysylam|' + ui.etap, h: widokWysylania() };
        if (g) return { k: 'zapisany|' + faza.r + '|' + g.sig, h: widokZapisany(g) };
        return { k: 'glos|' + faza.p + faza.r + '|' + ui.tryb + '|' + ui.etap + '|' + ui.kandydat + '|' + ui.blad, h: widokGlosowania(faza.p === 'commit') };
      case 'reveal':
        return { k: 'odkr|' + faza.r + '|' + (g && g.revealOk) + '|' + ui.blad + '|' + ui.odkrywanie + '|' + ui.etap, h: widokOdkrywania() };
      case 'lapowka':
        return { k: 'lapowka|' + ui.saldoStan + '|' + ui.saldo, h: widokLapowki() };
      case 'rigreveal':
        return { k: 'rig', h: rundyJawne().length ? widokCzekaniaNaKoniec() : '<div class="karta srodek"><h1>Ujawnienie</h1><p class="drugorzedny">Brak twojego głosu w rundzie jawnej.</p></div>' };
      case 'end':
        return { k: 'end|' + ui.saldoStan + '|' + ui.saldo, h: widokKonca() };
      default:
        return { k: 'czekam|' + stan.nick, h: widokCzekania() };
    }
  }
  function widokCzekaniaNaKoniec() {
    return '<div class="karta srodek"><h1>Ujawnienie</h1><p class="drugorzedny">Sprawdź, co strona zrobiła z twoim głosem.</p></div>';
  }

  function render() {
    $faza.textContent = P.etykietaFazyKrotka(faza);
    $stopka.textContent = (cfg.cluster || 'devnet') + ' · portfel ' + P.skrot(pk);
    var w = biezacyWidok();
    if (w.k !== ostatniKlucz) {
      var otwartyEksport = document.getElementById('eksport');
      otwartyEksport = otwartyEksport && otwartyEksport.open;
      $ekran.innerHTML = w.h;
      ostatniKlucz = w.k;
      var ex = document.getElementById('eksport');
      if (ex && otwartyEksport) ex.open = true;
      var f = document.getElementById('f-reg');
      if (f) f.addEventListener('submit', function (ev) { ev.preventDefault(); zarejestruj(); });
    }
    var nak = '';
    if (ui.dowod) nak = nakladkaDowodu(ui.dowod);
    else if (stan.regSig && fazaZnana && faza.p === 'rigreveal') nak = nakladkaUjawnienia() || '';
    if ($nakladka.getAttribute('data-k') !== nak.length + ':' + (ui.dowod || faza.p)) {
      $nakladka.innerHTML = nak;
      $nakladka.setAttribute('data-k', nak.length + ':' + (ui.dowod || faza.p));
    }
    if (faza.p === 'reveal' && stan.regSig) odkryjAutomatycznie();
    // łapówki i koniec: saldo sprawdzane samo, raz na wejście w fazę
    if ((faza.p === 'lapowka' || faza.p === 'end') && stan.regSig && fazaZnana && ui.saldoAuto !== faza.p && ui.saldoStan !== 'czytam') {
      ui.saldoAuto = faza.p;
      sprawdzSaldo();
    }
  }

  /* ---------- akcje ---------- */
  function komunikatBledu(err) {
    if (window.console) console.error(err);
    return 'Nie udało się wysłać. Sprawdź internet i spróbuj jeszcze raz.';
  }

  async function zarejestruj() {
    var pole = document.getElementById('nick');
    var nick = P.oczyscNick(pole ? pole.value : '');
    ui.nick = pole ? pole.value : '';
    if (!nick) { ui.blad = 'Wpisz nick.'; ostatniKlucz = null; return render(); }
    ui.blad = null; ui.tryb = 'wysylam'; ui.etap = null; render();
    try {
      var sig = await S.wyslijDoSkutku(conn, sponsor, portfel, P.memoReg(cfg.e, nick), { cfg: cfg, opoznienieMs: KOLEJKA_REG_MS, naStan: naEtap });
      stan.nick = nick; stan.regSig = sig; zapiszStan();
      ui.tryb = null; ui.etap = null;
    } catch (err) {
      ui.tryb = null; ui.etap = null; ui.blad = komunikatBledu(err);
    }
    render();
  }

  async function glosuj() {
    var r = faza.r, p = faza.p, wybor = ui.kandydat;
    if (!(p === 'vote' || p === 'commit') || stan.glosy[r] || ui.runda !== r) return;
    ui.tryb = 'wysylam'; ui.etap = null; ui.blad = null; render();
    var g = { typ: p, wybor: wybor, wyslany: wybor, sig: null, potwierdzony: false };
    var memo;
    if (p === 'vote') {
      var rig = cfg.rig || {};
      // podmiana tylko po stronie strony: pokazujemy wybór, wysyłamy cel (SPEC, „Podmiana głosów”)
      if (rig.enabled && wybor !== rig.target && P.losowa() < rig.rate) g.wyslany = rig.target;
      memo = P.memoVote(cfg.e, r, g.wyslany);
    } else {
      g.s = P.nowaSol();
      g.h = P.hashCommit(cfg.e, r, wybor, g.s, pk);
      memo = P.memoCommit(cfg.e, r, g.h);
    }
    try {
      var sig = await S.wyslijDoSkutku(conn, sponsor, portfel, memo, {
        cfg: cfg, opoznienieMs: KOLEJKA_MS, naStan: naEtap,
        poWyslaniu: function (s) { g.sig = s; stan.glosy[r] = g; zapiszStan(); }
      });
      g.sig = sig; g.potwierdzony = true; stan.glosy[r] = g; zapiszStan();
      ui.tryb = null; ui.etap = null; ui.kandydat = null;
    } catch (err) {
      delete stan.glosy[r]; zapiszStan();
      ui.tryb = 'potwierdz'; ui.etap = null; ui.blad = komunikatBledu(err);
    }
    render();
  }

  async function odkryjAutomatycznie(wymus) {
    var r = faza.r, g = stan.glosy[r];
    if (!g || g.typ !== 'commit' || !g.potwierdzony || g.revealOk || ui.odkrywanie) return;
    if (ui.blad && !wymus) return;
    ui.odkrywanie = true; ui.blad = null; ui.etap = null; render();
    try {
      // wszystkie telefony odkrywają naraz po zmianie fazy, więc też z kolejką
      var sig = await S.wyslijDoSkutku(conn, sponsor, portfel, P.memoReveal(cfg.e, r, g.wybor, g.s), {
        cfg: cfg, opoznienieMs: wymus ? 0 : KOLEJKA_MS, naStan: naEtap,
        poWyslaniu: function (s) { g.revealSig = s; zapiszStan(); }
      });
      g.revealSig = sig; g.revealOk = true; zapiszStan();
    } catch (err) {
      ui.blad = komunikatBledu(err);
    }
    ui.odkrywanie = false; ui.etap = null;
    render();
  }

  /* Saldo $MUALA z mainnetu: konto ATA (Token-2022) portfela, odczyt getAccountInfo.
     Publiczny api.mainnet-beta.solana.com odrzuca zapytania z przeglądarek (403), a getTokenAccountsByOwner
     to zapytanie „indeksowane”, którego darmowe RPC nie obsługują, dlatego liczymy adres ATA lokalnie. */
  async function sprawdzSaldo() {
    ui.saldoStan = 'czytam'; render();
    try {
      var mainnet = new w3.Connection(cfg.rpcMainnet, 'confirmed');
      var program = new w3.PublicKey(cfg.muala.program || 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
      var ataProgram = new w3.PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
      var mint = new w3.PublicKey(cfg.muala.mint);
      var ata = w3.PublicKey.findProgramAddressSync([portfel.publicKey.toBytes(), program.toBytes(), mint.toBytes()], ataProgram)[0];
      var konto = await mainnet.getParsedAccountInfo(ata, 'confirmed');
      var suma = 0;
      if (konto.value && konto.value.data && konto.value.data.parsed) {
        var t = konto.value.data.parsed.info.tokenAmount;
        suma = Number(t.uiAmountString || t.uiAmount || 0);
      }
      ui.saldo = suma.toLocaleString('pl-PL', { maximumFractionDigits: cfg.muala.decimals });
      ui.saldoLiczba = suma;
      ui.saldoStan = null;
    } catch (err) {
      if (window.console) console.error(err);
      ui.saldoStan = 'blad';
    }
    render();
  }

  function kopiujKlucz() {
    var t = document.getElementById('klucz');
    if (!t) return;
    var tekst = t.value;
    function zaznacz() { t.focus(); t.select(); try { document.execCommand('copy'); } catch (err) { /* nic */ } }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(tekst).catch(zaznacz);
    else zaznacz();
  }

  document.addEventListener('click', function (ev) {
    var el = ev.target.closest ? ev.target.closest('[data-akcja]') : null;
    if (!el) return;
    var a = el.getAttribute('data-akcja');
    if (a === 'wybierz') { ui.tryb = 'potwierdz'; ui.kandydat = el.getAttribute('data-id'); ui.runda = faza.r; ui.blad = null; render(); }
    else if (a === 'anuluj') { ui.tryb = null; ui.kandydat = null; ui.blad = null; render(); }
    else if (a === 'glosuj') glosuj();
    else if (a === 'dowod') { ui.dowod = el.getAttribute('data-sig'); render(); }
    else if (a === 'zamknij') { ui.dowod = null; render(); }
    else if (a === 'odkryj') odkryjAutomatycznie(true);
    else if (a === 'saldo') sprawdzSaldo();
    else if (a === 'kopiuj') kopiujKlucz();
  });
  document.addEventListener('input', function (ev) { if (ev.target && ev.target.id === 'nick') ui.nick = ev.target.value; });

  /* ---------- start ---------- */
  // głos wysłany, ale niepotwierdzony przed zamknięciem strony: dokończ potwierdzenie albo usuń
  Object.keys(stan.glosy).forEach(function (r) {
    var g = stan.glosy[r];
    if (g && !g.potwierdzony) {
      if (!g.sig) { delete stan.glosy[r]; zapiszStan(); return; }
      S.potwierdz(conn, g.sig, cfg).then(function (st) {
        if (st) g.potwierdzony = true; else delete stan.glosy[r];
        zapiszStan(); render();
      })
        .catch(function () { delete stan.glosy[r]; zapiszStan(); render(); });
    }
  });

  var czytnik = new S.CzytnikFazy(conn, cfg, function (f) {
    var stara = faza;
    faza = { p: f.p, r: f.r };
    if (stara.p !== faza.p || stara.r !== faza.r) {
      if (ui.tryb === 'potwierdz') { ui.tryb = null; ui.kandydat = null; }
      if (ui.tryb !== 'wysylam') ui.blad = null;
      ui.dowod = null;
    }
    fazaZnana = true;
    render();
  }, {
    polling: 30000, pollingZWs: 90000, rozrzutStartu: 12000, rozrzutWeryfikacji: 20000,
    naOdczyt: function () { if (!fazaZnana) { fazaZnana = true; render(); } }
  });
  czytnik.start();
  render();

  window.WYBORY_TELEFON = { stan: function () { return { pk: pk, faza: faza, stan: stan }; } };
})();
