"""Belirteç ekler: --media-edge (fotoğraf / video karesinin kenarı; dark'ta görünmez, light'ta ince koyu çizgi).
Bütün marka ve website panolarının helmet'ine yazar; ikinci çalıştırmada dokunmaz. Kullanım: python3 helmet_media.py"""
import glob, os
from parts import P

DARK, LIGHT = '--on-scrim:#F2F3EC;', '--mark-edge:#0B0C0A}'
n = 0
for path in sorted(glob.glob(os.path.join(P, '*.dc.html'))):
    name = os.path.basename(path)
    if name.startswith(('Logo-', 'B-', 'C-', 'D-')):
        continue
    s = open(path, encoding='utf-8').read()
    if '--media-edge' in s:
        continue
    assert s.count(DARK) == 1 and s.count(LIGHT) == 1, name
    s = s.replace(DARK, DARK + '--media-edge:transparent;').replace(LIGHT, '--mark-edge:#0B0C0A;--media-edge:rgba(11,12,10,0.12)}')
    open(path, 'w', encoding='utf-8').write(s)
    n += 1
print(n, 'pano güncellendi')
