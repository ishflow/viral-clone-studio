"""R6 Yönetim (inceleme turu 2026-10-04, bulgu 05 / 17 / 18 / 19 / 25): yönetim panolarının düzeltmeleri ve dört yeni pano.
Mevcut panolar dosyadan okunup yerinde düzeltilir (kaynak .dc.html'dir); betik yeniden çalıştırılabilir: ikinci çalıştırma dosyayı değiştirmez.
Yeni panolar: A-Admin-Onaylar, A-Admin-Islem-Durumlar, A-Admin-Grafik-Durumlar (durum panoları) ve A-Sablon-Ornek-Eski (A-Sablon-Duzenle'den türer).
Değerler ve metinler docs/specs/2026-10-04-flow-contract.md §12, §8.1, §6, §2, §1.1'den. Menü, tablo, sekme panel.py'den gelir (panel.py'ye dokunulmaz).
Grafik burada bilerek çizilir (KURALLAR §3'ün chart_slot kuralı bu görevde aşıldı): çubuklar düz kutu, değerler yer tutucu, yükseklikler temsilî."""
from panel import *
import panel

T = TEMPLATES
TITLE = [t['title'] for t in T]
JOB = 'Fragrance layering recipe · Fast · 1 variant · English'  # sözleşme §1.7 örnek işi: 2 kredi
NOTE = 'This action is recorded with your name and the reason.'  # sözleşme §12


# ---------------------------------------------------------------- dosya yardımcıları
def src(name):
    return open(os.path.join(P, name + '.dc.html'), encoding='utf-8').read()


def put(name, s, before):
    assert "'" not in re.search(r"data-props='([^']*)'", s).group(1), name
    if s != before:
        open(os.path.join(P, name + '.dc.html'), 'w', encoding='utf-8').write(s)
    print('düzeltildi:' if s != before else 'zaten güncel:', name, len(s), 'bayt')


def once(s, old, new):
    """Tek seferlik değişiklik: yenisi yazılıysa dokunmaz; eskisi tam bir kez geçmeli."""
    if new in s and old not in s.replace(new, ''):
        return s
    assert s.count(old) == 1, (s.count(old), old[:90])
    return s.replace(old, new)


def swap(s, pattern, new):
    """Düzenli ifadeyle bulunan tek bloğu yenisiyle değiştirir (her çalıştırmada aynı sonuç)."""
    hits = re.findall(pattern, s, re.S)
    assert len(hits) == 1, (len(hits), pattern[:90])
    return re.sub(pattern, lambda m: new, s, count=1, flags=re.S)


def swap_table(s, caption, new):
    return swap(s, r'<div style="position: relative; overflow-x: auto; border-radius: 16px; border: 1px solid var\(--line\); background: var\(--surface\)">\n'
                   r'<table style="[^"]*">\n<caption style="[^"]*">' + re.escape(caption) + r'</caption>.*?</table>\n</div>', new)


def swap_segment(s, label, new):
    return swap(s, r'<div role="group" aria-label="' + label + r'" style="[^"]*">\n(?:<button[^>]*>[^<]*</button>\n)+</div>', new)


def height(name, default=900):
    """Var olan panonun ölçülmüş yüksekliği (boy.py yazar); betik yeniden çalışınca yükseklik korunur."""
    try:
        return json.loads(re.search(r"data-props='([^']*)'", src(name)).group(1))['$preview']['height']
    except OSError:
        return default


# ---------------------------------------------------------------- küçük parçalar (mevcut panolardaki biçimle birebir)
SR = "position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0)"
ACTIONS = f'<span style="{SR}">Actions</span>'
LINK = "display: inline-flex; align-items: center; min-height: 44px; font-size: 15px; font-weight: 500; text-decoration: none; margin: -12px 0"
ENTITY = LINK + "; color: var(--text); text-decoration: underline; text-decoration-color: var(--edge-strong); text-underline-offset: 4px"
NAV_LINK = LINK.replace('margin: -12px 0', 'padding: 0 8px; margin: -12px -8px')  # satır içi gezinme bağlantısı ("Open"): 44 px hedef, satırı yükseltmez
H_SUB = "margin: 0; font-size: 17px; font-weight: 600; line-height: 1.3"
SMALL_BTN = SECONDARY.replace('min-height: 52px', 'min-height: 44px').replace('padding: 0 24px', 'padding: 0 16px')  # pager() düğmesiyle aynı
# Satır eylemi kuralı: gezinme bağlantı ("Open", "Edit"), işlem kenarlı düğme ("Refund", "Retry job"). 44 px, satırı yükseltmez.
ROW_BTN = SMALL_BTN.replace('display: flex', 'display: inline-flex') + "; margin: -12px 0; white-space: nowrap"
WARN_BTN = SECONDARY.replace('border: 1px solid var(--edge-strong)', 'border: 1px solid var(--warn)').replace('color: var(--text)', 'color: var(--warn)')
OFF_BTN = (BTN.replace('cursor: pointer', 'cursor: default') + "; gap: 8px; min-height: 52px; padding: 0 24px; border: 0; background: var(--raised); "
           "color: var(--text-3); font-size: 15px")  # kapalı düğme (A-Iletisim-Durumlar "Sending…" ile aynı)
assert 'var(--warn)' in WARN_BTN and 'inline-flex' in ROW_BTN and 'cursor: default' in OFF_BTN

_MARK = re.compile(r'(<span style="width: 8px; height: 8px;[^>]*></span>)')
_BOX = r'<span style="display: flex; justify-content: center; width: 18px">\1</span>'
_PAD = '<span style="flex: 0 0 18px"></span>'
_OFF = ('<span style="display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 600; color: var(--text-2)">'
        '<span style="width: 8px; height: 8px; box-sizing: border-box; border-radius: 50%; border: 2px solid var(--text-3)"></span>')


def st(kind, label, sub=''):
    """Tablo durumu (row9 / row10 ile aynı): done / stopped / run → parts.status; off → içi boş halka. sub: altındaki ikinci satır."""
    s = f'{_OFF}{label}</span>' if kind == 'off' else status(kind, label)
    s = _MARK.sub(_BOX, s, 1).replace('display: flex;', 'display: flex; white-space: nowrap;', 1)
    if sub:
        s = (f'<div style="display: flex; flex-direction: column; gap: 4px">{s}'
             f'<span style="display: flex; gap: 8px; white-space: nowrap; {SMALL}">{_PAD}{sub}</span></div>')
    return s


