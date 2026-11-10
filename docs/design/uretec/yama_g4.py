"""Grup 4 (3.8 · Admin) mobil yamaları: yalnız 390 px'lik kopyalara uygulanır (variants.py). Kaynak panolar değişmez.
Telefonda panel: sayfa başlığındaki eylemler alt alta ve tam genişlik · dönem / süzgeç hapları tek satırda, sığmazsa yana kayar ·
sayı kutuları iki sütun (beşli takımda ilk kutu tam genişlik) · kart iç boşluğu 16 · sayfalama düğmeleri yarı yarıya ·
tablolar kendi kutusunda yana kayar (yama yok). Şablon düzenlemede örnek video küçük kare + bilgi, çekimler birer kart.
Eski metinler kaynakta birebir geçer; kaynaktan okunan iki parça (örnek video, çekim listesi) bulunamazsa yalnız o pano durur."""
import os, re
from parts import P

SMALL = "font-size: 13px; line-height: 1.4; color: var(--text-3)"
CARD = "box-sizing: border-box; padding: 24px; border-radius: 16px; background: var(--surface); border: 1px solid var(--line)"
CARD_M = CARD.replace('padding: 24px', 'padding: 16px')
LABEL = "display: flex; flex-direction: column; gap: 8px; font-size: 15px; color: var(--text-2)"
BTN = "display: flex; align-items: center; justify-content: center; box-sizing: border-box; border-radius: 12px; font: inherit; font-weight: 600; text-decoration: none; cursor: pointer"
PRIMARY = BTN + "; min-height: 52px; padding: 0 24px; border: 0; background: var(--accent); color: var(--on-accent); font-size: 15px"
SECONDARY = BTN + "; min-height: 52px; padding: 0 24px; border: 1px solid var(--edge-strong); background: transparent; color: var(--text); font-size: 15px"
INPUT = "min-height: 52px; box-sizing: border-box; padding: 0 16px; border-radius: 12px; border: 1px solid var(--edge-strong); background: var(--bg); color: var(--text); font: inherit; font-size: 15px"

# ---- sayfa başlığı (panel.page_head): eylemler başlığın altında, alt alta, tam genişlik
HEAD_SEC = '<section style="display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 24px 48px">'
HEAD_ACT = '<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 12px">'
STACK = '<div style="flex: 1 1 100%; min-width: 0; display: flex; flex-direction: column; align-items: stretch; gap: 12px">'
HEAD = [(HEAD_SEC, HEAD_SEC.replace('gap: 24px 48px', 'gap: 16px')), (HEAD_ACT, STACK)]

# ---- dönem / süzgeç (panel.segment): tek satır, tam genişlik; seçenekler sığmazsa kutu yana kayar
SEG_BOX = 'style="display: flex; flex-wrap: wrap; gap: 4px; padding: 4px; border-radius: 999px; border: 1px solid var(--line)"'
SEG_BTN = 'style="display: flex; align-items: center; min-height: 44px; padding: 0 16px; border-radius: 999px; border: 0; font: inherit; font-size: 15px; font-weight: 500; cursor: pointer; background:'
SEG = [(SEG_BOX, 'style="flex: 1 1 100%; min-width: 0; box-sizing: border-box; display: flex; flex-wrap: nowrap; overflow-x: auto; gap: 4px; padding: 4px; '
                 'border-radius: 999px; border: 1px solid var(--line)"'),
       (SEG_BTN, 'style="flex: 1 0 auto; display: flex; align-items: center; justify-content: center; min-width: 44px; min-height: 44px; padding: 0 12px; border-radius: 999px; '
                 'border: 0; font: inherit; font-size: 15px; font-weight: 500; white-space: nowrap; cursor: pointer; background:')]

