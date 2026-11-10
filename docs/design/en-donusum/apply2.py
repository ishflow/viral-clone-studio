#!/usr/bin/env python3
"""Ekran çevirisi: metni bağlamına göre değiştirir (tam metin düğümü, tam öznitelik değeri, tam JS dizgisi).
Kullanım: python3 apply2.py <kaynak-project> <hedef-project> <çiftler.txt>
Biçim: '@@ *' ortak bölüm (her dosyaya, bulunamazsa sorun değil), '@@ <dosya>' dosyaya özel (bulunamazsa hata).
Bloklar '----' ile ayrılır: 'eski\\n==>\\nyeni'. 'eski' başında T: (metin), A: (öznitelik), J: (JS dizgisi), R: (ham) olabilir;
öneksiz çift T, A ve J'nin hepsine uygulanır."""
import re, sys

src, dst, spec = sys.argv[1:4]
TR = re.compile('[çğıöşüÇĞİÖŞÜ]')
ALLOW = ('Türkçe',)


def parse(rest):
    out = []
    for pair in rest.strip('\n').split('\n----\n'):
        old, sep, new = pair.partition('\n==>\n')
        assert sep, f'ayraç yok: {pair[:60]}'
        kind = ''
        if len(old) > 2 and old[1] == ':' and old[0] in 'TAJR':
            kind, old = old[0], old[2:]
        out.append((kind, old, new))
    return out


def apply(s, kind, old, new):
    n = 0
    e = re.escape(old)
    if kind == 'R':
        return s.replace(old, new), s.count(old)
    if kind in ('', 'T'):
        s, k = re.subn(r'(>\s*)' + e + r'(\s*<)', lambda m: m.group(1) + new + m.group(2), s)
        n += k
    if kind in ('', 'A'):
        s, k = re.subn(r'="' + e + r'"', lambda m: '="' + new.replace('"', '&quot;') + '"', s)
        n += k
    if kind in ('', 'J'):
        s, k = re.subn(r"'" + e + r"'", lambda m: "'" + new.replace("'", "\\'") + "'", s)
        n += k
    return s, n


def numbers(s):
    """JS dizgilerinde ve metinde Türkçe sayı/birim yazımını İngilizceye çevirir."""
    s = re.sub(r"'(\d+),(\d) Mn'", r"'\1.\2M'", s)
    s = re.sub(r"'(\d+) sn'", r"'\1 sec'", s)
    s = re.sub(r"'(\d),(\d)–(\d),(\d) sn'", r"'\1.\2–\3.\4 sec'", s)
    return s


blocks = re.split(r'^@@ ', open(spec, encoding='utf-8').read(), flags=re.M)[1:]
common = []
files = []
for block in blocks:
    name, _, rest = block.partition('\n')
    if name.strip() == '*':
        common = parse(rest)
    else:
        files.append((name.strip(), parse(rest)))

for name, pairs in files:
    s = open(f'{src}/{name}', encoding='utf-8').read()
    missing = []
    for kind, old, new in pairs:
        s, n = apply(s, kind, old, new)
        if not n:
            missing.append(f'{kind}:{old[:90]}')
    for kind, old, new in common:
        s, _ = apply(s, kind, old, new)
    s = numbers(s).replace('<html lang="tr">', '<html lang="en">')
    open(f'{dst}/{name}', 'w', encoding='utf-8').write(s)
    left = [f'  {n}: {line.strip()[:170]}' for n, line in enumerate(s.split('\n'), 1)
            if TR.search(line) and not any(a in line for a in ALLOW)]
    print(f'{name}: ' + ('temiz' if not (left or missing) else ''))
    if missing:
        print('  BULUNAMADI:\n   ' + '\n   '.join(missing))
    if left:
        print(f'  {len(left)} satırda Türkçe harf\n' + '\n'.join(left))
