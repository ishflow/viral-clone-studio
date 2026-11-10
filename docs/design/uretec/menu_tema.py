"""Eski 15 ekranı satış hâline çevirir; dosyaları yerinde okur ve yazar.
A) müşteri ekranlarında üst menü → parts.header_in  B) yönetim kalıntıları çıkar  C) tema tweak'i  D) light düzeltmeleri.
Yeniden çalıştırılabilir: her adım önce dönüşmüş hâli arar, bulursa dokunmaz; ne eski ne yeni hâl varsa durur."""
import subprocess
from parts import *

THEME_PROP = '"theme":{"editor":"enum","options":["dark","light"],"default":"dark"},'
THEME_VAL = "theme: this.props.theme ?? 'dark'"

MENU = {  # A) eski yönetim menüsü → header_in(current)
    'Main': 'gallery', 'A-Detay': 'gallery', 'A-Form': 'gallery', 'A-Video-Ekle': 'gallery',
    'A-Uretimlerim': 'videos', 'A-Is-Takibi': 'videos', 'A-Is-Durdu': 'videos', 'A-Sonuc': 'videos',
}
VALS = {  # C) renderVals dönüşünün ilk anahtarı (None: boş "return {}")
    'Main': 'cards: [', 'A-Detay': 'shots: [', 'A-Form': 'products: products,', 'A-Onay': None,
    'A-Is-Takibi': 'stages: [', 'A-Is-Durdu': 'stages: [', 'A-Sonuc': None, 'A-Uretimlerim': 'jobs: [',
    'A-Video-Ekle': 'steps: [', 'A-404': None, 'A-Ana-Sayfa': 'strip: [', 'A-Fiyatlar': 'packs: [',
    'A-Giris': 'tabs: tabs,', 'A-Hesap': 'moves: [', 'A-Yasal': 'sections: [',
}
done = []  # bu çalıştırmada gerçekten yapılan adımlar


def sub1(s, old, new, step):
    """old → new; tek eşleşme doğrulanır. old yok ve new varsa zaten dönüşmüştür."""
    assert old not in new, ('kural yeniden çalıştırılamaz', old[:80])
    n = s.count(old)
    if n == 0:
        assert new in s, ('ne eski ne yeni hâl var', step, old[:80])
        return s
    assert n == 1, (n, step, old[:80])
    done.append(step)
    return s.replace(old, new)


def cut(s, pattern, key, step):
    """pattern'e uyan tek parçayı çıkarır. key (parçanın ayırt edici metni) hiç yoksa zaten çıkarılmıştır."""
    hits = [m.group(0) for m in re.finditer(pattern, s, re.S)]
    if not hits:
        assert key not in s, ('kalıp tutmadı ama metin duruyor', step, key)
        return s
    assert len(hits) == 1 and key in hits[0], (len(hits), step)
    done.append(step)
    return s.replace(hits[0], '')


def menu(s, current):
    new = header_in(current)
    if new in s:
        return s
    heads = re.findall(r'<header.*?</header>', s, re.S)
    assert len(heads) == 1 and all(w in heads[0] for w in ('Inbox', 'Account: ACME / ACME2', 'Settings')), 'beklenen eski menü yok'
    done.append('A menü')
    return s.replace(heads[0], new)


def theme(s, name):
    s = sub1(s, '<div class="ay" style="', '<div class="ay" data-theme="{{ theme }}" style="', 'C kök')
    s = sub1(s, "data-props='{\"$preview\"", "data-props='{" + THEME_PROP + "\"$preview\"", 'C props')
    key = VALS[name]
    if key is None:
        return sub1(s, 'renderVals() {\nreturn {};\n}', 'renderVals() {\nreturn { ' + THEME_VAL + ' };\n}', 'C vals')
    return sub1(s, 'return {\n' + key, 'return {\n' + THEME_VAL + ',\n' + key, 'C vals')


