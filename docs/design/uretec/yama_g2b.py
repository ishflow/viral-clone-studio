"""Grup 2b (3.4 Generate a video) mobil yamaları. Yalnız mobil kopyaya (-M, -ML) uygulanır; kaynak değişmez.
Eski metin kaynakta birebir geçmeli (variants.py geçmezse durur)."""

WRAP32 = '<div style="max-width: 1320px; margin: 0 auto; display: flex; flex-direction: column; gap: 32px">'
WRAP24 = WRAP32.replace('gap: 32px', 'gap: 24px')
WRAP16 = WRAP32.replace('gap: 32px', 'gap: 16px')

# --- A-Form / A-Form-Hata: şablon kartı küçük satır olur, varyant ve Generate tam genişlik -------------------------------
FORM = [
    (WRAP32, WRAP16),
    ('<main style="display: flex; flex-wrap: wrap; align-items: flex-start; gap: 32px 48px">',
     '<main style="display: flex; flex-wrap: wrap; align-items: flex-start; gap: 24px">'),
    ('<aside aria-label="Selected template" style="flex: 1 1 240px; max-width: 300px; display: flex; flex-direction: column; gap: 12px">',
     '<aside aria-label="Selected template" style="flex: 1 1 100%; box-sizing: border-box; display: flex; align-items: center; gap: 16px; padding: 12px; '
     'border-radius: 16px; background: var(--surface); border: 1px solid var(--line)">'),
    ('alt="" style="width: 100%; aspect-ratio: 9 / 16; object-fit: cover; border-radius: 16px; display: block; box-shadow: 0 0 0 1px var(--media-edge)">',
     'alt="" style="flex: 0 0 auto; width: 56px; aspect-ratio: 9 / 16; object-fit: cover; border-radius: 8px; display: block; box-shadow: 0 0 0 1px var(--media-edge)">'),
    ('style="width: 72px; min-height: 72px; border-radius: 12px; border: 1.5px solid {{ v.border }}',
     'style="flex: 1 1 0; min-height: 72px; border-radius: 12px; border: 1.5px solid {{ v.border }}'),
    ('<a href="A-Onay.dc.html" style="display: flex; align-items: center; justify-content: center; min-height: 60px; padding: 0 48px;',
     '<a href="A-Onay.dc.html" style="flex: 1 1 100%; box-sizing: border-box; display: flex; align-items: center; justify-content: center; min-height: 60px; padding: 0 48px;'),
]

# --- A-Onay / A-Onay-Yetersiz: alttan açılan tam genişlik sayfa (tutamak, kenar 16; düğmeler kaynakta wrap-reverse ile alt alta) ----
SHEET = [
    ('box-sizing: border-box; padding: 24px; background: var(--bg); color: var(--text); font-family: var(--body); display: flex; align-items: center; justify-content: center">\n'
     '<div role="dialog" aria-labelledby="onay-baslik" style="width: 100%; box-sizing: border-box; padding: 24px; border-radius: 24px; background: var(--surface); '
     'border: 1px solid var(--edge); display: flex; flex-direction: column; gap: 24px">',
     'box-sizing: border-box; padding: 24px 0 0; background: var(--bg); color: var(--text); font-family: var(--body); display: flex; align-items: flex-end; justify-content: center">\n'
     '<div role="dialog" aria-labelledby="onay-baslik" style="width: 100%; box-sizing: border-box; padding: 12px 16px 32px; border-radius: 24px 24px 0 0; background: var(--surface); '
     'border-top: 1px solid var(--edge); display: flex; flex-direction: column; gap: 24px">\n'
     '<span aria-hidden="true" style="align-self: center; width: 44px; height: 4px; border-radius: 999px; background: var(--edge-strong)"></span>'),
]

# --- A-Is-Takibi: kalan süre tek satır, kareler adımların altında yana kayan sıra ---------------------------------------
IS_TAKIBI = [
    ('font-size: 32px; color: var(--text)">about 3 min</strong>', 'font-size: 24px; color: var(--text)">about 3 min</strong>'),
    ('<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(104px, 100%), 1fr)); gap: 8px">',
     '<div style="display: flex; gap: 8px; overflow-x: auto; scroll-snap-type: x mandatory; margin-right: -16px; padding-right: 16px">'),
    ('<figure style="margin: 0; display: flex; flex-direction: column; gap: 8px">',
     '<figure style="flex: 0 0 104px; scroll-snap-align: start; margin: 0; display: flex; flex-direction: column; gap: 8px">'),
]

