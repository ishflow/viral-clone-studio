#!/usr/bin/env python3
"""Bir .dc.html panosunu tuval olmadan, yerelde çizip PNG'ye çevirir (göz kontrolü için).
Kullanım: python3 preview_dc.py <cikti-klasoru> <pano.dc.html> [...]
renderVals() node ile çalıştırılır; {{ }} ve <sc-for> ona göre açılır. Her pano için içeriğin
gerçek yüksekliği de yazılır (kök min-height / $preview.height / canvas.json h bununla eşitlenir).
DC_BLOBS=<klasör> verilirse /_blob/<id> görselleri o klasördeki <id>.* dosyasından yüklenir.
DC_THEME=light verilirse theme tweak'i light çizilir.
Sınır: <dc-import> ve olaylar (tıklama, yazma) çalışmaz; ekran ilk haliyle çizilir."""
import fcntl, glob, html as htmllib, json, os, re, subprocess, sys, tempfile, time
from concurrent.futures import ThreadPoolExecutor

CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
MEASURE = ("<script>addEventListener('load',()=>document.fonts.ready.then(()=>{"
           "const r=document.body.firstElementChild,m=r.style.minHeight,h=r.style.height;"
           "r.style.minHeight='0';r.style.height='auto';"
           "document.body.dataset.h=Math.ceil(r.getBoundingClientRect().height);"
           "document.body.dataset.w=document.documentElement.scrollWidth;"
           "r.style.minHeight=m;r.style.height=h;"
           "if(parent!==window)parent.postMessage({h:document.body.dataset.h,w:document.body.dataset.w},'*')}))</script>")
NARROW = 500  # başsız Chrome penceresi bundan dar olamıyor: daha dar pano (telefon) bir iframe içinde çizilir, PNG kırpılır
WRAP = ('<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#777">'
        '<iframe src="{src}" style="border:0;display:block;width:{w}px;height:{h}px"></iframe>'
        "<script>addEventListener('message',e=>{{document.body.dataset.h=e.data.h;document.body.dataset.w=e.data.w}})</script></body></html>")


def render_vals(script, props):
    """Panonun Component.renderVals() çıktısını node ile alır."""
    defaults = {k: v.get('default') for k, v in props.items() if not k.startswith('$') and isinstance(v, dict)}
    if os.environ.get('DC_THEME') and 'theme' in defaults:
        defaults['theme'] = os.environ['DC_THEME']
    js = ('class DCLogic{constructor(p){this.props=p;this.state={}}}\n' + script +
          '\nconsole.log(JSON.stringify(new Component(' + json.dumps(defaults) + ').renderVals()))')
    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False) as f:
        f.write(js)
    try:
        return json.loads(subprocess.run(['node', f.name], capture_output=True, text=True, check=True).stdout)
    finally:
        os.unlink(f.name)


def lookup(scope, path):
    v = scope
    for part in path.split('.'):
        if not isinstance(v, dict) or part not in v:
            return None
        v = v[part]
    return v


def fill(tpl, scope):
    """<sc-if> dallarını seçer, {{ a.b }} deliklerini scope'tan doldurur; bulunamayan delik olduğu gibi kalır."""
    tpl = re.sub(r'<sc-if value="\{\{\s*([\w.]+)\s*\}\}"[^>]*>(.*?)</sc-if>',
                 lambda m: m.group(2) if lookup(scope, m.group(1)) else '', tpl, flags=re.S)
    def hole(m):
        v = lookup(scope, m.group(1))
        return m.group(0) if v is None else htmllib.escape(str(v), quote=True)
    return re.sub(r'\{\{\s*([\w.]+)\s*\}\}', hole, tpl)


def expand(body, vals):
    def loop(m):
        items = vals.get(m.group(1), [])
        return ''.join(fill(m.group(3), {**vals, m.group(2): it}) for it in items)
    body = re.sub(r'<sc-for list="\{\{\s*(\w+)\s*\}\}" as="(\w+)"[^>]*>(.*?)</sc-for>', loop, body, flags=re.S)
    return fill(body, vals)


