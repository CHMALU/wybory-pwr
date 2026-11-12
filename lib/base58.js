/* Base58 (alfabet Bitcoina/Solany): kodowanie i dekodowanie bajtów.
   Przeglądarka: globalny Base58. Node: require('./base58'). */
(function (root, factory) {
  var m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else root.Base58 = m;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var ALFABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  var MAPA = {};
  for (var i = 0; i < ALFABET.length; i++) MAPA[ALFABET.charAt(i)] = i;

  function koduj(bajty) {
    bajty = Uint8Array.from(bajty);
    if (bajty.length === 0) return '';
    var cyfry = [0];
    for (var i = 0; i < bajty.length; i++) {
      var przen = bajty[i];
      for (var j = 0; j < cyfry.length; j++) {
        przen += cyfry[j] << 8;
        cyfry[j] = przen % 58;
        przen = (przen / 58) | 0;
      }
      while (przen > 0) { cyfry.push(przen % 58); przen = (przen / 58) | 0; }
    }
    var wynik = '';
    for (var k = 0; k < bajty.length && bajty[k] === 0; k++) wynik += '1';
    for (var q = cyfry.length - 1; q >= 0; q--) wynik += ALFABET.charAt(cyfry[q]);
    return wynik;
  }

  function dekoduj(tekst) {
    if (typeof tekst !== 'string') throw new TypeError('Base58: oczekiwano tekstu');
    if (tekst.length === 0) return new Uint8Array(0);
    var bajty = [0];
    for (var i = 0; i < tekst.length; i++) {
      var w = MAPA[tekst.charAt(i)];
      if (w === undefined) throw new Error('Base58: niedozwolony znak');
      var przen = w;
      for (var j = 0; j < bajty.length; j++) {
        przen += bajty[j] * 58;
        bajty[j] = przen & 0xff;
        przen >>= 8;
      }
      while (przen > 0) { bajty.push(przen & 0xff); przen >>= 8; }
    }
    for (var k = 0; k < tekst.length && tekst.charAt(k) === '1'; k++) bajty.push(0);
    return Uint8Array.from(bajty.reverse());
  }

  return { koduj: koduj, dekoduj: dekoduj };
});