# --- A-Is-Durdu: seçenek kartı adımların üstünde -------------------------------------------------------------------------
IS_DURDU = [
    ('<section aria-label="What happened and your options" style="flex: 1 1 480px; min-width: 0; box-sizing: border-box; padding: 24px;',
     '<section aria-label="What happened and your options" style="order: -1; flex: 1 1 480px; min-width: 0; box-sizing: border-box; padding: 16px;'),
]

# --- A-Sonuc: video üstte ve ortada (ekranı kaplamaz), düğmeler tam genişlik --------------------------------------------
VIDEO = '<div style="position: relative; flex: 1 1 280px; max-width: 390px; border-radius: 16px;'
MAIN_SONUC = '<main style="display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 32px 72px">'
COL_SONUC = '<div style="flex: 1 1 380px; max-width: 520px; display: flex; flex-direction: column; gap: 32px">'
META17 = '<p style="margin: 0; font-size: 17px; color: var(--text-2)">Fragrance layering recipe'
META15 = '<p style="margin: 0; font-size: 15px; color: var(--text-2)">Fragrance layering recipe'
SONUC = [
    (WRAP32, WRAP24),
    (MAIN_SONUC, '<main style="display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 24px">'),
    (VIDEO, '<div style="position: relative; flex: 0 0 270px; border-radius: 16px;'),
    (COL_SONUC, '<div style="flex: 1 1 100%; min-width: 0; display: flex; flex-direction: column; gap: 24px">'),
    (META17, META15),
]

# --- A-Sonuc-Varyant: video solda, varyant küçük resimleri sağında dikey sıra; sonra başlık ve düğmeler ------------------
SONUC_VARYANT = [
    (WRAP32, WRAP24),
    (MAIN_SONUC, '<main style="display: flex; flex-wrap: wrap; align-items: flex-start; gap: 24px 16px">'),
    (VIDEO, '<div style="order: -2; position: relative; flex: 1 1 0; min-width: 0; border-radius: 16px;'),
    (COL_SONUC, '<div style="display: contents">'),
    ('<div style="display: flex; flex-direction: column; gap: 12px">\n<h1', '<div style="flex: 0 0 100%; display: flex; flex-direction: column; gap: 12px">\n<h1'),
    (META17, META15),
    ('<div role="group" aria-label="Variants" style="display: flex; flex-wrap: wrap; gap: 16px">',
     '<div role="group" aria-label="Variants" style="order: -1; flex: 0 0 72px; align-self: stretch; display: flex; flex-direction: column; justify-content: space-between">'),
    ('<div style="display: flex; flex-wrap: wrap; gap: 12px">\n<button type="button" style="flex: 1 1 200px',
     '<div style="flex: 0 0 100%; display: flex; flex-wrap: wrap; gap: 12px">\n<button type="button" style="flex: 1 1 200px'),
    ('<dl style="margin: 0; display: flex; flex-direction: column">', '<dl style="flex: 0 0 100%; margin: 0; display: flex; flex-direction: column">'),
]

# --- A-Karsilastir: iki video yan yana iki sütun (karşılaştırma ancak ikisi birlikte görünürse işe yarar); Download en altta tam genişlik
K_SVG = ('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
         '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"></path></svg>Download</button>')
K_BTN = ('<button type="button" style="display: flex; align-items: center; justify-content: center; box-sizing: border-box; border-radius: 12px; font: inherit; font-weight: 600; cursor: pointer; '
         'min-height: 52px; padding: 0 24px; border: 0; background: var(--accent); color: var(--on-accent); font-size: 15px; gap: 8px">' + K_SVG)
K_BTN_M = ('<button type="button" style="display: flex; align-items: center; justify-content: center; box-sizing: border-box; border-radius: 12px; font: inherit; font-weight: 600; cursor: pointer; '
           'min-height: 60px; padding: 0 24px; border: 0; background: var(--accent); color: var(--on-accent); font-size: 17px; gap: 8px">' + K_SVG)
KARSILASTIR = [
    (WRAP32, WRAP24),
    ('<header style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px 32px; padding: 16px 0; border-bottom: 1px solid var(--line)">',
     '<header style="display: flex; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--line)">'),
    ('Back to result</a>\n<h1 ', 'Back to result</a>\n</header>\n<h1 '),
    ('</h1>\n' + K_BTN + '\n</header>', '</h1>'),
    ('<main style="display: flex; flex-wrap: wrap; justify-content: center; align-items: flex-start; gap: 32px">', '<main style="display: flex; align-items: flex-start; gap: 12px">'),
    ('<figure style="margin: 0; flex: 0 1 380px; min-width: 0;', '<figure style="margin: 0; flex: 1 1 0; min-width: 0;'),
    ('object-fit: cover; border-radius: 16px; display: block; box-shadow', 'object-fit: cover; border-radius: 12px; display: block; box-shadow'),
    ('<span style="font-size: 15px; font-weight: 600">0:02 / 0:08</span>', '<span style="flex: 1 1 0; font-size: 15px; font-weight: 600">0:02 / 0:08</span>'),
    ('<span style="flex: 1 1 200px; font-size: 15px; color: var(--text-2)">Shot 2 of 5', '<span style="order: 1; flex: 1 1 100%; font-size: 15px; color: var(--text-2)">Shot 2 of 5'),
    ('</button>\n</div>\n</div>\n</div>\n</div>\n</x-dc>', '</button>\n</div>\n</div>\n' + K_BTN_M + '\n</div>\n</div>\n</x-dc>'),
]

