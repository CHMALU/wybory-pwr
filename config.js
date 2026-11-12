/* Konfiguracja wyborów. Wygenerowane przez skrypty/setup.js (2026-11-12T10:08:28.740Z).
   Ustawienia (pytanie, kandydaci, rig, rpc, stronaUrl) można zmieniać ręcznie, setup je zachowa.
   e        identyfikator wyborów; nowe e = czyste wybory (node skrypty/setup.js --nowe-wybory)
   startSlot  od tego slotu ekran wyników czyta historię sponsora (starsze pomija)
   rpc / ws   endpoint devnetu (np. własny z Helius, gdy publiczny ma limity); ws null = z rpc
   rpcWyniki / wsWyniki  opcjonalnie inny endpoint tylko dla ekranu wyników (null = rpc / ws)
   kolejkaMs  losowe opóźnienie (0..kolejkaMs) pierwszej próby wysłania głosu i odkrycia, kolejkaRegMs rejestracji
   rpcMainnet tylko odczyt salda $MUALA na telefonie (musi przyjmować zapytania z przeglądarki)
   stronaUrl  adres strony do QR na ekranie wyników; null = index.html obok wyniki.html
   rig        podmiana głosów na telefonie: cel i odsetek (0.2 = co piąty głos na innego kandydata)
   sponsor    portfel TYLKO z devnetu, płaci opłaty; jego klucz prywatny jest tu celowo jawny
   fazaKonto / fazy  konto nonce z bieżącą fazą (authority = klucz fazy) i tabela kluczy faz */