def plain(label):
    """Renk taşımayan olumlu durum (uyarı değil, özellik): gri onay + yazı (A-Kullanicilar "Verified" ile aynı)."""
    return f'<span style="display: flex; align-items: center; gap: 8px; white-space: nowrap">{icon("done", 18, "color: var(--text-3)", 2.6)}{label}</span>'


def tbl(caption, heads, rows, min_w=960, num=()):
    """row9 panolarının tablo biçimi (dosyalardaki hâl): panel.table ile aynı, son satırın hücreleri "border-bottom: 0" taşır."""
    out = panel.table(caption, heads, rows, min_w, num)
    head, tr, last = out.rpartition('\n<tr>')
    plain_td = TD.replace('; border-bottom: 1px solid var(--line)', '')
    assert plain_td in last, caption
    return head + tr + last.replace(plain_td, TD.replace('border-bottom: 1px solid var(--line)', 'border-bottom: 0'))


def user():
    return f'<a href="A-Kullanici-Detay.dc.html" style="{ENTITY}">[EMAIL]</a>'


def invoice(has=True):
    if not has:
        return '<span style="color: var(--text-3)">No invoice</span>'
    return ('<span style="display: inline-flex; align-items: center; gap: 12px; white-space: nowrap">[INVOICE NUMBER]'
            f'<a href="A-Fatura.dc.html" style="{ENTITY.replace("margin: -12px 0", "padding: 0 8px; margin: -12px -8px")}">PDF</a></span>')


def change(sign):
    if sign == '+':
        return '<span style="font-weight: 600; color: var(--accent-text)">+[CREDITS]</span>'
    if sign == '-':
        return '<span style="font-weight: 600; color: var(--text)">−[CREDITS]</span>'
    return '<span style="font-weight: 600">0</span>'


def nowrap(text):
    return f'<span style="white-space: nowrap">{text}</span>'


def mark_row(html, n, style):
    i = [0]

    def f(m):
        i[0] += 1
        return f'<tr style="{style}">' if i[0] == n else m.group(0)
    return re.sub(r'<tr>(?=<td)', f, html)


def info(text, kind='info'):
    """Pencere içi not kutusu. info: yansız (A-Is-Durdu-Onay); warn: uyarı (A-Onay-Yetersiz)."""
    if kind == 'warn':
        return (f'<p role="alert" style="margin: 0; display: flex; align-items: flex-start; gap: 12px; padding: 12px 16px; border-radius: 12px; background: var(--bg); '
                f'border: 1px solid var(--warn-edge); font-size: 15px; line-height: 1.5; color: var(--text-2)">{icon("warning", 20, "flex: 0 0 auto; color: var(--warn)")}<span>{text}</span></p>')
    return ('<p style="margin: 0; display: flex; align-items: flex-start; gap: 12px; padding: 12px 16px; border-radius: 12px; background: var(--bg); '
            f'border: 1px solid var(--edge); font-size: 15px; line-height: 1.5; color: var(--text)">{icon("info", 20, "flex: 0 0 auto; color: var(--text-2)")}<span>{text}</span></p>')


# ---------------------------------------------------------------- grafik (bulgu 25)
N = 30  # dönem "30 days": gün başına bir çubuk
REV = [34, 41, 38, 52, 47, 60, 71, 44, 0, 36, 49, 57, 53, 68, 79, 58, 46, 42, 55, 63, 61, 74, 86, 66, 9, 51, 59, 70, 64, 77]   # temsilî yükseklik (%); bir sıfır gün, bir çok küçük gün
COST = [30, 38, 36, 45, 44, 52, 66, 47, 28, 33, 41, 50, 49, 60, 72, 55, 40, 39, 48, 57, 58, 65, 80, 62, 22, 44, 52, 63, 60, 70]
assert len(REV) == len(COST) == N
GAPS = (N - 1) * 4
AX = "font-size: 13px; line-height: 1; color: var(--text-3); white-space: nowrap; font-variant-numeric: tabular-nums"
CH_CARD = ("margin: 0; box-sizing: border-box; padding: clamp(16px, 2vw, 24px); border-radius: 16px; background: var(--surface); "
           "border: 1px solid var(--line); display: flex; flex-direction: column; gap: 16px; min-width: 0")
CH_GRID = "display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: 16px 12px"
DCELL = "padding: 8px 12px"


def bars(values, fill, top, h, align, on=None):
    cols = ''.join(f'<div style="flex: 1 1 0; height: {v}%; background: {"var(--accent-text)" if i == on else fill}"></div>' for i, v in enumerate(values))
    return f'<div style="position: absolute; left: 0; right: 0; top: {top}px; height: {h}px; display: flex; align-items: {align}; gap: 4px">{cols}</div>'


def plot(up=None, down=None, step=60, message=''):
    """Çizim alanı: solda USD ekseni (yer tutucu etiketler), ince çizgiler, gün başına çubuk, altta tarih.
    up: sıfır çizgisinin üstündeki seri (gelir); down: altındaki seri (maliyet), aynı ölçek. message: boş hâl yazısı (çubuk yok)."""
    h_up, h_down = 2 * step, step if down else 0
    H = h_up + h_down
    ticks = [(h_up, '0')] if message else [(0, '[AMOUNT]'), (step, '[AMOUNT]'), (h_up, '0')] + ([(H, '[AMOUNT]')] if down else [])
    axis = ''.join(f'<span style="position: absolute; right: 0; top: {y}px; transform: translateY(-50%); {AX}">{t}</span>' for y, t in ticks)
    grid = ''.join(f'<div style="position: absolute; left: 0; right: 0; top: {y}px; height: 1px; background: var(--{"edge" if y == h_up else "line"})"></div>'
                   for y in range(0, H + 1, step))
    marks = ''
    if up:  # son gün seçili: arkasında şerit, çubuğu vurgulu; değeri kartın başında yazar
        marks = (f'<div style="position: absolute; top: 0; bottom: 0; right: 0; width: calc((100% - {GAPS}px) / {N}); background: var(--raised)"></div>'
                 + bars(up, 'var(--text-2)', 0, h_up, 'flex-end', N - 1)
                 + (bars(down, 'var(--edge-strong)', h_up + 1, h_down - 1, 'flex-start') if down else ''))
    if message:
        marks = (f'<p style="position: absolute; left: 0; right: 0; top: 0; height: {h_up}px; margin: 0; display: flex; align-items: center; justify-content: center; '
                 f'text-align: center; {BODY2}"><span style="padding: 0 12px; background: var(--surface)">{message}</span></p>')
    dates = ''.join('<span>[DATE]</span>' for _ in range(3))
    return (f'<div aria-hidden="true" style="{CH_GRID}">\n'
            f'<span style="{AX}; text-align: right">USD</span><span></span>\n'
            f'<div style="position: relative; height: {H}px">{axis}</div>\n'
            f'<div style="position: relative; height: {H}px">{grid}{marks}</div>\n'
            f'<span></span><div style="display: flex; justify-content: space-between; gap: 8px; {AX}">{dates}</div>\n</div>')


