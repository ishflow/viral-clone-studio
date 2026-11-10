"""Dar ekran taraması: mobil panoları 320 ve 360 px genişlikte çizer, yana taşmayı ölçer.
Kullanım: python3 dar.py [pano ...]     (ad verilmezse bütün -M panolar ve -M kopyası olmayan -ML panolar: e-postalar)
Pano başına her genişlik için `scrollWidth - genişlik` ve taşan ilk beş öğe yazılır: etiket, ilk 40 karakter metin,
sağ kenar px, panodaki y. Öğe = kendi kabından dışarı çıkan en içteki öğe; yana kayan kutuların (overflow-x) içi sayılmaz.
PNG'ler tuval/pv-dar altına: <pano>-320.png, <pano>-360.png, <pano>.png (ikisi yan yana). Taşma varsa çıkış kodu 1.
Üst üste binen ya da kırpılan öğeleri ölçüm yakalamaz: PNG'ye bak."""
import glob, html, json, os, re, sys
from concurrent.futures import ThreadPoolExecutor
from PIL import Image
from parts import P

OUT = os.path.join(P, '..', 'pv-dar')
WIDTHS = (320, 360)
GAP = 20  # yan yana iki çerçevenin arası
os.environ.setdefault('DC_BLOBS', os.path.join(P, '..'))

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
_argv, sys.argv = sys.argv, ['preview_dc.py', OUT]  # preview_dc içe aktarılırken kendi döngüsünü çalıştırır: boş pano listesiyle
import preview_dc as pv
sys.argv = _argv

MEASURE = """<script>addEventListener('load', () => document.fonts.ready.then(() => {
const W = innerWidth, root = document.body.firstElementChild, mh = root.style.minHeight, hh = root.style.height;
root.style.minHeight = '0'; root.style.height = 'auto';
const h = Math.ceil(root.getBoundingClientRect().height);
root.style.minHeight = mh; root.style.height = hh;
const open = el => getComputedStyle(el).overflowX === 'visible';
const free = el => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) if (!open(p)) return false; return true; };
const edge = el => {  // kutunun ve (kırpılmıyorsa) içindeki yazının sağ kenarı
  let r = el.getBoundingClientRect().right;
  if (open(el)) for (const n of el.childNodes) if (n.nodeType === 3 && n.data.trim()) {
    const g = document.createRange(); g.selectNodeContents(n); r = Math.max(r, g.getBoundingClientRect().right);
  }
  return r;
};
const out = new Map();
for (const el of [root, ...root.querySelectorAll('*')]) {
  if (el.ownerSVGElement || !free(el)) continue;
  const r = edge(el);
  if (r > W + 0.5) out.set(el, r);
}
const leaf = [...out.keys()].filter(el => ![...el.children].some(c => out.has(c)));
leaf.sort((a, b) => out.get(b) - out.get(a));
const over = leaf.slice(0, 5).map(el => ({
  tag: el.tagName.toLowerCase(),
  text: ((el.tagName === 'SELECT' ? el.selectedOptions[0].text : el.textContent.trim()) || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('alt') || '').replace(/\\s+/g, ' ').slice(0, 40),
  right: Math.round(out.get(el)), y: Math.round(el.getBoundingClientRect().top + scrollY)}));
parent.postMessage({w: W, h, sw: document.documentElement.scrollWidth, n: leaf.length, over}, '*');
}))</script>"""
WRAP = ('<!doctype html><html><head><meta charset="utf-8"></head>'
        '<body style="margin:0;background:#777;display:flex;align-items:flex-start;gap:%dpx">FRAMES'
        "<script>addEventListener('message', e => { document.body.dataset['w' + e.data.w] = JSON.stringify(e.data) })</script>"
        '</body></html>') % GAP