def blobs(body):
    d = os.environ.get('DC_BLOBS')
    if not d:
        return body
    def local(m):
        hit = glob.glob(os.path.join(d, m.group(1) + '.*'))
        return 'file://' + os.path.abspath(hit[0]) if hit else m.group(0)
    return re.sub(r'/_blob/([0-9a-f]{32})', local, body)


SLOTS = 6  # aynı anda en çok bu kadar Chrome (bütün önizleme süreçleri arasında); fazlası sıraya girer


def chrome(*args):
    """Ayrı profil (--user-data-dir) verme: başsız Chrome yeni profilde takılıyor. Takılırsa 90 sn sonra bir kez yeniden dener."""
    cmd = [CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files',
           '--virtual-time-budget=6000', *args]
    while True:
        for i in range(SLOTS):
            lock = open(os.path.join(tempfile.gettempdir(), f'dc-preview-{i}.lock'), 'w')
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError:
                lock.close()
                continue
            try:
                for attempt in (1, 2):
                    try:
                        return subprocess.run(cmd, capture_output=True, text=True, timeout=90).stdout
                    except subprocess.TimeoutExpired:
                        if attempt == 2:
                            raise
            finally:
                lock.close()
        time.sleep(0.3)


def draw(path):
    s = open(path, encoding='utf-8').read()
    body = s.split('<x-dc>')[1].split('</x-dc>')[0]
    helmet = re.search(r'<helmet>(.*?)</helmet>', body, flags=re.S)
    head = helmet.group(1) if helmet else ''
    body = re.sub(r'<helmet>.*?</helmet>', '', body, flags=re.S)
    m = re.search(r"<script type=\"text/x-dc\" data-dc-script data-props='([^']*)'>(.*?)</script>", s, flags=re.S)
    props = json.loads(m.group(1))
    body = blobs(expand(body, render_vals(m.group(2), props)))
    size = props['$preview']
    stem = os.path.basename(path).replace('.dc.html', '')
    page = os.path.join(out, stem + '.html')
    open(page, 'w', encoding='utf-8').write(
        f'<!doctype html><html><head><meta charset="utf-8">{head}</head><body>{body}{MEASURE}</body></html>')
    url = 'file://' + os.path.abspath(page)
    png = os.path.join(out, stem + '.png')
    if size['width'] < NARROW:
        wrap = os.path.join(out, stem + '.wrap.html')
        def frame(h):
            open(wrap, 'w', encoding='utf-8').write(WRAP.format(src=stem + '.html', w=size['width'], h=h))
            return 'file://' + os.path.abspath(wrap)
        dom = chrome(f'--window-size={NARROW},{size["height"]}', '--dump-dom', frame(size['height']))
        natural = re.search(r'data-h="(\d+)"', dom)
        natural = int(natural.group(1)) if natural else size['height']
        wide = re.search(r'data-w="(\d+)"', dom)
        tall = max(natural, size['height'])
        chrome(f'--window-size={NARROW},{tall}', f'--screenshot={png}', frame(tall))
        from PIL import Image
        im = Image.open(png)
        im.crop((0, 0, round(size['width'] * im.width / NARROW), im.height)).save(png)
    else:
        dom = chrome(f'--window-size={size["width"]},{size["height"]}', '--dump-dom', url)
        natural = re.search(r'data-h="(\d+)"', dom)
        natural = int(natural.group(1)) if natural else size['height']
        wide = re.search(r'data-w="(\d+)"', dom)
        chrome(f'--window-size={size["width"]},{max(natural, size["height"])}', f'--screenshot={png}', url)
    wide = int(wide.group(1)) if wide else size['width']
    over = f'  YATAY-TASMA={wide - size["width"]}' if wide > size['width'] else ''  # sayfanın kendisi yana kayıyorsa
    return f'{png}  pano={size["height"]}  icerik={natural}  fark={size["height"] - natural:+d}{over}'


out = sys.argv[1]
os.makedirs(out, exist_ok=True)
with ThreadPoolExecutor(4) as pool:  # panolar yan yana çizilir, çıktı verilen sırayla yazılır
    for line in pool.map(draw, sys.argv[2:]):
        print(line, flush=True)