def data_table(caption, rows):
    """Grafiğin altındaki tablo: aynı veri, gün gün (ekran okuyucu ve dar ekran için). Kendi kutusunda yana kayar."""
    th = ''.join(f'<th scope="col" style="{DCELL}; font-weight: 500; text-align: right">[DATE]</th>' for _ in range(N))
    trs = []
    for name in rows:
        tds = ''.join(f'<td style="{DCELL}">[AMOUNT]</td>' for _ in range(N))
        trs.append(f'<tr style="border-top: 1px solid var(--line)"><th scope="row" style="{DCELL}; font-weight: 500; text-align: left; color: var(--text)">{name}</th>{tds}</tr>')
    return ('<div style="position: relative; overflow-x: auto; border-radius: 12px; border: 1px solid var(--line); background: var(--bg)">\n'
            '<table style="border-collapse: collapse; font-size: 15px; line-height: 1.4; color: var(--text-2); text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums">\n'
            f'<caption style="{SR}">{caption}</caption>\n'
            f'<thead><tr style="font-size: 13px; color: var(--text-3)"><th scope="col" style="{DCELL}; font-weight: 500; text-align: left">Date</th>{th}</tr></thead>\n'
            '<tbody>\n' + '\n'.join(trs) + '\n</tbody>\n</table>\n</div>')


def key(color, label, value=''):
    value = f'<span style="font-size: 15px; font-weight: 600; color: var(--text); font-variant-numeric: tabular-nums">{value}</span>' if value else ''
    return ('<span style="display: flex; align-items: center; gap: 8px; white-space: nowrap">'
            f'<span aria-hidden="true" style="flex: 0 0 auto; width: 8px; height: 8px; background: {color}"></span>'
            f'<span style="{SMALL}">{label}</span>{value}</span>')


CH_HEAD = '<div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 24px">'
CH_TITLE = f'<h2 id="h-chart" style="{H_SUB}">Revenue per day</h2>'
PICKED = key('var(--accent-text)', '[DATE]')  # seçili gün (vurgulu çubuk)


def chart_revenue(style='', state='data'):
    """Gelir grafiği kartı (A-Gelir): başlık, seçili günün değeri, çizim, altında aynı verinin tablosu. state: data / empty / error / loading."""
    style = f'{style}; ' if style else ''
    if state == 'data':
        inner = (f'{CH_HEAD}\n{CH_TITLE}\n{key("var(--accent-text)", "[DATE]", "[AMOUNT]")}\n</div>\n'
                 f'{plot(REV)}\n{data_table("Revenue per day", ["Revenue"])}')
        return f'<figure aria-labelledby="h-chart" style="{style}{CH_CARD}">\n{inner}\n</figure>'
    if state == 'empty':
        inner = f'{CH_HEAD}\n{CH_TITLE}\n</div>\n{plot(message="No sales in this period.").replace(" aria-hidden=" + chr(34) + "true" + chr(34), "", 1)}'
        return f'<figure aria-labelledby="h-chart" style="{style}{CH_CARD}">\n{inner}\n</figure>'
    if state == 'error':  # "yüklenemedi" bloğu (A-Galeri-Hata ile aynı yapı), kartın içinde
        inner = (f'{CH_HEAD}\n{CH_TITLE}\n</div>\n'
                 '<div role="alert" style="padding: 24px 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; text-align: center">\n'
                 f'<span aria-hidden="true" style="width: 48px; height: 48px; border-radius: 50%; background: var(--raised); color: var(--warn); display: flex; align-items: center; justify-content: center">{icon("warning", 24)}</span>\n'
                 f'<p style="margin: 0; {H6}">Could not load the chart.</p>\n'
                 f'<button type="button" style="{SECONDARY}; gap: 8px">{icon("retry", 18)}Try again</button>\n</div>')
        return f'<figure aria-labelledby="h-chart" style="{style}{CH_CARD}">\n{inner}\n</figure>'
    # loading: iskelet (A-Galeri-Yukleniyor ile aynı dil: durum satırı + --raised kutular)
    ghost = ''.join(f'<div style="flex: 1 1 0; height: {v or 12}%; background: var(--raised)"></div>' for v in REV)
    pill = '<span style="height: 12px; width: {w}; border-radius: 999px; background: var(--raised)"></span>'
    inner = (f'{CH_HEAD}\n{CH_TITLE}\n'
             f'<p role="status" style="margin: 0; display: flex; align-items: center; gap: 8px; {SMALL}">{icon("generating", 16)}Loading chart</p>\n</div>\n'
             f'<div aria-hidden="true" style="{CH_GRID}">\n<span style="{AX}; text-align: right">USD</span><span></span>\n'
             '<div style="height: 120px; display: flex; flex-direction: column; align-items: flex-end; justify-content: space-between">'
             + pill.format(w='48px') + pill.format(w='48px') + pill.format(w='24px') + '</div>\n'
             f'<div style="height: 120px; display: flex; align-items: flex-end; gap: 4px">{ghost}</div>\n'
             f'<span></span><div style="display: flex; justify-content: space-between">{pill.format(w="48px") * 3}</div>\n</div>\n'
             f'<div aria-hidden="true" style="display: flex; flex-direction: column; gap: 12px; padding: 12px; border-radius: 12px; border: 1px solid var(--line); background: var(--bg)">'
             f'{pill.format(w="80%")}{pill.format(w="50%")}</div>')
    return f'<figure aria-labelledby="h-chart" aria-busy="true" style="{style}{CH_CARD}">\n{inner}\n</figure>'


def chart_overview(style=''):
    """Genel bakış grafiği: gelir sıfır çizgisinin üstünde, üretim maliyeti altında (aynı USD ölçeği); başlık bölümün h2'sidir."""
    style = f'{style}; ' if style else ''
    legend = ('<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 4px 24px">'
              f'{key("var(--text-2)", "Revenue", "[AMOUNT]")}{key("var(--edge-strong)", "Generation cost", "[AMOUNT]")}</div>')
    inner = (f'{CH_HEAD}\n{legend}\n{PICKED}\n</div>\n{plot(REV, COST, step=48)}\n'
             f'{data_table("Revenue and generation cost per day", ["Revenue", "Generation cost"])}')
    return f'<figure aria-label="Revenue and generation cost per day" style="{style}{CH_CARD}; justify-content: space-between">\n{inner}\n</figure>'


