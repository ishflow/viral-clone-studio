"""Kaynak panoların yüksekliğini içeriğe eşitler: kök min-height ve $preview.height birlikte değişir (canvas.json'a dokunmaz;
yerleşimi layout.py dosyadaki $preview'dan okur). Kullanım: python3 boy.py A-Hesap A-Form ...
Sayfalar (kökte min-height ≥ 900 ya da 100vh) en az 900 kalır. Kökü sabit `height:` olan pencere panoları atlanır: elle ayarlanır."""
import json, math, os, re, subprocess, sys
from parts import P

HERE = os.path.dirname(os.path.abspath(__file__))
PV = os.path.join(P, '..', 'pv-boy')
names = sys.argv[1:]
todo = []
for n in names:
    s = open(os.path.join(P, n + '.dc.html'), encoding='utf-8').read()
    root = re.search(r'<div class="ay"[^>]*>', s).group(0)
    if re.search(r'(?<![-\w])height: \d+px', root):
        print(f'{n}: kök sabit yükseklikte, atlandı')
        continue
    todo.append(n)
out = subprocess.run(['python3', os.path.join(HERE, '..', 'preview_dc.py'), PV, *[os.path.join(P, n + '.dc.html') for n in todo]],
                     capture_output=True, text=True, check=True, env={**os.environ, 'DC_BLOBS': os.path.join(P, '..')}).stdout
heights = [int(v) for v in re.findall(r'icerik=(\d+)', out)]
assert len(heights) == len(todo), out
for n, natural in zip(todo, heights):
    path = os.path.join(P, n + '.dc.html')
    s = open(path, encoding='utf-8').read()
    root = re.search(r'<div class="ay"[^>]*>', s).group(0)
    old = json.loads(re.search(r"data-props='([^']*)'", s).group(1))['$preview']['height']
    mh = re.search(r'min-height: (\d+)px', root)
    page = 'min-height: 100vh' in root or (mh and int(mh.group(1)) >= 900)
    target = max(math.ceil(natural / 20) * 20, 900 if page else 0)
    if mh:
        s = s.replace(root, root.replace(f'min-height: {mh.group(1)}px', f'min-height: {target}px'), 1)
    s, k = re.subn(r'("\$preview":\{"width":\d+,"height":)\d+\}', rf'\g<1>{target}}}', s, count=1)
    assert k == 1, n
    open(path, 'w', encoding='utf-8').write(s)
    print(f'{n}: {old} -> {target} (içerik {natural})')
