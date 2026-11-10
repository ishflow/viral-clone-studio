#!/usr/bin/env python3
"""Pano yüksekliğini içeriğe eşitler: kök min-height, $preview.height ve canvas.json h üçü birlikte değişir.
Kullanım: python3 fit_dc.py <project-klasörü> <pano.dc.html> [...]   (pano adları project klasörüne göre)
İçerik yüksekliğini preview_dc.py ölçer (20'nin katına yuvarlanır); PNG'ler <project>/../pv altına yazılır.
DC_MIN_H=900 verilirse kısa sayfalar en az o yükseklikte kalır (tam ekran görünümü).
Yalnız kökünde min-height olan (sabit genişlikli) panolar içindir."""
import json, math, os, re, subprocess, sys

root = sys.argv[1]
names = sys.argv[2:]
here = os.path.dirname(os.path.abspath(__file__))
pv = os.path.join(root, '..', 'pv')


def measure():
    out = subprocess.run(['python3', os.path.join(here, 'preview_dc.py'), pv, *[os.path.join(root, n) for n in names]],
                         capture_output=True, text=True, check=True).stdout
    return [int(v) for v in re.findall(r'icerik=(\d+)', out)]


canvas_path = os.path.join(root, 'canvas.json')
canvas = json.load(open(canvas_path, encoding='utf-8'))
for name, natural in zip(names, measure()):
    target = max(math.ceil(natural / 20) * 20, int(os.environ.get('DC_MIN_H', 0)))
    path = os.path.join(root, name)
    s = open(path, encoding='utf-8').read()
    old = json.loads(re.search(r"data-props='([^']*)'", s).group(1))['$preview']['height']
    if old != target:
        s, n1 = re.subn(rf'(<div class="ay"[^>]*?min-height: ){old}px', rf'\g<1>{target}px', s, count=1)
        s, n2 = re.subn(rf'("\$preview":\{{"width":\d+,"height":){old}\}}', rf'\g<1>{target}}}', s, count=1)
        assert n1 == n2 == 1, f'{name}: kök min-height ya da $preview bulunamadı'
        open(path, 'w', encoding='utf-8').write(s)
    canvas['boards'][name]['h'] = target
    print(f'{name}: {old} -> {target} (içerik {natural})')
json.dump(canvas, open(canvas_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
measure()  # PNG'leri yeni yükseklikle yeniden çiz