# ================================================================ 1. Mevcut panolar
# ---- A-Admin-Genel: grafik + "Refund requests" satırı (iade isteği yanıt bekler: sözleşme §8.1)
def need(href, title, text):
    return ('<li style="flex: 1; display: flex; border-top: 1px solid var(--line)">\n'
            f'<a href="{href}" style="flex: 1; display: flex; align-items: center; gap: 16px; min-height: 72px; box-sizing: border-box; '
            'padding: 12px 24px; color: var(--text); text-decoration: none">\n'
            f'<span style="min-width: 96px; {H5}; font-variant-numeric: tabular-nums; color: var(--text)">[COUNT]</span>\n'
            '<span style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px">\n'
            f'<span style="display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 600; line-height: 1.4">{title}</span>\n'
            f'<span style="{SMALL}">{text}</span>\n</span>\n'
            f'<span style="display: flex; color: var(--text-3)">{icon("forward")}</span>\n</a>\n</li>')


s = before = src('A-Admin-Genel')
s = swap(s, r'<div role="img" aria-label="Revenue and generation cost per day"[^>]*>[^<]*</div>|<figure aria-label="Revenue and generation cost per day".*?</figure>',
         chart_overview('flex: 1'))
unpaid = need('A-Gelir.dc.html', 'Payments not completed', 'Checkouts that were started but not paid.')
assert s.count(unpaid) == 1, 'A-Admin-Genel: "Payments not completed" satırı beklenen biçimde değil'
asked = need('A-Gelir.dc.html', 'Refund requests', 'Purchases with a refund request that is not answered yet.')
if asked not in s:
    s = s.replace(unpaid, asked + '\n' + unpaid)
put('A-Admin-Genel', s, before)

# ---- A-Gelir: grafik, paket fiyatları (§1.1), satın alma durumları (§8.1), "Refund" kenarlı düğme
PAY = {'paid': st('done', 'Paid'), 'open': st('stopped', 'Not completed'), 'asked': st('run', 'Refund requested'), 'refunded': st('off', 'Refunded')}
refund = f'<button type="button" style="{ROW_BTN}">Refund</button>'
by_pack = tbl('Revenue by credit pack', ['Pack', 'Price', 'Credits', 'Sold', 'Revenue', 'Share of revenue'],
              [[p, price, credits, '[COUNT]', '[AMOUNT]', '[PERCENT]'] for p, price, credits in
               (('Starter pack', '$19', '10'), ('Standard pack', '$54', '30'), ('Studio pack', '$169', '100'))],
              min_w=720, num=(1, 2, 3, 4, 5))
purchases = tbl('Purchases', ['Date', 'User', 'Pack', 'Credits', 'Amount', 'Tax', 'Invoice', 'Status', ACTIONS],
                [['[DATE]', user(), p, '[CREDITS]', '[AMOUNT]', '[AMOUNT]', invoice(k != 'open'), PAY[k], refund if k in ('paid', 'asked') else '']
                 for p, k in [('Standard pack', 'paid'), ('Starter pack', 'open'), ('Studio pack', 'paid'), ('Standard pack', 'refunded'),
                              ('Starter pack', 'asked'), ('Standard pack', 'open')]],  # iade isteği örneği §8.1 ile aynı paket: Starter
                min_w=1120, num=(3, 4, 5, 8))
s = before = src('A-Gelir')
s = swap(s, r'<div role="img" aria-label="Revenue per day"[^>]*>[^<]*</div>|<figure aria-labelledby="h-chart".*?</figure>', chart_revenue('flex: 2 1 496px'))
s = swap_table(s, 'Revenue by credit pack', by_pack)
s = swap_table(s, 'Purchases', purchases)
s = once(s, 'Money returned to customers', 'Money refunded to customers')  # §12: para için "refunded", kredi için "returned"
put('A-Gelir', s, before)

# ---- Kredi defteri (A-Krediler) ve kullanıcının kredi geçmişi (A-Kullanici-Detay): aynı satırlar, türler §12 + gerekçe sütunu (K16)
# returned = kredi bakiyeye döner; refund = para karta döner, paketin kredisi düşer. İkisi ayrı tür.
MOVES = [('Purchase', '+', 'Standard pack', ''), ('Generation', '-', TITLE[3], ''), ('Returned', '+', TITLE[3], 'Job stopped'),
         ('Admin', '+', 'Added by hand', '[REASON]'), ('Refund', '-', 'Starter pack', '[REASON]'), ('Free video', '0', TITLE[1], '')]
ledger = tbl('Credit ledger', ['Date', 'User', 'Type', 'Change', 'Note', 'Reason', 'Balance after'],
             [['[DATE]', user(), kind, change(sign), note, why, '[BALANCE]'] for kind, sign, note, why in MOVES], num=(3, 6))
s = before = src('A-Krediler')
s = swap_table(s, 'Credit ledger', ledger)
s = swap_segment(s, 'Type', segment(['All', 'Purchases', 'Generations', 'Free videos', 'Returned', 'Refunds', 'Admin'], 'All', 'Type'))
put('A-Krediler', s, before)

# ---- A-Kullanici-Detay: işlem düğmeleri kenarlı (onay penceresi açar; lime ana düğme pencerededir), engel geri alınabilir
history = tbl('Credit history', ['Date', 'Type', 'Change', 'Note', 'Reason', 'Balance after'],
              [['[DATE]', kind, change(sign), note, why, '[BALANCE]'] for kind, sign, note, why in MOVES], num=(2, 5))
s = before = src('A-Kullanici-Detay')
s = swap_table(s, 'Credit history', history)
s = once(s, f'<button type="button" style="{PRIMARY}">Add credits</button>', f'<button type="button" style="{SECONDARY}">Add credits</button>')
s = once(s, 'A blocked user cannot log in. Their credits are not deleted.</p>',
         'A blocked user cannot log in. Their credits are not deleted. You can unblock them here at any time.</p>')
# sözleşme §1.7 örnek işi (Fragrance layering recipe · No talking · Fast) bu kullanıcının iş listesinde de 2 kredi gösterir
s, n = re.subn(r'(<td[^>]*>Fragrance layering recipe</td>(?:<td[^>]*>(?:(?!</td>).)*</td>){3}<td[^>]*>)(?:\[CREDITS\]|2)(</td>)', r'\g<1>2\2', s)
assert n == 1, 'A-Kullanici-Detay: örnek işin satırı bulunamadı'
put('A-Kullanici-Detay', s, before)