# ---- sayı kutuları (panel.tile): iki sütun, iç boşluk 16, değer 24
TILES = 'display: grid; grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr)); gap: 16px; grid-auto-rows: 1fr'
TILE = f'<div style="{CARD}; display: flex; flex-direction: column; gap: 8px; min-width: 0">'
TILE_LABEL = '<span style="font-size: 13px; line-height: 1.4; color: var(--text-3)">%s</span>'
VALUE = '<span style="font-family: var(--display); font-weight: 800; font-size: 32px; line-height: 1.1; letter-spacing: -0.02em; font-variant-numeric: tabular-nums">'
TILE_M = TILE.replace('padding: 24px', 'padding: 16px')
VALUE_M = VALUE.replace('font-size: 32px; line-height: 1.1', 'font-size: 24px; line-height: 1.2')
TWO = [(TILES, 'display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; grid-auto-rows: 1fr'), (TILE, TILE_M), (VALUE, VALUE_M)]


def hero(label):
    """Beş kutuluk takım: ilk kutu tam genişlik ve değeri büyük (32) kalır; öteki dördü ikişer ikişer.
    Sıra önemli: önce ilk kutu ayrılır (stil sırası değiştiği için genel kutu yamaları ona dokunmaz)."""
    first = TILE + '\n' + TILE_LABEL % label + '\n' + VALUE
    big = VALUE.replace('font-family: var(--display)', 'font-variant-numeric: tabular-nums; font-family: var(--display)').replace(
        '; font-variant-numeric: tabular-nums">', '">')
    return [(first, TILE_M.replace('style="', 'style="grid-column: 1 / -1; ') + '\n' + TILE_LABEL % label + '\n' + big),
            (TILES, 'display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px'), (TILE, TILE_M), (VALUE, VALUE_M)]


# ---- sayfalama (panel.pager): yazı üstte, iki düğme yarı yarıya
PAGER = [('<div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px">',
          '<div style="display: flex; flex-direction: column; align-items: stretch; gap: 12px">'),
         ('<div style="display: flex; gap: 8px">\n<button type="button" style="', '<div style="display: flex; gap: 8px">\n<button type="button" style="flex: 1; '),
         ('Previous</button>\n<button type="button" style="', 'Previous</button>\n<button type="button" style="flex: 1; ')]

# ---- eylem şeridi (çizgi üstünde düğmeler): alt alta, tam genişlik; açıklama düğmelerin arasında kendi satırında
STRIP = ('<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding-top: 24px; border-top: 1px solid var(--line)">',
         '<div style="display: flex; flex-direction: column; align-items: stretch; gap: 12px; padding-top: 24px; border-top: 1px solid var(--line)">')


def _grab(name, pattern):
    """Kaynaktaki bir parçayı (re.Match) verir; bulunamazsa None. Yama dosyası başka grupların çalıştırmasını durdurmasın diye hata fırlatmaz."""
    try:
        return re.search(pattern, open(os.path.join(P, name + '.dc.html'), encoding='utf-8').read(), re.S)
    except OSError:
        return None


def _missing(what):
    return [(f'<<yama_g4: {what} kaynakta bulunamadı>>', '')]  # variants.py bu panoda "yama eşleşmedi" diye durur


