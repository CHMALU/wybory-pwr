/* QR jako SVG (vendor/qrcode.js, qrcode-generator). Globalny QR.svg(tekst). */
(function (root) {
  'use strict';
  function svg(tekst, opcje) {
    opcje = opcje || {};
    var q = root.qrcode(0, opcje.poziom || 'M');
    q.addData(tekst);
    q.make();
    var n = q.getModuleCount(), m = opcje.margines == null ? 2 : opcje.margines, d = '';
    for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) if (q.isDark(y, x)) d += 'M' + (x + m) + ' ' + (y + m) + 'h1v1h-1z';
    var w = n + 2 * m;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + w + '" shape-rendering="crispEdges" role="img" aria-label="Kod QR">' +
      '<rect width="' + w + '" height="' + w + '" fill="#FFFFFF"/><path d="' + d + '" fill="#0F1222"/></svg>';
  }
  root.QR = { svg: svg };
})(typeof self !== 'undefined' ? self : this);