# ---- A-Isler: durum adları (In queue · Running · Stopped · Closed · Done), "Credits returned" sütunu, satır eylemleri
USER = user()
OPEN = f'<a href="A-Isler.dc.html" style="{NAV_LINK}">Open</a>'
FREE_RETRY = 'The customer is not charged.'  # §12: yöneticinin başlattığı yeniden deneme müşteriden kredi almaz
# düğmenin altındaki not: aralık 16 (düğme eksi kenar boşluğuyla 12 px taşar)
RETRY = ('<span style="display: inline-flex; flex-direction: column; align-items: flex-end; gap: 16px">'
         f'<span style="display: inline-flex; align-items: center; gap: 16px">{OPEN}<button type="button" style="{ROW_BTN}">Retry job</button></span>'
         f'<span style="{SMALL}; white-space: nowrap">{FREE_RETRY}</span></span>')


def job(t, quality, credits, state, back='', act=OPEN):
    return ['[DATE]', USER, f'<span style="display: block; text-wrap: balance">{t["title"]}</span>', nowrap(t['format']), quality, 'English',
            credits, back, '[AMOUNT]', state, act]


jobs = [job(T[0], 'Fast', '2', st('run', 'Running', 'Step 3 of 6 · Clips')),  # sözleşme §1.7 örnek işi: yönetim de 2 kredi gösterir
        job(T[2], 'Best', '[CREDITS]', st('off', 'In queue', 'Position [COUNT]')),
        job(T[3], 'Best', '[CREDITS]', st('stopped', 'Stopped', '[REASON]'), '[CREDITS]', RETRY),
        job(T[1], 'Fast', 'Free video', st('done', 'Done')),
        job(T[4], 'Best', '[CREDITS]', st('done', 'Done')),
        job(T[5], 'Fast', '[CREDITS]', st('off', 'Closed'), '[CREDITS]')]
jobs_table = mark_row(panel.table('Jobs', ['Started', 'User', 'Template', 'Format', 'Quality', 'Language', 'Credits', 'Credits returned', 'Cost', 'Status', ACTIONS],
                                  jobs, min_w=1280, num=(6, 7, 8, 10)), 3, 'background: var(--raised)')


def fact(dt, dd):
    return (f'<div style="display: flex; flex-direction: column; gap: 4px; min-width: 0"><dt style="{SMALL}">{dt}</dt>'
            f'<dd style="margin: 0; font-size: 15px; line-height: 1.4; font-weight: 500; color: var(--text)">{dd}</dd></div>')


s = before = src('A-Isler')
s = swap_segment(s, 'Status', segment(['All', 'In queue', 'Running', 'Stopped', 'Closed', 'Done'], 'All', 'Status'))
s = swap_table(s, 'Jobs', jobs_table)
s = once(s, '<dl style="margin: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr)); gap: 16px 32px">',
         '<dl style="margin: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(200px, 100%), 1fr)); gap: 16px 32px">')
s = once(s, fact('Credits charged', '[CREDITS]') + '\n</dl>', fact('Credits charged', '[CREDITS]') + '\n' + fact('Credits returned', '[CREDITS]') + '\n</dl>')
s = once(s, f'{icon("retry", 18)}Retry from the stopped step</button>\n<button type="button" style="{SECONDARY}">Refund credits</button>\n',
         f'{icon("retry", 18)}Retry job</button>\n')
s = once(s, 'The finished parts stay saved. A retry runs only the missing part.</p>',
         FREE_RETRY + ' The finished parts stay saved. A retry runs only the missing part.</p>')
put('A-Isler', s, before)

# ---- A-Sablonlar: örnek durumu sütunu (§12: çekimler değişince örnek "out of date" olur, şablon yeniden yayınlanamaz)
PRIVATE = ('<div style="display: flex; flex-direction: column; gap: 4px">'
           '<span style="display: flex; white-space: nowrap; align-items: center; gap: 8px; font-size: 15px; font-weight: 600; color: var(--text-2)">'
           f'{icon("private", 18)}Private</span>'
           f'<span style="display: flex; gap: 8px; white-space: nowrap; {SMALL}">{_PAD}Only the owner sees it</span></div>')
TPL = {'published': st('done', 'Published'), 'waiting': st('off', 'Waiting to publish'), 'hidden': st('stopped', 'Hidden'), 'private': PRIVATE}
FRESH, STALE = plain('Sample up to date'), st('stopped', 'Sample out of date')


def edit(href):
    return f'<a href="{href}" style="{ROW_LINK}">Edit</a>'


def thumb(t):
    return ('<div style="display: flex; align-items: center; gap: 16px">'
            f'<img src="{t["img"]}" alt="" style="flex: 0 0 auto; width: 44px; height: 78px; object-fit: cover; border-radius: 8px; display: block; box-shadow: 0 0 0 1px var(--media-edge)">'
            f'<span style="min-width: 0; text-wrap: pretty">{t["title"]}</span></div>')


kinds = ['published', 'published', 'waiting', 'hidden', 'published', 'private']
tpl_rows = [[thumb(t), t['cat'], nowrap(t['format']), nowrap(t['dur']), f'<span style="font-variant-numeric: normal">{t["views"]}</span>', '[COUNT]', TPL[k],
             STALE if k == 'hidden' else FRESH, '[DATE]', edit('A-Sablon-Ornek-Eski.dc.html' if k == 'hidden' else 'A-Sablon-Duzenle.dc.html')]
            for t, k in zip(T, kinds)]
templates = panel.table('Templates', ['Template', 'Category', 'Format', 'Length', 'Reference views', 'Times generated', 'Status', 'Sample', 'Last edited', ACTIONS],
                        tpl_rows, min_w=1280, num=(4, 5, 9))
s = before = src('A-Sablonlar')
s = swap_table(s, 'Templates', templates)
put('A-Sablonlar', s, before)

# ---- A-Sablon-Duzenle: örnek durumu etiketi ("Sample" başlığıyla aynı satırda; görsel Details kartıyla hizalı kalır)
SAMPLE_SEC = '<section aria-labelledby="h-sample" style="flex: 1 1 260px; max-width: 300px; min-width: 0; display: flex; flex-direction: column; gap: 16px">\n'
SAMPLE_OK = (f'<span style="display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 600; color: var(--text-2)">'
             f'{icon("done", 18, "color: var(--text-3)", 2.6)}Sample up to date</span>')


def sample_head(mark):
    return ('<div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px 24px">\n'
            f'<h2 id="h-sample" style="margin: 0; {H6}">Sample</h2>\n{mark}\n</div>\n')