def sample_m():
    """Şablon düzenleme · örnek video: telefonda küçük kare (132 px) solda; sağında üstte kaynak bilgisi, altta "Regenerate sample"
    (karenin alt kenarıyla hizalı); iki açıklama cümlesi altta tek satır grubu."""
    m = _grab('A-Sablon-Duzenle', r'<section aria-labelledby="h-sample" style="[^"]*">\n(<h2 id="h-sample".*?</h2>)\n<figure[^>]*>\n<div[^>]*>\n'
              r'(<img[^>]*>)\n(<button type="button" aria-label="Play the sample"[^>]*>)<svg width="26" height="26"(.*?</button>)\n</div>\n'
              r'<figcaption[^>]*>(.*?)</figcaption>\n</figure>\n<dl[^>]*>\n(.*?)\n</dl>\n(<button.*?</button>)\n(<p.*?</p>)\n</section>')
    if not m or 'width: 72px; height: 72px' not in m.group(3):
        return _missing('örnek video bölümü')
    h2, img, play, play_rest, caption, facts, again, note = m.groups()
    play = play.replace('width: 72px; height: 72px', 'width: 52px; height: 52px') + '<svg width="20" height="20"' + play_rest
    again = again.replace('padding: 0 24px', 'padding: 0 16px')  # 210 px'lik sütuna sığsın
    note = re.sub(r'^<p[^>]*>|</p>$', '', note)
    new = f'''<section aria-labelledby="h-sample" style="flex: 1 1 100%; min-width: 0; display: flex; flex-direction: column; gap: 16px">
{h2}
<div style="display: flex; align-items: stretch; gap: 16px">
<figure style="flex: 0 0 132px; margin: 0">
<div style="position: relative; border-radius: 12px; overflow: hidden; background: var(--surface); box-shadow: 0 0 0 1px var(--media-edge)">
{img}
{play}
</div>
</figure>
<div style="flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: space-between; gap: 16px">
<dl style="margin: 0; display: flex; flex-direction: column; gap: 4px">
{facts}
</dl>
{again}
</div>
</div>
<p style="margin: 0; {SMALL}">{caption} {note}</p>
</section>'''
    return [(m.group(0), new)]


def shots_m():
    """Şablon düzenleme · çekim listesi: telefonda her çekim bir kart (numara + süre üstte, taşıma / silme sağ üstte, alanlar alt alta)."""
    m = _grab('A-Sablon-Duzenle', r'<div style="border-radius: 16px; border: 1px solid var\(--line\); background: var\(--surface\)">\n<div style="position: relative; overflow-x: auto">\n'
              r'<table.*?<tbody>\n(.*?)\n</tbody>\n</table>\n</div>\n<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 12px 16px; padding: 16px">\n'
              r'(<button.*?</button>)\n(<span.*?</span>)\n</div>\n</div>')
    rows = m and re.findall(r'<tr><th scope="row"[^>]*>(\d+)</th><td[^>]*>([^<]*)</td><td[^>]*>(<input[^>]*>)</td><td[^>]*>(<input[^>]*>)</td>'
                            r'<td[^>]*>(<select.*?</select>)</td><td[^>]*><div[^>]*>(.*?)</div></td></tr>', m.group(1), re.S)
    if not rows or len(rows) != m.group(1).count('<tr>'):
        return _missing('çekim listesi')
    cards = []
    for no, time, what, text, product, buttons in rows:
        what, text = (v.replace('padding: 0 12px', 'padding: 0 16px') for v in (what, text))  # kartta öteki alanlarla aynı iç boşluk
        cards.append(f'''<li style="{CARD_M}; display: flex; flex-direction: column; gap: 12px">
<div style="display: flex; align-items: center; justify-content: space-between; gap: 8px">
<span style="display: flex; align-items: baseline; gap: 12px; font-size: 15px; font-weight: 600"><span style="color: var(--text)">Shot {no}</span><span style="color: var(--accent-text); white-space: nowrap">{time}</span></span>
<div style="display: flex; margin: -8px -12px -8px 0">{buttons}</div>
</div>
<label style="{LABEL}">What happens
{what}
</label>
<label style="{LABEL}">On-screen text
{text}
</label>
<label style="{LABEL}">Product
{product}
</label>
</li>''')
    new = ('<div style="display: flex; flex-direction: column; gap: 12px">\n'
           '<ol aria-label="Shots" style="margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 12px">\n'
           + '\n'.join(cards) + f'\n</ol>\n{m.group(2)}\n{m.group(3)}\n</div>')
    return [(m.group(0), new)]


