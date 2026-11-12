/* Panel prowadzącego (admin.html): zmiana faz podpisana kluczem organizatora z pliku. */
(function () {
  'use strict';
  var cfg = window.WYBORY_CONFIG, P = window.Protokol, S = window.Siec, w3 = window.solanaWeb3;
  var conn = S.polacz(cfg);
  var sponsor = S.keypairZSekretu(cfg.sponsor.secretKey);
  var organizator = null, wysylam = false;
  var $runda = document.getElementById('runda');
  var $fazy = document.getElementById('fazy');
  var $log = document.getElementById('log');
  document.getElementById('e').textContent = cfg.e;

  function runda() { var r = parseInt($runda.value, 10); return r >= 1 && r <= 99 ? r : 1; }
  function odswiezPrzyciski() {
    document.querySelectorAll('#fazy .nr').forEach(function (s) { s.textContent = runda(); });
    document.querySelectorAll('#fazy button').forEach(function (b) {
      var p = b.getAttribute('data-p');
      b.disabled = !organizator || wysylam;
      var f = czytnik.faza;
      b.classList.toggle('aktualna', f.p === p && (!P.FAZY_Z_RUNDA[p] || f.r === runda()));
    });
  }
  function wpis(html) { var li = document.createElement('li'); li.innerHTML = html; $log.insertBefore(li, $log.firstChild); }

  document.getElementById('plik').addEventListener('change', function (ev) {
    var f = ev.target.files && ev.target.files[0];
    if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
      var $s = document.getElementById('klucz-stan');
      try {
        var kp = w3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(rd.result)));
        if (kp.publicKey.toBase58() !== cfg.organizator) throw new Error('To nie jest klucz organizatora z config.js (' + P.skrot(kp.publicKey.toBase58()) + ').');
        organizator = kp;
        $s.textContent = 'Wczytano: ' + kp.publicKey.toBase58();
        $s.className = 'ok mono';
      } catch (err) {
        organizator = null;
        $s.textContent = 'Błąd: ' + err.message;
        $s.className = 'blad';
      }
      odswiezPrzyciski();
    };
    rd.readAsText(f);
  });

  document.querySelectorAll('.krok').forEach(function (b) {
    b.addEventListener('click', function () { $runda.value = Math.min(99, Math.max(1, runda() + Number(b.getAttribute('data-krok')))); odswiezPrzyciski(); });
  });
  $runda.addEventListener('input', odswiezPrzyciski);

  $fazy.addEventListener('click', async function (ev) {
    var b = ev.target.closest('button[data-p]');
    if (!b || !organizator || wysylam) return;
    var p = b.getAttribute('data-p'), r = runda();
    wysylam = true; odswiezPrzyciski();
    var etykieta = P.etykietaFazy({ p: p, r: r });
    try {
      var sig = await S.wyslijFaze(conn, sponsor, organizator, cfg, p, r);
      wpis('<span class="ok">' + etykieta + '</span> <a href="' + P.explorerTx(sig, cfg.cluster) + '" target="_blank" rel="noopener">tx</a>');
      czytnik.sprawdz();
    } catch (err) {
      wpis('<span class="blad">' + etykieta + ': ' + (err && err.message ? err.message : err) + '</span>');
    }
    wysylam = false; odswiezPrzyciski();
  });

  var czytnik = new S.CzytnikFazy(conn, cfg, function (f) {
    document.getElementById('faza').textContent = P.etykietaFazy(f);
    if (P.FAZY_Z_RUNDA[f.p]) $runda.value = f.r;
    odswiezPrzyciski();
  }, { weryfikuj: true, polling: 6000, pollingZWs: 30000, naOdczyt: function (err) {
    if (!czytnik.faza.sig && !err) document.getElementById('faza').textContent = 'Rejestracja (brak zmian faz)';
  } });
  czytnik.start();

  async function saldo() {
    try {
      var l = await conn.getBalance(sponsor.publicKey);
      var sol = l / w3.LAMPORTS_PER_SOL;
      document.getElementById('saldo').innerHTML = '<b class="' + (sol < 0.05 ? 'blad' : 'ok') + '">' + sol.toFixed(4) + ' SOL</b> <span class="mono drugorzedny">' + P.skrot(sponsor.publicKey.toBase58()) + '</span>';
    } catch (err) { document.getElementById('saldo').textContent = 'nie udało się odczytać'; }
  }
  saldo(); setInterval(saldo, 30000);
  odswiezPrzyciski();
})();