# --- A-Oynatici: tam ekran oynatıcı (video kenardan kenara, etiketler ve kapatma videonun üstünde, Clone it videonun hemen altında) ----
ROUND = 'width: 44px; height: 44px; border-radius: 999px; border: 0; background: transparent; color: inherit; display: flex; align-items: center; justify-content: center; cursor: pointer'
OYNATICI = [
    ('box-sizing: border-box; padding: 24px; background: var(--bg); color: var(--text); font-family: var(--body); display: flex; align-items: center; justify-content: center">\n'
     '<div role="dialog" aria-labelledby="oy-baslik" style="width: 100%; box-sizing: border-box; padding: 24px; border-radius: 24px; background: var(--surface); '
     'border: 1px solid var(--edge); display: flex; gap: 32px">',
     'box-sizing: border-box; background: var(--bg); color: var(--text); font-family: var(--body); display: flex; align-items: stretch">\n'
     '<div role="dialog" aria-labelledby="oy-baslik" style="position: relative; width: 100%; box-sizing: border-box; background: var(--surface); display: flex; flex-direction: column">'),
    ('<div style="position: relative; flex: 0 0 auto; width: 408px; border-radius: 16px; overflow: hidden; background: var(--bg); box-shadow: 0 0 0 1px var(--media-edge)">',
     '<div style="position: relative; flex: 0 0 auto; width: 100%; overflow: hidden; background: var(--bg); box-shadow: 0 0 0 1px var(--media-edge)">'),
    ('<div style="position: absolute; left: 12px; right: 12px; bottom: 12px;', '<div style="position: absolute; left: 16px; right: 16px; bottom: 16px;'),
    ('<button type="button" aria-label="Full screen" style="' + ROUND + '"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
     'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4"></path></svg></button>\n', ''),
    ('<div style="flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; gap: 24px">',
     '<div style="box-sizing: border-box; padding: 16px 16px 32px; display: flex; flex-direction: column; gap: 24px">'),
    ('<div style="display: flex; flex-direction: column; gap: 12px; min-width: 0">', '<div style="display: flex; flex-direction: column; gap: 8px; min-width: 0">'),
    ('<ul style="margin: 0; padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 8px">',
     '<ul style="position: absolute; top: 24px; left: 16px; right: 72px; margin: 0; padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 8px">'),
    ('<li style="padding: 5px 10px; border-radius: 999px; border: 1px solid var(--edge); font-size: 13px; color: var(--text-2)">',
     '<li style="padding: 5px 10px; border-radius: 999px; background: var(--scrim); color: var(--on-scrim); font-size: 13px; font-weight: 500">'),
    ('font-weight: 800; font-size: 32px; line-height: 1.1; letter-spacing: -0.02em; text-wrap: balance">',
     'font-weight: 700; font-size: 24px; line-height: 1.2; letter-spacing: -0.01em; text-wrap: balance">'),
    ('<button type="button" aria-label="Close" style="flex: 0 0 auto; width: 44px; height: 44px; border-radius: 999px; border: 1px solid var(--edge); background: transparent; color: var(--text);',
     '<button type="button" aria-label="Close" style="position: absolute; top: 16px; right: 16px; width: 44px; height: 44px; border-radius: 999px; border: 0; background: var(--scrim); color: var(--on-scrim);'),
    ('<section aria-label="Shot list" style="display: flex; flex-direction: column; gap: 8px">', '<section aria-label="Shot list" style="order: 1; display: flex; flex-direction: column; gap: 8px">'),
]

YAMA = {
    'A-Form': FORM,
    'A-Form-Hata': FORM,
    'A-Onay': SHEET,
    'A-Onay-Yetersiz': SHEET,
    'A-Is-Takibi': IS_TAKIBI,
    'A-Is-Durdu': IS_DURDU,
    'A-Sonuc': SONUC,
    'A-Sonuc-Varyant': SONUC_VARYANT,
    'A-Karsilastir': KARSILASTIR,
    'A-Oynatici': OYNATICI,
}