YAMA = {
    'A-Admin-Genel': HEAD + SEG + TWO + [
        ('padding: 12px 24px; color: var(--text); text-decoration: none">', 'padding: 12px 16px; color: var(--text); text-decoration: none">')],
    'A-Kullanicilar': HEAD + SEG + PAGER,
    'A-Kullanici-Detay': hero('Balance') + [
        # Actions kartı: iki bölüm alt alta (arada çizgi), alanlar ve düğmeler tam genişlik
        (f'<div style="{CARD}; display: flex; flex-wrap: wrap; gap: 24px 48px">', f'<div style="{CARD_M}; display: flex; flex-wrap: wrap; gap: 24px 48px">'),
        ('; flex: 0 1 160px; min-width: 0">Credits to add', '; flex: 1 1 100%; min-width: 0">Credits to add'),
        (f'<button type="button" style="{PRIMARY}">Add credits</button>', f'<button type="button" style="{PRIMARY}; flex: 1 1 100%">Add credits</button>'),
        ('<div role="group" aria-labelledby="h-access" style="flex: 2 1 360px; min-width: 0; display: flex; flex-direction: column; gap: 16px">',
         '<div role="group" aria-labelledby="h-access" style="flex: 2 1 360px; min-width: 0; display: flex; flex-direction: column; gap: 16px; '
         'padding-top: 24px; border-top: 1px solid var(--line)">'),
        ('<div style="margin-top: auto; display: flex; flex-wrap: wrap; gap: 12px">', '<div style="display: flex; flex-direction: column; align-items: stretch; gap: 12px">')],
    'A-Gelir': HEAD + SEG + TWO + PAGER,
    'A-Krediler': HEAD + SEG + TWO + PAGER,
    'A-Isler': HEAD + SEG + hero('Running now') + PAGER + [
        # duran iş kartı: iç boşluk 16, eylemler alt alta tam genişlik
        (f'<div style="{CARD}; border-color: var(--warn-edge); display: flex; flex-direction: column; gap: 24px">',
         f'<div style="{CARD_M}; border-color: var(--warn-edge); display: flex; flex-direction: column; gap: 24px">'),
        STRIP,
        (f'<p style="flex: 1 1 280px; margin: 0 0 0 12px; {SMALL}">', f'<p style="margin: 0; {SMALL}">')],
    'A-Sablonlar': HEAD + SEG + PAGER,
    'A-Gelen': [HEAD[0], (HEAD_ACT.replace('style="', 'style="flex: 0 1 520px; min-width: 0; '), STACK),
                (f'style="{INPUT}; flex: 1 1 240px; min-width: 0"', f'style="{INPUT}; width: 100%"')] + SEG + [
        (f'<article style="{CARD}; ', f'<article style="{CARD_M}; ')],
    'A-Gelen-Bos': [HEAD[0], (HEAD_ACT.replace('style="', 'style="flex: 0 1 520px; min-width: 0; '), STACK),
                    (f'style="{INPUT}; flex: 1 1 240px; min-width: 0"', f'style="{INPUT}; width: 100%"')] + SEG,
    'A-Sablon-Duzenle': sample_m() + shots_m() + [
        (f'<div style="{CARD}; display: grid; ', f'<div style="{CARD_M}; display: grid; '),
        STRIP,
        (f'<p style="flex: 1 1 240px; margin: 0 12px; {SMALL}">', f'<p style="margin: 0; {SMALL}">')],
    'A-Tarama': HEAD + SEG + hero('Scans') + PAGER,
    'A-Ayarlar': [
        (f'style="{CARD}; display: flex; flex-direction: column; gap: 16px; min-width: 0', f'style="{CARD_M}; display: flex; flex-direction: column; gap: 16px; min-width: 0'),
        ('display: grid; grid-template-columns: repeat(auto-fit, minmax(min(170px, 100%), 1fr)); gap: 16px',
         'display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px 12px'),
        (f'style="{SECONDARY}; align-self: flex-start">Check connection', f'style="{SECONDARY}">Check connection'),
        # saat alanları üçü yan yana kalsın: iç boşluk 12 (16'da saat yazısı kırpılıyordu)
        (f'style="{INPUT}; flex: 1 1 100px; min-width: 0; color-scheme', f'style="{INPUT.replace("padding: 0 16px", "padding: 0 12px")}; flex: 1 1 100px; min-width: 0; color-scheme'),
        (f'style="{PRIMARY}">Save changes', f'style="{PRIMARY}; width: 100%">Save changes')],  # kaydet düğmesi tam genişlik, not altında
}
