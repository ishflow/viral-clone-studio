#!/usr/bin/env python3
"""Çeviri çiftlerini panolara uygular: her panoyu <kaynak>'tan okur, <hedef>'e yazar (yeniden çalıştırılabilir).
Kullanım: python3 apply.py <kaynak-project> <hedef-project> <çiftler.txt> [...]
Dosya biçimi: '@@ <dosya>' başlığı, altında '----' ile ayrılmış 'eski\\n==>\\nyeni' blokları.
Her 'eski' en az bir kez geçmeli; geçmiyorsa o pano yazılmaz. Sonunda kalan Türkçe harfli satırları yazar."""
import re, sys

src, dst = sys.argv[1], sys.argv[2]
TR = re.compile('[çğıöşüÇĞİÖŞÜ]')
for spec in sys.argv[3:]:
    for block in re.split(r'^@@ ', open(spec, encoding='utf-8').read(), flags=re.M)[1:]:
        name, _, rest = block.partition('\n')
        name = name.strip()
        s = open(f'{src}/{name}', encoding='utf-8').read()
        missing = []
        for pair in rest.strip('\n').split('\n----\n'):
            old, sep, new = pair.partition('\n==>\n')
            if not sep or old not in s:
                missing.append(old[:100])
                continue
            s = s.replace(old, new)
        if missing:
            print(f'{name}: YAZILMADI, bulunamayan:\n  ' + '\n  '.join(missing))
            continue
        s = s.replace('<html lang="tr">', '<html lang="en">')
        open(f'{dst}/{name}', 'w', encoding='utf-8').write(s)
        left = [f'  {n}: {line.strip()[:160]}' for n, line in enumerate(s.split('\n'), 1) if TR.search(line)]
        print(f'{name}: ' + ('temiz' if not left else f'{len(left)} satırda Türkçe harf\n' + '\n'.join(left)))
