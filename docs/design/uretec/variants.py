"""Türev panolar: her kaynak panodan (masaüstü, dark) light ve mobil kopyaları üretir.
  <ad>-L   masaüstü light    → sayfa "4 · Website · Light"
  <ad>-M   mobil dark, 390   → sayfa "5 · Mobile · Dark"
  <ad>-ML  mobil light, 390  → sayfa "6 · Mobile · Light"
Türevler ELLE DÜZENLENMEZ: kaynak dosya ya da yama (yama_*.py) değişir, betik yeniden çalışır.

Kullanım: python3 variants.py [ad ...]     (ad verilmezse layout.WEB'deki bütün kaynaklar)
Mobil kopyada: genişlik 390, üst menü telefon menüsüne döner (parts.header_m), sabit genişlik / yükseklik kalkar,
yama_*.py dosyalarındaki YAMA[ad] değişiklikleri uygulanır, yükseklik önizlemeyle ölçülüp yazılır.
Bağlantılar aynı türeve gider (light pano light panoya, mobil pano mobil panoya)."""
import glob, importlib.util, json, math, os, re, subprocess, sys
from parts import P, header_m
from layout import WEB

HERE = os.path.dirname(os.path.abspath(__file__))
PREVIEW = os.path.join(HERE, '..', 'preview_dc.py')
PV = os.path.join(P, '..', 'pv-m')
PHONE_W, PHONE_H = 390, 844
NO_MOBILE = {'A-Dil-Menusu', 'A-Fatura'}  # dil seçimi mobilde menünün içinde; fatura PDF
GENEL = [  # her mobil kopyaya uygulanan kurallar (varsa): video kartı ızgarası telefonda iki sütun
    ('grid-template-columns: repeat(auto-fit, minmax(min(210px, 100%), 1fr))', 'grid-template-columns: repeat(2, minmax(0, 1fr))'),
]
THEME_PROP = '"theme":{"editor":"enum","options":["dark","light"],"default":"dark"}'
THEME_VAL = "this.props.theme ?? 'dark'"


