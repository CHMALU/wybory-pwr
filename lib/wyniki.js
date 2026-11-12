/* Ekran wyników na projektor (wyniki.html). Wszystko liczone z łańcucha (Protokol.policz). */
(function () {
  'use strict';
  var cfg = window.WYBORY_CONFIG, P = window.Protokol, S = window.Siec;
  var $lewa = document.getElementById('lewa');
  var $faza = document.getElementById('faza');
  var $qr = document.getElementById('qr');
  var $kropka = document.getElementById('kropka');
  var $naZywo = document.getElementById('na-zywo');
  var $ostatnie = document.getElementById('ostatnie');

  // projektor może czytać z innego endpointu niż telefony (rpcWyniki / wsWyniki w config.js)
  var conn = S.polacz(cfg, cfg.rpcWyniki || undefined);
  var wsWyniki = cfg.wsWyniki || (cfg.rpcWyniki ? cfg.rpcWyniki.replace(/^http/, 'ws') : undefined);
  var czytnik = new S.CzytnikHistorii(conn, cfg, { cache: true, getTxNaRaz: 3, wsUrl: wsWyniki });
  var zakladka = 'wyniki';
  var wynik = czytnik.wynik();
  var ostatniOk = 0, bladOdczytu = false;
  var kluczLewej = null, kluczQr = null, kluczTabeli = null, kluczOstatnich = null;

  var adresStrony = cfg.stronaUrl || new URL('index.html', location.href).href;

  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function kand(id) {
    for (var i = 0; i < cfg.kandydaci.length; i++) if (cfg.kandydaci[i].id === id) return cfg.kandydaci[i];
    return { id: id, nazwa: id, kolor: '#A9B0D0' };
  }
  function proc(n, suma) { return suma ? Math.round((100 * n) / suma) : 0; }
  function glosow(n) {
    var d = n % 10, s = n % 100;
    return n + ' ' + (n === 1 ? 'głos' : (d >= 2 && d <= 4 && !(s >= 12 && s <= 14)) ? 'głosy' : 'głosów');
  }
  /* krótka nazwa do tabeli: bez dopisku w nawiasie („Hawajska (z ananasem)” -> „Hawajska”) */
  function krotka(k) { return k.krotko || String(k.nazwa).replace(/\s*\(.*\)\s*$/, ''); }
  function litera(k) { return '<span class="litera" style="background:' + k.kolor + '">' + esc(k.id) + '</span>'; }

  /* runda pokazywana w zakładce Wyniki: z bieżącej fazy, a w ujawnieniu i na końcu ostatnia runda */
  function biezacaRunda() {
    var r = wynik.faza.r;
    var lista = wynik.rundy;
    for (var i = 0; i < lista.length; i++) if (lista[i].r === r) return lista[i];
    return lista.length ? lista[lista.length - 1] : null;
  }

  /* ---------- zakładka Wyniki ---------- */
  function trybWynikow() {
    var R = biezacaRunda();
    if (wynik.faza.p === 'reg' || !R) return { tryb: 'reg', R: null };
    if (R.ukryta && wynik.faza.p === 'commit' && wynik.faza.r === R.r) return { tryb: 'zaszyfrowane', R: R };
    return { tryb: 'slupki', R: R };
  }

  function zbudujWyniki(t) {
    if (t.tryb === 'reg') {
      var chips = cfg.kandydaci.map(function (k) { return '<span class="chip">' + litera(k) + esc(k.nazwa) + '</span>'; }).join('');
      return '<h1 class="pytanie">' + esc(cfg.pytanie) + '</h1>' +
        '<div class="srodek-panelu">' +
        '<div class="opis">Zeskanuj kod i odbierz kartę do głosowania</div>' +
        '<div class="wielka-liczba" data-pole="zarej">0</div>' +
        '<div class="podtytul">zarejestrowanych</div>' +
        '</div>' +
        '<div class="lista-kandydatow">' + chips + '</div>';
    }
    if (t.tryb === 'zaszyfrowane') {
      return '<h1 class="pytanie">' + esc(cfg.pytanie) + '</h1>' +
        '<div class="srodek-panelu">' +
        '<div class="opis">Tym razem wyniki są ukryte do końca</div>' +
        '<div class="podtytul">Zaszyfrowane głosy:</div>' +
        '<div class="wielka-liczba" data-pole="commity">0</div>' +
        '</div>';
    }
    var h = '<h1 class="pytanie">' + esc(cfg.pytanie) + '</h1>' +
      '<div class="podtytul" data-pole="podpis"></div><div class="slupki">';
    cfg.kandydaci.forEach(function (k) {
      h += '<div class="slupek" data-kand="' + esc(k.id) + '">' +
        '<div class="etykieta">' + litera(k) + '<span class="nazwa">' + esc(k.nazwa) + '</span>' +
        '<span class="liczby"><span class="ile">0</span><span class="proc">0%</span></span></div>' +
        '<div class="tor"><div class="wypelnienie" style="width:0%;background:' + k.kolor + '"></div></div></div>';
    });
    return h + '</div>';
  }

  function aktualizujWyniki(t) {
    var z = $lewa.querySelector('[data-pole="zarej"]');
    if (z) z.textContent = wynik.liczbaZarejestrowanych;
    var c = $lewa.querySelector('[data-pole="commity"]');
    if (c && t.R) c.textContent = t.R.liczbaCommit;
    if (t.tryb !== 'slupki') return;
    var R = t.R;
    var podpis = 'Runda ' + R.r + (R.ukryta ? ': odkryte ' + R.liczbaOdkryte + ' z ' + R.liczbaCommit + ' zaszyfrowanych' : '') + ' · głosów: ' + R.suma;
    $lewa.querySelector('[data-pole="podpis"]').textContent = podpis;
    cfg.kandydaci.forEach(function (k) {
      var el = $lewa.querySelector('.slupek[data-kand="' + k.id + '"]');
      if (!el) return;
      var n = R.wyniki[k.id] || 0, p = proc(n, R.suma);
      el.querySelector('.ile').textContent = n;
      el.querySelector('.proc').textContent = p + '%';
      el.querySelector('.wypelnienie').style.width = (R.suma ? Math.max(p, 0.5) : 0) + '%';
    });
  }

  /* ---------- zakładka Porównanie rund ---------- */
  function zbudujPorownanie() {
    if (!wynik.rundy.length) return '<h1 class="pytanie">Porównanie rund</h1><div class="pusto">Jeszcze nie było żadnej rundy.</div>';
    var maks = 1;
    wynik.rundy.forEach(function (R) {
      cfg.kandydaci.forEach(function (k) { maks = Math.max(maks, proc(R.wyniki[k.id], R.suma)); });
    });
    var h = '<h1 class="pytanie">Porównanie rund</h1><div class="porownanie">';
    wynik.rundy.forEach(function (R) {
      var zaszyfrowana = R.ukryta && wynik.faza.p === 'commit' && wynik.faza.r === R.r;
      h += '<div class="kolumna-rundy"><div class="naglowek">Runda ' + R.r + '<small>' +
        (R.ukryta ? 'ukryta' : 'jawna') + ' · ' + (zaszyfrowana ? R.liczbaCommit + ' zaszyfr.' : glosow(R.suma)) + '</small></div>';
      if (zaszyfrowana) {
        h += '<div class="wykres" style="align-items:center;justify-content:center"><div class="pusto">Zaszyfrowane głosy: ' + R.liczbaCommit + '</div></div>';
      } else {
        h += '<div class="wykres">';
        cfg.kandydaci.forEach(function (k) {
          var n = R.wyniki[k.id] || 0, p = proc(n, R.suma);
          h += '<div class="pion"><span class="wart">' + n + '</span><span class="proc">' + p + '%</span>' +
            '<div class="bar" style="height:' + (R.suma ? (75 * p) / maks : 0) + '%;background:' + k.kolor + '"></div></div>';
        });
        h += '</div>';
      }
      h += '<div class="litery">' + cfg.kandydaci.map(function (k) { return '<span style="color:' + k.kolor + '">' + esc(k.id) + '</span>'; }).join('') + '</div></div>';
    });
    h += '</div><div class="legenda">' + cfg.kandydaci.map(function (k) { return '<span class="chip">' + litera(k) + esc(k.nazwa) + '</span>'; }).join('') + '</div>';
    return h;
  }

  /* ---------- zakładka Tajność ---------- */
  /* Tabela z łańcucha. Boty (nick „bot-…”) zwinięte w jeden wiersz z rozkładem głosów.
     Ponad ok. 18 wierszy: tryb kompaktowy, dwie kolumny i same litery kandydatów (ok. 38 osób
     na 1920×1080 bez przewijania; przy jeszcze większej sali tabela się przewija). */
  function zbudujTajnosc() {
    var rundy = wynik.rundy;
    var ludzie = wynik.glosujacy.filter(function (g) { return !/^bot-/i.test(g.nick); });
    var boty = wynik.glosujacy.filter(function (g) { return /^bot-/i.test(g.nick); });
    var wiersze = ludzie.length + (boty.length ? 1 : 0);
    var kompakt = wiersze > 18;
    var h = '<h1 class="pytanie">Kto na kogo głosował</h1>' +
      '<div class="podtytul">Złożone z publicznego łańcucha: nick z rejestracji + głosy z tego samego adresu.</div>';
    if (!wynik.glosujacy.length) return h + '<div class="pusto">Nikt się jeszcze nie zarejestrował.</div>';
    if (kompakt) {
      h += '<div class="legenda kompakt">' + cfg.kandydaci.map(function (k) { return '<span class="chip">' + litera(k) + esc(k.nazwa) + '</span>'; }).join('') + '</div>';
    }

    function komorka(x) {
      if (!x) return '<td class="drugorzedny"></td>';
      if (x.ukryty) return '<td><span class="glos zaszyfrowany">' + (kompakt ? 'szyfr.' : 'zaszyfrowany') + '</span></td>';
      var k = kand(x.c);
      return '<td><span class="glos">' + litera(k) + (kompakt ? '' : esc(krotka(k))) + '</span></td>';
    }
    function wierszBotow() {
      var w = '<tr class="boty"><td class="nick">boty ×' + boty.length + '</td><td class="adr">' + boty.length + ' adr.</td>';
      rundy.forEach(function (R) {
        var ile = {}, szyfr = 0, razem = 0;
        boty.forEach(function (g) {
          var x = g.rundy[R.r];
          if (!x) return;
          razem++;
          if (x.ukryty) szyfr++; else ile[x.c] = (ile[x.c] || 0) + 1;
        });
        if (!razem) { w += '<td class="drugorzedny"></td>'; return; }
        var t = cfg.kandydaci.filter(function (k) { return ile[k.id]; })
          .map(function (k) { return '<span class="glos">' + litera(k) + '<b>' + ile[k.id] + '</b></span>'; }).join(' ');
        if (szyfr) t += ' <span class="glos zaszyfrowany">szyfr. ' + szyfr + '</span>';
        w += '<td class="rozklad">' + t + '</td>';
      });
      return w + '</tr>';
    }
    function tabela(lista, zBotami) {
      var t = '<table class="tajnosc' + (kompakt ? ' kompakt' : '') + '"><colgroup>' +
        (kompakt ? '<col style="width:32%"><col style="width:28%">' : '<col style="width:17%"><col style="width:16%">') +
        rundy.map(function () { return '<col>'; }).join('') + '</colgroup><thead><tr><th>Nick</th><th>Adres</th>' +
        rundy.map(function (R) { return '<th>' + (kompakt ? 'R' + R.r + (R.ukryta ? ' ukr.' : '') : 'Runda ' + R.r + (R.ukryta ? ' (ukryta)' : '')) + '</th>'; }).join('') +
        '</tr></thead><tbody>';
      lista.forEach(function (g) {
        t += '<tr><td class="nick">' + esc(g.nick) + '</td><td class="adr">' + esc(P.skrot(g.pubkey)) + '</td>';
        rundy.forEach(function (R) { t += komorka(g.rundy[R.r]); });
        t += '</tr>';
      });
      if (zBotami && boty.length) t += wierszBotow();
      return t + '</tbody></table>';
    }
    if (!kompakt) return h + '<div class="tabela-ramka">' + tabela(ludzie, true) + '</div>';
    var pol = Math.ceil(wiersze / 2);
    return h + '<div class="tabela-ramka dwie">' + tabela(ludzie.slice(0, pol), false) + tabela(ludzie.slice(pol), true) + '</div>';
  }

  /* ---------- prawa kolumna ---------- */
  function renderPrawej() {
    var duzy = wynik.faza.p === 'reg';
    // w rejestracji licznik jest duży po lewej, więc miejsce po prawej dostaje QR i lista transakcji
    document.querySelector('.liczniki').classList.toggle('ukryty', duzy);
    var k = duzy ? 'duzy' : 'maly';
    if (k !== kluczQr) {
      $qr.className = 'panel qr ' + k;
      var adres = esc(adresStrony.replace(/^https?:\/\//, ''));
      $qr.innerHTML = '<div class="ramka">' + QR.svg(adresStrony, { margines: 1 }) + '</div>' +
        '<div>' + (duzy ? '<div class="zacheta">Zeskanuj i głosuj</div>' : '<div class="zacheta" style="font-size:1.4rem">Głosuj tutaj</div>') +
        '<div class="adres-strony">' + adres + '</div></div>';
      kluczQr = k;
    }
    document.getElementById('l-zarej').textContent = wynik.liczbaZarejestrowanych;
    var R = biezacaRunda();
    var ile = 0, opis = 'głosy w rundzie';
    if (R && wynik.faza.p !== 'reg') {
      if (R.ukryta) { ile = wynik.faza.p === 'commit' ? R.liczbaCommit : R.liczbaOdkryte; opis = (wynik.faza.p === 'commit' ? 'zaszyfrowane głosy' : 'odkryte głosy') + ', runda ' + R.r; }
      else { ile = R.suma; opis = 'głosy w rundzie ' + R.r; }
    }
    document.getElementById('l-glosy').textContent = ile;
    document.getElementById('l-glosy-opis').textContent = opis;

    var lista = wynik.ostatnie.slice(0, duzy ? 6 : 14);
    var kl = lista.map(function (x) { return x.sig; }).join(',');
    if (kl !== kluczOstatnich) {
      $ostatnie.innerHTML = lista.length ? lista.map(function (x) {
        return '<li><span class="adr">' + esc(P.skrot(x.aktor)) + '</span><span class="typ">' + esc(P.etykietaTypu(x.t)) + '</span>' +
          '<a href="' + P.explorerTx(x.sig, cfg.cluster) + '" target="_blank" rel="noopener">Explorer ↗</a></li>';
      }).join('') : '<li class="drugorzedny">Czekamy na pierwsze transakcje…</li>';
      kluczOstatnich = kl;
    }
  }

  /* ---------- render ---------- */
  function render() {
    $faza.textContent = P.etykietaFazy(wynik.faza);
    document.querySelectorAll('#zakladki button').forEach(function (b) {
      b.classList.toggle('aktywna', b.getAttribute('data-zakladka') === zakladka);
    });
    if (zakladka === 'wyniki') {
      var t = trybWynikow();
      var k = 'w|' + t.tryb + '|' + (t.R ? t.R.r : '');
      if (k !== kluczLewej) { $lewa.innerHTML = zbudujWyniki(t); kluczLewej = k; $lewa.classList.remove('kompakt'); }
      // po wstawieniu nowych słupków poczekaj klatkę, żeby szerokość przeszła animacją
      requestAnimationFrame(function () { aktualizujWyniki(t); });
    } else {
      var html = zakladka === 'porownanie' ? zbudujPorownanie() : zbudujTajnosc();
      if (html !== kluczTabeli || kluczLewej !== zakladka) {
        var ramka = $lewa.querySelector('.tabela-ramka'), scroll = ramka ? ramka.scrollTop : 0;
        $lewa.innerHTML = html; kluczTabeli = html; kluczLewej = zakladka;
        $lewa.classList.toggle('kompakt', !!$lewa.querySelector('table.kompakt'));
        var nowa = $lewa.querySelector('.tabela-ramka'); if (nowa) nowa.scrollTop = scroll;
      }
    }
    renderPrawej();
    renderStanu();
  }

  function renderStanu() {
    var ok = !bladOdczytu && Date.now() - ostatniOk < 15000;
    $kropka.classList.toggle('blad', !ok);
    var brak = czytnik.brakujace();
    $naZywo.textContent = ok ? (brak ? 'na żywo z devnetu (doczytuję ' + brak + ')' : 'na żywo z devnetu') : 'brak połączenia z devnetem';
  }

  function ustawZakladke(z) { zakladka = z; kluczLewej = null; render(); }
  document.getElementById('zakladki').addEventListener('click', function (ev) {
    var b = ev.target.closest('button'); if (b) ustawZakladke(b.getAttribute('data-zakladka'));
  });
  document.addEventListener('keydown', function (ev) {
    var z = { '1': 'wyniki', '2': 'porownanie', '3': 'tajnosc' }[ev.key];
    if (z) ustawZakladke(z);
  });

  /* websocket: nowa transakcja od razu na ekranie */
  czytnik.sluchaj(function () { wynik = czytnik.wynik(); render(); });

  var bledyZRzedu = 0;
  async function petla() {
    try {
      wynik = await czytnik.odswiez();
      ostatniOk = Date.now(); bladOdczytu = false; bledyZRzedu = 0;
    } catch (err) {
      bladOdczytu = true; bledyZRzedu++;
      if (window.console) console.warn('odczyt historii:', err && err.message);
    }
    render();
    // przy limicie RPC zwalniamy (do 30 s), żeby nie przedłużać blokady IP
    setTimeout(petla, S.rozrzut(Math.min(30000, (cfg.odswiezanieMs || 3000) * Math.pow(2, bledyZRzedu)), 0.1));
  }
  render();
  petla();
  setInterval(renderStanu, 2000);

  window.WYBORY_WYNIKI = { wynik: function () { return wynik; }, brakujace: function () { return czytnik.brakujace(); } };
})();