s = before = src('A-Sablon-Duzenle')
s = swap(s, '(?<=' + re.escape(SAMPLE_SEC) + ').*?(?=<figure)', sample_head(SAMPLE_OK))
put('A-Sablon-Duzenle', s, before)

# ---- A-Ayarlar: "Limits and safety" (§12'nin sekiz alanı)
FIELD = "min-width: 0; display: flex; flex-direction: column; justify-content: flex-end; gap: 8px; font-size: 13px; line-height: 1.4; color: var(--text-3)"
BIG = INPUT + "; font-size: 17px; font-weight: 600; width: 100%; min-width: 0"
BIG = BIG.replace('font-size: 15px; font-size: 17px', 'font-size: 17px')
assert BIG.count('font-size') == 1


def number(label, value):
    return f'<label style="{FIELD}">{label}\n<input type="number" min="0" value="{value}" style="{BIG}">\n</label>'


def text(label, value):
    return f'<label style="{FIELD}">{label}\n<input type="text" value="{value}" style="{BIG}">\n</label>'


def switch(label, on):
    """Anahtar: sayfadaki "Sources" düğmeleriyle aynı (kenar + On / Off yazısı; renk tek başına taşımaz)."""
    return (f'<button type="button" aria-pressed="{str(on).lower()}" style="align-self: end; min-width: 0; min-height: 52px; box-sizing: border-box; padding: 0 16px; border-radius: 12px; '
            f'border: 1.5px solid {"var(--accent-text)" if on else "var(--edge)"}; background: var(--bg); color: var(--text); font: inherit; font-size: 15px; cursor: pointer; '
            f'display: flex; align-items: center; justify-content: space-between; gap: 12px"><span style="font-weight: 600; text-align: left">{label}</span>'
            f'<span style="font-size: 13px; color: {"var(--accent-text)" if on else "var(--text-3)"}">{"On" if on else "Off"}</span></button>')


SELECT = INPUT.replace('padding: 0 16px', 'padding: 0 12px')
limits = f'''<section aria-labelledby="s-limits" style="{CARD}; display: flex; flex-direction: column; gap: 16px; min-width: 0; grid-column: 1 / -1">
<h2 id="s-limits" style="margin: 0; {H6}">Limits and safety</h2>
<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr)); gap: 16px">
{number('Jobs per user at the same time', 2)}
{number('Own videos per user per day', 3)}
{switch('Free first video', True)}
{switch('Show talking templates', False)}
{text('Daily spending limit', '[AMOUNT]')}
{text('Warn me at', '80%')}
<label style="{FIELD}">When the limit is reached
<select style="{SELECT}; width: 100%; min-width: 0"><option>Pause new jobs</option></select>
</label>
{switch('Pause generation now', False)}
</div>
<p style="margin: 0; {SMALL}">The daily spending limit counts what the generation provider charges in one day. While generation is paused, no new job starts and customers see: Generation is paused for a short time.</p>
</section>

'''
s = before = src('A-Ayarlar')
if 'id="s-limits"' not in s:
    s = once(s, '</section>\n\n</div>\n\n<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 12px 16px">',
             '</section>\n\n' + limits + '</div>\n\n<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 12px 16px">')
else:
    s = swap(s, r'<section aria-labelledby="s-limits".*?</section>\n\n', limits)
s = once(s, 'Generation provider, scan schedule, thresholds, and daily caps.</p>', 'Generation provider, scan schedule, thresholds, daily caps, and limits.</p>')
s = once(s, 'Changes apply from the next scan.</p>', 'Scan settings apply from the next scan. Limits and safety apply as soon as you save.</p>')
put('A-Ayarlar', s, before)

# ---- A-Gelen: örnek işin uzunluğu her panoda 8 sn (sözleşme §1.7); aday satırı 9 yazıyordu, aynı ekrandaki şablon satırı 8
s = before = src('A-Gelen')
s = once(s, "row('Fragrance layering recipe', '1.9M', '9 sec', 90, 'Template ready')", "row('Fragrance layering recipe', '1.9M', '8 sec', 90, 'Template ready')")
put('A-Gelen', s, before)


# ================================================================ 2. Yeni panolar
CELL = "flex: 1 1 400px; min-width: 0; max-width: 520px; display: flex; flex-direction: column; gap: 12px"
STATE_WRAP = "max-width: 1320px; margin: 0 auto; padding-top: clamp(24px, 4vw, 48px); display: flex; flex-direction: column; gap: 32px"


def cell(label, inner):
    return f'<div style="{CELL}">\n<p style="margin: 0; {SMALL}">{label}</p>\n{inner}\n</div>'


def board(name, title, heading, cells):
    """Durum panosu (KURALLAR §11): üst menü yok, tek h1, altında hücreler; telefonda hücreler alt alta iner."""
    body = (f'<div style="{STATE_WRAP}">\n<h1 style="margin: 0; {H4}">{heading}</h1>\n'
            '<div style="display: flex; flex-wrap: wrap; gap: 32px">\n' + '\n'.join(cells) + '\n</div>\n</div>')
    h = height(name)
    write(name + '.dc.html', title, ROOT_PAGE.replace('min-height: 900px', f'min-height: {h}px'), body, h=h)


# ---- pencere (kap: A-Onay; satırlar ve alt not: A-Is-Durdu-Onay ile aynı)
DLG = ("box-sizing: border-box; padding: clamp(16px, 2vw, 24px); border-radius: 24px; background: var(--surface); border: 1px solid var(--edge); "
       "display: flex; flex-direction: column; gap: 24px")
ROW = "display: flex; justify-content: space-between; gap: 16px; padding: 12px 0; border-top: 1px solid var(--edge); font-size: 15px"
DD = "margin: 0; min-width: 0; font-weight: 600; text-align: right; overflow-wrap: anywhere"
AREA = ("box-sizing: border-box; min-height: 72px; padding: 12px 16px; border-radius: 12px; border: 1px solid var(--edge-strong); background: var(--bg); "
        "color: var(--text); font: inherit; font-size: 15px; line-height: 1.5; resize: vertical")
IN_LEDGER = 'A reason is required. It is shown in the credit history.'  # A-Kullanici-Detay'daki cümle