def load_patches():
    """yama_*.py dosyalarındaki YAMA sözlüklerini birleştirir: {ad: [(eski, yeni), ...]} yalnız mobil kopyaya uygulanır."""
    out = {}
    for path in sorted(glob.glob(os.path.join(HERE, 'yama_*.py'))):
        spec = importlib.util.spec_from_file_location(os.path.basename(path)[:-3], path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        for stem, pairs in mod.YAMA.items():
            out.setdefault(stem, []).extend(pairs)
        # DEGISTIR: bir panonun önceki dosyalardan gelen yamalarının yerine geçer (dosyalar ad sırasıyla okunur).
        # Bir ajan başka grubun yama dosyasına dokunmadan kendi panosunun yamasını yenileyebilsin diye.
        for stem, pairs in getattr(mod, 'DEGISTIR', {}).items():
            out[stem] = list(pairs)
    return out


def read(name):
    return open(os.path.join(P, name + '.dc.html'), encoding='utf-8').read()


def save(name, s):
    assert "'" not in re.search(r"data-props='([^']*)'", s).group(1), name
    open(os.path.join(P, name + '.dc.html'), 'w', encoding='utf-8').write(s)


def is_light(s):
    return '"default":"light"' in re.search(r"data-props='([^']*)'", s).group(1)


def to_light(s, name):
    assert s.count(THEME_PROP) == 1 and s.count(THEME_VAL) == 1, f'{name}: tema tweak\'i yok ya da beklenen biçimde değil'
    return s.replace(THEME_PROP, THEME_PROP.replace('"default":"dark"', '"default":"light"')).replace(THEME_VAL, "this.props.theme ?? 'light'")


def relink(s, suffix, targets):
    """href="X.dc.html" → href="X<suffix>.dc.html" (yalnız o türevi olan panolar için)."""
    return re.sub(r'href="([\w-]+)\.dc\.html"',
                  lambda m: f'href="{m.group(1)}{suffix}.dc.html"' if m.group(1) in targets else m.group(0), s)


def retitle(s, tag):
    return re.sub(r'<title>(.*?)</title>', lambda m: f'<title>{m.group(1)} · {tag}</title>', s, count=1)


def header_kind(h):
    if '<span>viral clone</span>' not in h:
        return None  # sayfanın kendi başlığı (ör. karşılaştırma): olduğu gibi kalır
    if 'aria-label="Admin menu"' in h:
        return 'admin'
    if 'Get started' in h:
        return 'out'
    if 'href="A-Hesap.dc.html"' in h:
        return 'in'
    return 'auth'


def to_mobile(s, stem, patches):
    s, n = re.subn(r'"\$preview":\{"width":\d+,', f'"$preview":{{"width":{PHONE_W},', s, count=1)
    assert n == 1, stem
    m = re.search(r'<header.*?</header>', s, re.S)
    if m and header_kind(m.group(0)):
        kind = header_kind(m.group(0))
        bal = re.search(r'<span style="font-size: 13px; color: var\(--text-2\); border: 1px solid var\(--edge\)[^>]*>([^<]*)</span>', m.group(0))
        s = s[:m.start()] + header_m(kind, bal.group(1) if bal else '[BALANCE] credits') + s[m.end():]
    root = re.search(r'<div class="ay"[^>]*>', s)
    r = re.sub(r'(style="[^"]*?)\bwidth: \d+px; ', r'\1', root.group(0), count=1)  # sabit genişlik kalkar
    r = re.sub(r'(style="[^"]*?)(?<![-\w])height: (\d+)px', r'\1min-height: \2px', r, count=1)  # sabit yükseklik ölçülebilir olur
    s = s[:root.start()] + r + s[root.end():]
    for old, new in GENEL:
        s = s.replace(old, new)
    for old, new in patches.get(stem, []):
        assert old in s, f'{stem}: yama eşleşmedi: {old[:90]}'
        s = s.replace(old, new)
    return s


def fit(names, pages):
    """Mobil kopyaların yüksekliğini içeriğe eşitler (sayfalar en az telefon yüksekliğinde)."""
    out = subprocess.run(['python3', PREVIEW, PV, *[os.path.join(P, n + '.dc.html') for n in names]],
                         capture_output=True, text=True, check=True, env={**os.environ, 'DC_BLOBS': os.path.join(P, '..')}).stdout
    heights = [int(v) for v in re.findall(r'icerik=(\d+)', out)]
    assert len(heights) == len(names), out
    res = {}
    for name, natural in zip(names, heights):
        target = math.ceil(natural / 20) * 20
        if name in pages:
            target = max(target, PHONE_H)
        s = read(name)
        s = re.sub(r'(<div class="ay"[^>]*?(?<![-\w])min-height: )\d+px', rf'\g<1>{target}px', s, count=1)
        s, n = re.subn(r'("\$preview":\{"width":\d+,"height":)\d+\}', rf'\g<1>{target}}}', s, count=1)
        assert n == 1, name
        save(name, s)
        res[name] = target
    return res


def main(stems):
    patches = load_patches()
    all_stems = [st for _, _, boards in WEB for st, _ in boards]
    have = lambda st, suf='': os.path.exists(os.path.join(P, st + suf + '.dc.html'))
    stems = stems or all_stems
    src = {st for st in all_stems if have(st)}                       # masaüstü kaynağı olanlar
    only_m = {st for st in all_stems if not have(st) and have(st, '-M')}  # yalnız mobilde var olan panolar (menüler)
    light_src = {st for st in src if is_light(read(st))}             # kaynağı zaten light (e-posta, fatura)
    L = src - light_src
    M = (src - light_src - NO_MOBILE) | only_m
    ML = (src - NO_MOBILE) | only_m
    made, to_fit, pages = [], [], set()
    for st in stems:
        if st in only_m:
            continue
        assert st in src, f'kaynak yok: {st}'
        s = read(st)
        if st in L:
            save(st + '-L', retitle(relink(to_light(s, st), '-L', L), 'light'))
            made.append(st + '-L')
        if st in NO_MOBILE:
            continue
        m = to_mobile(s, st, patches)
        name = st + ('-ML' if st in light_src else '-M')
        save(name, retitle(relink(m, '-ML' if st in light_src else '-M', ML if st in light_src else M), 'mobile'))
        to_fit.append(name)
        if re.search(r'<div class="ay"[^>]*min-height: (9\d\d|[1-9]\d{3,})px|<div class="ay"[^>]*min-height: 100vh', s):
            pages.add(name)
    heights = fit(to_fit, pages) if to_fit else {}
    for st in stems:  # mobil light: ölçülmüş mobil dark'ın light kopyası
        if st in only_m:
            s = read(st + '-M')
            save(st + '-ML', retitle(to_light(s, st + '-M').replace('-M.dc.html"', '-ML.dc.html"'), 'light'))
            made.append(st + '-ML')
        elif st in M:
            s = read(st + '-M')
            save(st + '-ML', retitle(to_light(s, st + '-M').replace('-M.dc.html"', '-ML.dc.html"'), 'light'))
            made += [st + '-M', st + '-ML']
        elif st in ML:
            made.append(st + '-ML')
    for name, h in heights.items():
        print(f'{name}: {PHONE_W}×{h}')
    print(f'{len(made)} türev yazıldı')


if __name__ == '__main__':
    main(sys.argv[1:])