ROW = ('<div style="display: flex; flex-wrap: wrap; gap: 4px 16px; padding: 12px 0; border-top: 1px solid var(--line); %sfont-size: 15px">'
       '<dt style="flex: 0 0 110px; color: var(--text-3)">%s</dt><dd style="margin: 0; flex: 1 1 240px">%s</dd></div>')
LAST = 'border-bottom: 1px solid var(--line); '


def leftovers(s, name):
    """B) müşterinin görmemesi gereken yönetim parçaları."""
    if name == 'A-Onay':  # hangi hesabın anahtarıyla üretileceğini söyleyen kutu
        s = cut(s, r'<p style="[^"]*">Active account: .*?</p>\n\n', 'Active account', 'B hesap kutusu')
    if name == 'A-Sonuc':  # "Account" satırı (alt çizgi bir önceki satıra geçer) ve örnek yapma düğmesi
        s = sub1(s, ROW % ('', 'Quality', 'Fast · Seedance 2 Mini') + '\n' + ROW % (LAST, 'Account', 'ACME / ACME2'),
                 ROW % (LAST, 'Quality', 'Fast · Seedance 2 Mini'), 'B hesap satırı')
        s = cut(s, r'\n\n<div style="[^"]*">\n<button type="button"[^>]*>Make this video the template\'s sample</button>\n<span[^>]*>[^<]*</span>\n</div>',
                "template's sample", 'B örnek düğmesi')
    return s


def light(s, name):
    """D) light'ta bozulan yerler. Dark'ta eski ve yeni belirteç aynı renge çıkar; dark görünüş değişmez."""
    if name == 'A-Detay':  # video üstündeki ilerleme çizgisi: light'ta koyu yeşile dönüyordu, video üstünde lime kalır
        seg = '<span style="flex: 13; height: 4px; border-radius: 2px; background: var(--%s)"></span>'
        s = sub1(s, seg % 'accent-text', seg % 'accent', 'D video üstü çizgi')
    if name == 'A-Ana-Sayfa':  # lime paneldeki düğme: light'ta açık zemin lime üstünde kayboluyordu
        btn = 'border-radius: 16px; background: var(--%s); color: var(--%s); font-weight: 600; font-size: 17px; text-decoration: none">Get started</a>'
        s = sub1(s, btn % ('bg', 'text'), btn % ('on-accent', 'on-scrim'), 'D lime panel düğmesi')
    return s


def check(s, name, before):
    """Kök stili ve $preview değişmedi; data-props geçerli JSON; renderVals node'da çalışıyor ve temayı veriyor."""
    root = lambda t: re.search(r'<div class="ay"[^>]*? style="([^"]*)"', t).group(1)
    props = lambda t: json.loads(re.search(r"data-props='([^']*)'", t).group(1))
    assert root(s) == root(before), 'kök stili değişti'
    p = props(s)
    assert list(p)[0] == 'theme' and p['$preview'] == props(before)['$preview'], 'props'
    assert s.count('data-theme="{{ theme }}"') == 1
    script = re.search(r"<script type=\"text/x-dc\"[^>]*>(.*?)</script>", s, re.S).group(1)
    js = ('class DCLogic{constructor(p){this.props=p;this.state={}}}\n' + script +
          "\nconsole.log(['dark','light'].map(function(t){return new Component({theme:t}).renderVals().theme})"
          ".concat(new Component({}).renderVals().theme).join())")
    out = subprocess.run(['node', '-e', js], capture_output=True, text=True)
    assert out.stdout.strip() == 'dark,light,dark', (name, out.stdout, out.stderr[-400:])


for name in VALS:
    path = os.path.join(P, name + '.dc.html')
    before = open(path, encoding='utf-8').read()
    done.clear()
    s = before
    if name in MENU:
        s = menu(s, MENU[name])
    s = leftovers(s, name)
    s = theme(s, name)
    s = light(s, name)
    check(s, name, before)
    if s != before:
        open(path, 'w', encoding='utf-8').write(s)
    print(f'{name}: ' + (', '.join(done) if done else 'zaten dönüşmüş, dokunulmadı'))