def rows(items):
    """items: (etiket, değer) ya da (etiket, değer, 'big') → öne çıkan satır (17 px). Son satır alt çizgi taşır."""
    out = []
    for i, it in enumerate(items):
        big = len(it) > 2
        style = ROW.replace('font-size: 15px', 'font-size: 17px').replace('padding: 12px 0', 'padding: 16px 0') if big else ROW
        if i == len(items) - 1:
            style += '; border-bottom: 1px solid var(--edge)'
        dt = '<dt style="font-weight: 600">' if big else '<dt style="color: var(--text-2)">'
        out.append(f'<div style="{style}">{dt}{it[0]}</dt><dd style="{DD}">{it[1]}</dd></div>')
    return '<dl style="margin: 0; display: flex; flex-direction: column">\n' + '\n'.join(out) + '\n</dl>'


def reason(key, ask, hint, locked=False):
    lock = ' readonly="readonly"' if locked else ''
    return (f'<label style="{LABEL}">Reason\n'
            f'<textarea required="required" rows="2" aria-describedby="{key}-hint" placeholder="{ask}"{lock} style="{AREA}">[REASON]</textarea>\n'
            f'<span id="{key}-hint" style="{SMALL}">{hint}</span>\n</label>')


def buttons(confirm, style=PRIMARY, cancel='Cancel'):
    return ('<div style="display: flex; flex-wrap: wrap-reverse; gap: 12px">\n'
            f'<button type="button" style="{SECONDARY}; flex: 1 1 120px; white-space: nowrap">{cancel}</button>\n'
            f'<button type="button" style="{style}; flex: 2 1 200px; white-space: nowrap">{confirm}</button>\n</div>')


def dialog(key, title, parts_, top=''):
    """Yönetim onay penceresi: başlık, kullanıcı, özet satırları, zorunlu gerekçe, iki düğme, kayıt notu."""
    head = ('<div style="display: flex; flex-direction: column; gap: 8px">\n' + top
            + f'<h2 id="{key}-title" style="margin: 0; {H4}">{title}</h2>\n'
            '<p style="margin: 0; font-size: 15px; color: var(--text-2); overflow-wrap: anywhere">[EMAIL]</p>\n</div>')
    return f'<div role="dialog" aria-labelledby="{key}-title" style="{DLG}">\n{head}\n' + '\n'.join(parts_) + '\n</div>'


RECORD = f'<p style="margin: 0; {SMALL}">{NOTE}</p>'
# İade örneği sözleşme §8.1 ile aynı: Starter · 10 kredi. İstek açıkken paketin kredileri tutulur; iadeyle kaldırılır. Reddetme düğmesi yok.
REFUND_ROWS = [('Purchase', 'Starter pack · [DATE]'), ('Invoice', '[INVOICE NUMBER]'), ('Credits removed', '10 credits'),
               ('Balance after', '[BALANCE AFTER] credits'), ('Amount to refund', '[AMOUNT]', 'big')]
HELD = 'The 10 credits of this pack are held since the request and are removed now.'
MONEY = 'The money is refunded to the payment method in a few days.'
ASK_REFUND = 'Why you are refunding this purchase'

confirms = [
    cell('Refund: the money is refunded, the held credits are removed', dialog('refund', 'Refund', [
        rows(REFUND_ROWS), info(HELD + ' ' + MONEY), reason('refund', ASK_REFUND, IN_LEDGER), buttons('Refund', WARN_BTN), RECORD])),
    cell('Return credits: back to the balance, no money is refunded', dialog('return', 'Return credits', [
        rows([('Job', JOB), ('Credits charged', '2 credits'), ('Credits to return', '2 credits', 'big'), ('Balance after', '[BALANCE AFTER] credits')]),
        info('The credits are returned to the balance. No money is refunded.'),
        reason('return', 'Why you are returning these credits', IN_LEDGER), buttons('Return credits'), RECORD])),
    cell('Add credits', dialog('add', 'Add credits', [
        rows([('Balance now', '[BALANCE] credits'), ('Credits to add', '[CREDITS] credits', 'big'), ('Balance after', '[BALANCE AFTER] credits')]),
        reason('add', 'Why you are adding credits', IN_LEDGER), buttons('Add credits'), RECORD])),
    cell('Block user', dialog('block', 'Block user', [
        rows([('Credits', '[BALANCE] credits, kept'), ('Videos', '[COUNT], kept')]),
        info('The user cannot log in. At login they see: This account is blocked. If you think this is a mistake, contact support.'),
        reason('block', 'Why you are blocking this user', 'A reason is required.'), buttons('Block user', WARN_BTN), RECORD])),
    cell('Unblock user', dialog('unblock', 'Unblock user', [
        rows([('Blocked on', '[DATE]'), ('Reason for the block', '[REASON]')]),
        info('The user can log in again. Their credits and videos are as they were.'),
        reason('unblock', 'Why you are unblocking this user', 'A reason is required.'), buttons('Unblock user'), RECORD])),
    cell('Retry job: the customer is not charged', dialog('retry', 'Retry job', [  # §12: iş, eksik parçalar, ücret yok, gerekçe
        rows([('Job', JOB), ('Missing', '2 clips')]),
        info(FREE_RETRY),
        reason('retry', 'Why you are retrying this job', 'A reason is required.'), buttons('Retry job'), RECORD])),
]
board('A-Admin-Onaylar', 'Admin: action confirmations', 'Admin actions · confirmations', confirms)

# ---- işlem sonuç durumları (§12): Working… → Done; olmazsa "It did not go through…"; yinelenirse "This was already done on [DATE]."
working = ('<div style="display: flex; flex-wrap: wrap-reverse; gap: 12px">\n'
           f'<button type="button" aria-disabled="true" style="{SECONDARY.replace("cursor: pointer", "cursor: default").replace("color: var(--text)", "color: var(--text-3)").replace("var(--edge-strong)", "var(--edge)")}; flex: 1 1 120px; white-space: nowrap">Cancel</button>\n'
           f'<button type="button" aria-disabled="true" style="{OFF_BTN}; flex: 2 1 200px; white-space: nowrap">{icon("generating", 18)}Working…</button>\n</div>')
