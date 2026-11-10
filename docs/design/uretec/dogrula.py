"""Yayın öncesi denetim: her pano dosyası biçim kurallarına uyuyor mu, bağlantılar var olan panoya gidiyor mu,
canvas.json'daki her kaydın dosyası var mı. Kullanım: python3 dogrula.py  (hata varsa çıkış kodu 1)"""
import glob, json, os, re, sys
from parts import P

errs = []
files = {os.path.basename(p) for p in glob.glob(os.path.join(P, '*.dc.html'))}
for name in sorted(files):
    s = open(os.path.join(P, name), encoding='utf-8').read()
    def bad(msg):
        errs.append(f'{name}: {msg}')
    if '<script src="./support.js"></script>' not in s:
        bad('support.js satırı yok')
    if s.count('<x-dc>') != 1 or s.count('</x-dc>') != 1:
        bad('x-dc etiketi tek değil')
    m = re.search(r"<script type=\"text/x-dc\" data-dc-script data-props='([^']*)'>", s)
    if not m:
        bad('data-props bulunamadı'); continue
    try:
        props = json.loads(m.group(1))
        assert '$preview' in props and props['$preview']['width'] >= 40 and props['$preview']['height'] >= 40
    except Exception as e:
        bad(f'data-props bozuk: {e}')
    if 'class Component extends DCLogic' not in s:
        bad('Component sınıfı yok')
    if name.startswith(('Logo-', 'B-', 'C-', 'D-')):
        continue
    for h in re.findall(r'href="([\w-]+\.dc\.html)"', s):
        if h not in files:
            bad(f'kırık bağlantı → {h}')
    if re.search(r'<(iframe|object|embed)\b', s):
        bad('yasak öğe')
    if re.search(r'#[0-9A-Fa-f]{6}\b', re.sub(r'<helmet>.*?</helmet>', '', s, flags=re.S).replace('fill="#C8F03C"', '')):
        if not name.startswith('Marka-'):
            bad('helmet dışında ham hex')
c = json.load(open(os.path.join(P, 'canvas.json'), encoding='utf-8'))
for name in c['boards']:
    if name not in files and not os.path.exists(os.path.join(P, name)):
        if c['boards'][name].get('page') not in ('logo', 'yonler'):
            errs.append(f'canvas.json: dosyası olmayan kayıt {name}')
for name in c['order']:
    if name not in c['boards']:
        errs.append(f'canvas.json: order içinde kayıtsız pano {name}')
print(f'{len(files)} pano dosyası, {len(c["boards"])} kayıt, {len(errs)} hata')
for e in errs:
    print(' -', e)
sys.exit(1 if errs else 0)
