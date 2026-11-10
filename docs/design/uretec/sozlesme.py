"""Akış sözleşmesi denetimi (docs/specs/2026-10-04-flow-contract.md): panolarda karara bağlanmış yer tutucu ve
eski söz kalmış mı. Kullanım: python3 sozlesme.py [ad ...]   (ad verilmezse müşteri ve yönetim panolarının hepsi)
  --metin  verilen panoların görünen metnini de yazar (gözden geçirme için)
Hata varsa çıkış kodu 1."""
import glob, html, os, re, sys
from parts import P

YASAK = [  # değeri sözleşmede olan yer tutucular ve kuralı değişen sözler
    '[PRICE]', '[CREDIT AMOUNT]', '[CREDIT DIFFERENCE]', '[LINK VALIDITY]', '[MIN LENGTH]', '[RESPONSE TIME]',
    '[PRODUCT LIMIT]', '[MORE LANGUAGES]', '[INVOICE RETENTION]', '[LEGAL TEXT]',
    'Estimated credits', 'No credits were spent', 'credit difference', '8 to 15 seconds',
    # ikinci inceleme (R2–R12): sözleşmede değişen cümleler
    'at the same price', 'now 5 credits', 'Nothing was charged. Try again in a few minutes', 'No chart is drawn without data',
    'is refunded to your payment method in a few days', '[CHART:',
]
UYARI = ['[CREDITS]']  # dinamik satırda kalabilir; kural değeri olan yerde kalmamalı: elle bakılır


def text(name):
    s = open(os.path.join(P, name + '.dc.html'), encoding='utf-8').read()
    body = re.search(r'<x-dc>(.*?)</x-dc>', s, re.S).group(1)
    body = re.sub(r'<helmet>.*?</helmet>|<svg.*?</svg>', '', body, flags=re.S)
    script = re.search(r'class Component extends DCLogic.*', s, re.S)  # liste satırlarının metni betikte durur
    raw = re.sub(r'<[^>]+>', '\n', body) + '\n' + (script.group(0) if script else '')
    return [html.unescape(l.strip()) for l in raw.split('\n') if l.strip()]


def main(argv):
    show = '--metin' in argv
    names = [a for a in argv if not a.startswith('--')]
    if not names:
        names = sorted(os.path.basename(p)[:-8] for p in glob.glob(os.path.join(P, '*.dc.html'))
                       if os.path.basename(p).startswith(('A-', 'E-', 'Main')))
    errs = warns = 0
    for n in names:
        lines = text(n)
        joined = '\n'.join(lines)
        bad = [y for y in YASAK if y.lower() in joined.lower()]
        warn = [u for u in UYARI if u in joined]
        if bad:
            errs += 1
            print(f'{n}: KALMIŞ → {", ".join(bad)}')
        if warn:
            warns += 1
            print(f'{n}: bak → {", ".join(warn)}')
        if show:
            print(f'===== {n}\n' + ' | '.join(l for l in lines if len(l) < 400))
    print(f'{len(names)} pano, {errs} hatalı, {warns} bakılacak')
    return 1 if errs else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