close = f'<button type="button" style="{SECONDARY}">Close</button>'
done_top = f'<div role="status" style="display: flex">{status("done", "Done")}</div>\n'
blocked = f'''<div role="group" aria-labelledby="st-access" style="{CARD.replace('padding: 24px', 'padding: clamp(16px, 2vw, 24px)')}; display: flex; flex-direction: column; gap: 16px">
<div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px">
<h2 id="st-access" style="{H_SUB}">Access</h2>
{status('stopped', 'Blocked')}
</div>
{rows([('Blocked on', '[DATE]'), ('Reason', '[REASON]')])}
<div style="display: flex; flex-wrap: wrap; gap: 12px">
<button type="button" style="{SECONDARY}; flex: 1 1 auto; white-space: nowrap">Send password reset email</button>
<button type="button" style="{SECONDARY}; flex: 1 1 auto; white-space: nowrap">Unblock user</button>
</div>
<p style="margin: 0; {SMALL}">A blocked user cannot log in. Their credits are not deleted.</p>
</div>'''
list_error = f'''<div role="alert" style="box-sizing: border-box; border-radius: 16px; background: var(--surface); border: 1px solid var(--line); padding: clamp(48px, 5vw, 72px) clamp(16px, 4vw, 24px); display: flex; flex-direction: column; align-items: center; gap: 24px; text-align: center">
<span aria-hidden="true" style="width: 48px; height: 48px; border-radius: 50%; background: var(--raised); color: var(--warn); display: flex; align-items: center; justify-content: center">{icon('warning', 24)}</span>
<div style="display: flex; flex-direction: column; align-items: center; gap: 8px">
<h2 style="margin: 0; {H6}">Could not load this list.</h2>
<p style="margin: 0; max-width: 520px; {BODY2}">Check your connection and try again. Nothing was changed.</p>
</div>
<button type="button" style="{SECONDARY}; gap: 8px">{icon('retry', 18)}Try again</button>
</div>'''

states = [
    cell('Working: both buttons are off until the answer comes', dialog('w', 'Refund', [
        rows(REFUND_ROWS), reason('w', ASK_REFUND, IN_LEDGER, locked=True), working, RECORD])),
    cell('Done', dialog('d', 'Refund', [
        rows([('Amount refunded', '[AMOUNT]', 'big'), ('Credits removed', '10 credits'), ('Balance after', '[BALANCE AFTER] credits'), ('Reason', '[REASON]')]),
        info(MONEY), close], top=done_top)),
    cell('It did not go through', dialog('f', 'Refund', [
        rows(REFUND_ROWS), reason('f', ASK_REFUND, IN_LEDGER),
        info('It did not go through. Nothing was changed. Try again.', 'warn'), buttons('Try again', WARN_BTN), RECORD])),
    cell('Already done: the same action cannot run twice', dialog('r', 'Refund', [
        rows([('Purchase', 'Starter pack · [DATE]'), ('Invoice', '[INVOICE NUMBER]'), ('Status', 'Refunded')]),
        info('This was already done on [DATE].'), close])),
    cell('The list could not be loaded', list_error),
    cell('After Block user: access actions on the user page', blocked),
]
board('A-Admin-Islem-Durumlar', 'Admin: action states', 'Admin actions · states', states)

# ---- grafik kartının durumları
charts = [cell('With data: the last day is picked, its value is in the corner', chart_revenue()),
          cell('No sales in the period', chart_revenue(state='empty')),
          cell('Could not load', chart_revenue(state='error')),
          cell('Loading', chart_revenue(state='loading'))]
board('A-Admin-Grafik-Durumlar', 'Admin: chart states', 'Admin charts · states', charts)

# ---- A-Sablon-Ornek-Eski: A-Sablon-Duzenle'nin "çekimler değişti, örnek eski" hâli (kaynaktan türer; çekim listesi ve ayrıntılar aynı kalır)
STALE_NOTE = ('<p role="alert" style="margin: 0; display: flex; align-items: flex-start; gap: 12px; padding: 12px 16px; border-radius: 12px; background: var(--surface); '
              f'border: 1px solid var(--warn-edge); font-size: 15px; line-height: 1.5; color: var(--text)">{icon("warning", 20, "flex: 0 0 auto; color: var(--warn)")}'
              '<span><strong style="font-weight: 600; color: var(--warn)">The shots changed after this sample was made.</strong> Generate a new sample before you publish.</span></p>')
ON_MARK = f'<span style="display: flex; color: var(--accent-text)">{icon("done", 18, sw=2.6)}</span>'
CHOICE = ('<button type="button" aria-pressed="{on}" style="flex: 1 1 0; min-width: 0; min-height: 52px; box-sizing: border-box; padding: 0 16px; border-radius: 12px; '
          'border: 1.5px solid {edge}; background: var(--bg); color: {ink}; font: inherit; font-size: 15px; font-weight: {w}; cursor: pointer; '
          'display: flex; align-items: center; justify-content: space-between; gap: 8px">{label}{mark}</button>')
PICK = dict(on='true', edge='var(--accent-text)', ink='var(--text)', w=600, mark=ON_MARK)
REST = dict(on='false', edge='var(--edge)', ink='var(--text-2)', w=400, mark='')
d = src('A-Sablon-Duzenle')
d = once(d, '<title>Admin: edit template</title>', '<title>Admin: edit template, sample out of date</title>')
d = once(d, status('done', 'Published') + '\n</div>', status('stopped', 'Hidden') + '\n</div>')
d = once(d, 'Last edited [DATE]</p>\n</section>\n', 'Last edited [DATE]</p>\n</section>\n\n' + STALE_NOTE + '\n')
d = once(d, SAMPLE_OK, status('stopped', 'Sample out of date'))
d = once(d, f'<button type="button" style="{SECONDARY}; gap: 8px">{icon("retry", 18)}Regenerate sample</button>',
         f'<button type="button" style="{PRIMARY}; gap: 8px">{icon("retry", 18)}Generate a new sample</button>')
d = once(d, CHOICE.format(label='Published', **PICK) + '\n' + CHOICE.format(label='Hidden', **REST),
         CHOICE.format(label='Published', **REST) + '\n' + CHOICE.format(label='Hidden', **PICK))
d = once(d, f'<button type="button" style="{PRIMARY}">Save changes</button>\n<button type="button" style="{SECONDARY}">Discard changes</button>',
         f'<button type="button" aria-disabled="true" style="{OFF_BTN}">Publish</button>\n<button type="button" style="{SECONDARY}">Save changes</button>')
d = once(d, 'Changes apply only to videos generated from now on.</p>', 'Publish turns on when the new sample is ready. Jobs that are running finish with the shots they started with.</p>')
d = once(d, f'\n<button type="button" style="{WARN_BTN}">Hide template</button>', '')
h = height('A-Sablon-Ornek-Eski', 0)
if h:  # boy.py'nin ölçtüğü yükseklik korunur
    d = re.sub(r'(<div class="ay"[^>]*?min-height: )\d+px', rf'\g<1>{h}px', d, count=1)
    d = re.sub(r'("\$preview":\{"width":\d+,"height":)\d+\}', rf'\g<1>{h}}}', d, count=1)
old = src('A-Sablon-Ornek-Eski') if h else ''
put('A-Sablon-Ornek-Eski', d, old)