def page(name):
    """Panoyu önizlemedeki gibi düz HTML'e açar (preview_dc.draw ile aynı adımlar), sonuna ölçüm betiğini koyar."""
    s = open(os.path.join(P, name + '.dc.html'), encoding='utf-8').read()
    body = s.split('<x-dc>')[1].split('</x-dc>')[0]
    helmet = re.search(r'<helmet>(.*?)</helmet>', body, flags=re.S)
    body = re.sub(r'<helmet>.*?</helmet>', '', body, flags=re.S)
    m = re.search(r"<script type=\"text/x-dc\" data-dc-script data-props='([^']*)'>(.*?)</script>", s, flags=re.S)
    props = json.loads(m.group(1))
    body = pv.blobs(pv.expand(body, pv.render_vals(m.group(2), props)))
    open(os.path.join(OUT, name + '.html'), 'w', encoding='utf-8').write(
        f'<!doctype html><html><head><meta charset="utf-8">{helmet.group(1) if helmet else ""}</head><body>{body}{MEASURE}</body></html>')
    return props['$preview']['height']


def frames(name, heights):
    """Panoyu her genişlikte bir iframe içinde yan yana gösteren sayfa; her iframe ölçümünü bu sayfaya bildirir."""
    tags = ''.join(f'<iframe src="{name}.html" style="border:0;flex:0 0 auto;width:{w}px;height:{h}px"></iframe>'
                   for w, h in zip(WIDTHS, heights))
    path = os.path.join(OUT, name + '.wrap.html')
    open(path, 'w', encoding='utf-8').write(WRAP.replace('FRAMES', tags))
    return 'file://' + os.path.abspath(path)


def scan(name):
    board_h = page(name)
    win = sum(WIDTHS) + GAP * (len(WIDTHS) - 1)
    for _ in (1, 2):  # ölçüm gelmediyse (yazı tipi geç yüklendi) bir kez yeniden dene
        dom = pv.chrome(f'--window-size={win},{board_h}', '--dump-dom', frames(name, [board_h] * len(WIDTHS)))
        got = {w: re.search(rf'data-w{w}="([^"]*)"', dom) for w in WIDTHS}
        if all(got.values()):
            break
    else:
        return name, None
    res = {w: json.loads(html.unescape(m.group(1))) for w, m in got.items()}
    heights = [max(res[w]['h'], board_h) for w in WIDTHS]
    png = os.path.join(OUT, name + '.png')
    pv.chrome(f'--window-size={win},{max(heights)}', f'--screenshot={png}', frames(name, heights))
    im = Image.open(png)
    k, x = im.width / win, 0
    for w, h in zip(WIDTHS, heights):
        im.crop((round(x * k), 0, round((x + w) * k), min(round(h * k), im.height))).save(os.path.join(OUT, f'{name}-{w}.png'))
        x += w + GAP
    return name, res


def main(names):
    if not names:
        stems = sorted(os.path.basename(p)[:-8] for p in glob.glob(os.path.join(P, '*.dc.html')))
        names = [n for n in stems if n.endswith('-M') or (n.endswith('-ML') and n[:-1] not in stems)]
    names = [os.path.basename(n).replace('.dc.html', '') for n in names]
    os.makedirs(OUT, exist_ok=True)
    bad = dict.fromkeys(WIDTHS, 0)
    with ThreadPoolExecutor(4) as pool:  # panolar yan yana çizilir, çıktı verilen sırayla yazılır
        for name, res in pool.map(scan, names):
            if res is None:
                print(f'{name}  ÖLÇÜLEMEDİ', flush=True)
                bad = {w: n + 1 for w, n in bad.items()}
                continue
            print(name + ''.join(f'  {w}: {res[w]["sw"] - w:+d}' if res[w]['sw'] > w else f'  {w}: 0' for w in WIDTHS)
                  + '  icerik: ' + ' / '.join(str(res[w]['h']) for w in WIDTHS), flush=True)
            for w in WIDTHS:
                if res[w]['sw'] <= w:
                    continue
                bad[w] += 1
                for o in res[w]['over']:
                    print(f'    {w}  <{o["tag"]}>  "{o["text"]}"  sag={o["right"]}  y={o["y"]}', flush=True)
                if res[w]['n'] > len(res[w]['over']):
                    print(f'    {w}  … {res[w]["n"] - len(res[w]["over"])} öğe daha', flush=True)
    print(f'{len(names)} pano · ' + ' · '.join(f"{w} px'te taşan: {n}" for w, n in bad.items()) + f' · PNG: {os.path.abspath(OUT)}')
    return 1 if any(bad.values()) else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