(function (root) {
  var CONFIG = {
    "e": "wxma6e36a",
    "startSlot": 521427885,
    "rpc": "https://api.devnet.solana.com",
    "ws": null,
    "rpcWyniki": null,
    "wsWyniki": null,
    "kolejkaMs": 20000,
    "kolejkaRegMs": 6000,
    "cluster": "devnet",
    "rpcMainnet": "https://solana-rpc.publicnode.com",
    "muala": {
      "mint": "FCXkGtDe45tCuaPYKyyo6ZWV4iiikqyGiSFYvt8pump",
      "decimals": 6,
      "nazwa": "$MUALA",
      "program": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
    },
    "stronaUrl": "https://chmalu.github.io/wybory-pwr/",
    "pytanie": "Jaka pizza jest najlepsza?",
    "kandydaci": [
      {
        "id": "A",
        "nazwa": "Margherita",
        "kolor": "#9945FF"
      },
      {
        "id": "B",
        "nazwa": "Hawajska",
        "kolor": "#00C2FF"
      },
      {
        "id": "C",
        "nazwa": "Pepperoni",
        "kolor": "#14F195"
      }
    ],
    "rig": {
      "enabled": true,
      "target": "B",
      "rate": 0.5
    },
    "sponsor": {
      "publicKey": "2jNuphkCqFW8WChX8YRkoZqK1pTRecv5tZZt17z8eRBr",
      "secretKey": [
        12,
        135,
        229,
        0,
        195,
        138,
        216,
        93,
        23,
        0,
        155,
        199,
        220,
        158,
        238,
        96,
        146,
        85,
        113,
        137,
        10,
        41,
        216,
        214,
        2,
        46,
        49,
        41,
        248,
        81,
        50,
        254,
        25,
        182,
        218,
        254,
        217,
        39,
        222,
        173,
        84,
        195,
        56,
        143,
        1,
        232,
        240,
        235,
        57,
        61,
        248,
        92,
        63,
        28,
        0,
        86,
        107,
        197,
        48,
        196,
        46,
        144,
        98,
        45
      ]
    },
    "organizator": "4HMhsFfWJ3MNJnj5nF1UsogzWeAyfguEGgbqWPz5PjFp",
    "fazaKonto": "Axq7GWuoUuQMZCWXVdj8yfySWbkZNAdkpRuMFPZmWrpn",
    "fazy": {
      "pZtLRaWSZF7zQyJJ2RYMGEKP74f9RsgZE9isxfAT3NL": "reg",
      "CyJpRzrJbjovESkMAJkZEEoBEDgezSnLAUxv5bhqAdqz": "lapowka",
      "EEZrS6g5uSwoYJkvAyuZ7brUAb5mH1uwvKm6WyeWFvjP": "rigreveal",
      "6rd663MFTgRNncJhcuKjS27mEzB65f5xHFSaVrKTkPqm": "end",
      "6rinTPZy2krw8xfeRA9XHnZzBesx5RxnR3qaoc5SSivS": "vote1",
      "DyBF4RH6M7JJotRm4CgniNvymfaSM7PiHMzNvu61KJ2p": "commit1",
      "7aVwT2NdhsZQAzUArY8RhP6XxsQXESVug8EZQUVcs7fg": "reveal1",
      "6F6NRGSgADazghV9EMdnCBtMj1CtXF124nAQRpTTwPRZ": "vote2",
      "3M6vrwUVvDpCduDSLDpuxrxkEZqXBxKawzjWyM2hwM77": "commit2",
      "t7KnFu3p6QUeSAgW8zaTnVa2xxzTJPkuATKKJLPkStP": "reveal2",
      "9nT1QdNjFbKnvF6eAkegwyMoRVqaDvChcx9BmCuUSYLs": "vote3",
      "BoN5BQoDJhRa6zsiwgBnrK5dq31y2KbJ9s3e4fGs4hAm": "commit3",
      "2fMrK5DihN22LioEQsWT1oQQMQZ7Ap8edJDpSuekcVBK": "reveal3",
      "2CkNPfcvsBnCx2aAQ7YLZ5dAj4vv1KsNoq1JpJjqPBBw": "vote4",
      "2ax9ytHcuqXw2yyDdTg6LisBqDYw2LU6JXQa2mw54nmL": "commit4",
      "GU47HJCmnNpc3dT3QKPsWjsFU624sz5FxdWWBs9uxGec": "reveal4",
      "EziiVAMi73rnN5mGaGQ8m9FaY4Vu1yV7P1ditKU9HGVP": "vote5",
      "GW7EkdWbXzJMqfM9TpiqdUgqG2LJAv3YHXcCRuQaoLmH": "commit5",
      "CzFtz2AMp4Lvvai7c47BroXygYGwj55gp4rLuyn2r2VZ": "reveal5",
      "3YzZYYSUuQhcDkK19oYnqtUZMgzmDwRpU4gWCiJ4ZvgS": "vote6",
      "9wbETdzdm2uKHeBW6ZusBkF7rriZsUweShQqvaVWGJxG": "commit6",
      "C8LkjKrv9b4SnGwfngdbDZ6KzugN1WWwVm6Fa7iZDQ8C": "reveal6",
      "7xXmRaoAxmChgWuvuNx1KwFymF32jMCwrVpLvkc4VnUK": "vote7",
      "7SMHJYviB5wgrZwGEHcTCX83i9YWsjS8o3u1Ug2T7L4z": "commit7",
      "3EYPdkog4cuxpLsVkDH2ieGJA9737pKA1qq1PBNdvJW9": "reveal7",
      "2NFdJ8s6Bv7A1JDZUx3hyh1UzkuSdMVhbn1D9gCehReX": "vote8",
      "6P6ko5VWU3eQUVQhemBxoFnQoEyYRsWwYCfPkXRtEssp": "commit8",
      "5xpTABDCzRT5aXPLfWt4q3ooFC74RAkhVCGA18M1p8Eo": "reveal8",
      "BDrrCcT44eBMSDoRwaRsA6hjc9oKuLVqzw2YZ2bXShXh": "vote9",
      "7fQDLPue2T1u1pAehwYS1tZUKuGBe2eiFVqFWBvdaxxa": "commit9",
      "EDrMoZQXxnNuvC4kT8XAD56x7tvzDJuE2ifpY8rno6zD": "reveal9"
    }
  };
  if (typeof module === 'object' && module.exports) module.exports = CONFIG;
  else root.WYBORY_CONFIG = CONFIG;
})(typeof self !== 'undefined' ? self : this);
