"""Grup 2a (3.3 Gallery and templates) mobil yamaları: yalnız mobil kopyaya (-M, -ML) uygulanır.
Her çift (kaynaktaki tam metin, mobildeki metin). Kaynak değişirse eski metin tutmaz ve variants.py durur."""

WRAP = '<div style="max-width: 1320px; margin: 0 auto; display: flex; flex-direction: column; gap: %s">'
HIDDEN = 'position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%)'

# ---- galeri: üç panoda aynı (Main, yükleniyor, sonuç yok) ----
GALLERY = [
    (WRAP % '48px', WRAP % '24px'),  # telefonda bölüm aralığı
    ('placeholder="Search templates: category, format, product type"', 'placeholder="Search templates"'),  # uzun ipucu kesiliyordu
    # kategori hapları: tek satır, yana kayar, ekran kenarına kadar uzanır
    ('<div style="display: flex; flex-wrap: wrap; gap: 8px">\n<button type="button" aria-pressed="true"',
     '<div style="flex: 1 1 100%; min-width: 0; display: flex; flex-wrap: nowrap; gap: 8px; overflow-x: auto; scrollbar-width: none; '
     'margin: 0 -16px; padding: 0 16px">\n<button type="button" aria-pressed="true"'),
    # biçim anahtarı + sıralama tek satır: anahtar kalan genişliği doldurur, "Sort" yazısı yalnız ekran okuyucuda
    ('<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 12px">\n<div role="group" aria-label="Format" style="display: flex; padding: 4px;',
     '<div style="flex: 1 1 100%; display: flex; align-items: center; gap: 8px">\n<div role="group" aria-label="Format" style="flex: 1 1 auto; display: flex; padding: 4px;'),
    ('style="min-height: 36px; padding: 0 14px;', 'style="flex: 1 1 auto; min-height: 36px; padding: 0 8px;'),
    ('<label style="display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-3)">Sort\n<select',
     '<label style="flex: 0 0 auto; display: flex; align-items: center"><span style="' + HIDDEN + '">Sort</span>\n<select'),
]
ADD_CARD = [('justify-content: center; gap: 12px; padding: 24px; text-align: center', 'justify-content: center; gap: 12px; padding: 16px; text-align: center')]

SKELETON = '''<div aria-hidden="true" style="display: flex; flex-direction: column; gap: 12px; min-width: 0">
<div style="aspect-ratio: 9 / 16; border-radius: 16px; background: var(--surface); box-shadow: 0 0 0 1px var(--media-edge)"></div>
<div style="display: flex; flex-direction: column; gap: 8px">
<span style="height: 12px; width: 80%; border-radius: 999px; background: var(--raised)"></span>
<span style="height: 12px; width: 50%; border-radius: 999px; background: var(--raised)"></span>
</div>
</div>'''

TAG = 'padding: 5px 10px; border-radius: 999px; background: var(--scrim); color: var(--on-scrim); font-size: 13px; font-weight: 500'
FIFTH_CARD = f'''
<article style="display: flex; flex-direction: column; gap: 12px; min-width: 0">
<a href="A-Detay.dc.html" style="position: relative; display: block; aspect-ratio: 9 / 16; border-radius: 16px; overflow: hidden; background: var(--surface); box-shadow: 0 0 0 1px var(--media-edge)">
<img src="/_blob/de5244c861eb9107996b5404d64ca159" alt="" style="width: 100%; height: 100%; object-fit: cover; display: block">
<span style="position: absolute; top: 10px; left: 10px; {TAG}">No talking</span>
<span style="position: absolute; top: 10px; right: 10px; {TAG}">15 sec</span>
</a>
<div style="display: flex; flex-direction: column; gap: 4px">
<h3 style="margin: 0; font-size: 15px; font-weight: 600; line-height: 1.3; color: var(--text); text-wrap: pretty">Shower routine: problem, result, how to use</h3>
<p style="margin: 0; font-size: 13px; line-height: 1.4; color: var(--text-3); text-wrap: pretty">Hair · reference 12.7M views</p>
</div>
</article>'''

# ---- şablon ayrıntısı: video üstte ve küçük, "Clone it" ilk ekranda, açıklama düğmenin altında ----
FIGURE = '<figure style="margin: 0; flex: 1 1 300px; max-width: 400px; display: flex; flex-direction: column; gap: 12px">'
CTA_ROW = '\n</div>\n\n<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 16px 32px">'
LEAD = '<p style="margin: 0; max-width: 620px; font-size: 17px; line-height: 1.5; color: var(--text-2); text-wrap: pretty">%s</p>'
LEAD_DETAY = LEAD % 'First the products side by side with the hook text in the middle. Then, on every beat, one product in hand with a small label. No face, no talking, just music.'
LEAD_OZEL = LEAD % 'Made from the video you added. The structure was read automatically, so look over the shot list before you generate.'


def detail(lead):
    return [
        (WRAP % '32px', WRAP % '8px'),
        ('<main style="display: flex; flex-wrap: wrap; align-items: flex-start; gap: 32px 72px">', '<main style="display: flex; flex-wrap: wrap; align-items: flex-start; gap: 24px">'),
        ('<div style="flex: 2 1 480px; min-width: 0; display: flex; flex-direction: column; gap: 32px">', '<div style="flex: 2 1 480px; min-width: 0; display: flex; flex-direction: column; gap: 24px">'),
        ('\n' + lead + CTA_ROW, CTA_ROW),                       # açıklama başlığın altından çıkar…
        ('</dl>\n</div>\n', '</dl>\n</div>\n' + lead + '\n'),   # …ve ana düğme ile bilgilerin altına iner
        ('style="display: flex; align-items: center; justify-content: center; min-height: 60px; box-sizing: border-box; padding: 0 32px;',
         'style="flex: 1 1 100%; display: flex; align-items: center; justify-content: center; min-height: 60px; box-sizing: border-box; padding: 0 32px;'),
        # çekim satırı: açıklama iki satıra inerse süre ilk satırla hizalı kalır
        ('<div style="flex: 1; min-width: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 16px">',
         '<div style="flex: 1; min-width: 0; display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 16px">'),
    ]


YAMA = {
    'Main': GALLERY + ADD_CARD + [
        ('active: true, ring: on', 'active: false, ring: none'),  # telefonda üzerine gelme hâli yok
    ],
    'A-Galeri-Yukleniyor': GALLERY + ADD_CARD + [
        ('\n'.join([SKELETON] * 9), '\n'.join([SKELETON] * 5)),  # telefonda üç satır iskelet yeter
    ],
    'A-Galeri-Sonuc-Yok': GALLERY + [
        ('border: 1.5px dashed var(--edge-strong); padding: 32px;', 'border: 1.5px dashed var(--edge-strong); padding: 24px;'),
        ('<div style="display: flex; flex-wrap: wrap; gap: 12px">\n<button type="button" style="display: flex;',
         '<div style="flex: 1 1 100%; display: flex; flex-direction: column; gap: 12px">\n<button type="button" style="display: flex;'),
        (FIFTH_CARD, ''),  # iki sütunda tek kalan beşinci kart çıkar
    ],
    'A-Detay': detail(LEAD_DETAY) + [
        # video sahnesi: kart içinde ortalı, genişliğin %60'ı
        (FIGURE, '<figure style="margin: 0; flex: 1 1 100%; box-sizing: border-box; padding: 16px; border-radius: 16px; background: var(--surface); '
                 'border: 1px solid var(--line); display: flex; flex-direction: column; align-items: center; gap: 12px">'),
        ('<div style="position: relative; border-radius: 16px; overflow: hidden; background: var(--surface); box-shadow: 0 0 0 1px var(--media-edge)">',
         '<div style="position: relative; width: 60%; border-radius: 12px; overflow: hidden; background: var(--surface); box-shadow: 0 0 0 1px var(--media-edge)">'),
        ('transform: translate(-50%, -50%); width: 72px; height: 72px;', 'transform: translate(-50%, -50%); width: 60px; height: 60px;'),
        ('<figcaption style="font-size: 13px; line-height: 1.45; color: var(--text-3)">', '<figcaption style="font-size: 13px; line-height: 1.45; color: var(--text-3); text-align: center">'),
    ],
    'A-Detay-Ozel': detail(LEAD_OZEL) + [
        (FIGURE, '<figure style="margin: 0; flex: 1 1 100%; display: flex; flex-direction: column; gap: 12px">'),
        # örnek henüz yok: 9:16 boş kutu yerine kısa bir şerit
        ('<div style="aspect-ratio: 9 / 16; box-sizing: border-box; border-radius: 16px; border: 1.5px dashed var(--edge-strong); display: flex; flex-direction: column; '
         'align-items: center; justify-content: center; gap: 8px; padding: 24px; text-align: center">',
         '<div style="box-sizing: border-box; border-radius: 16px; border: 1.5px dashed var(--edge-strong); display: flex; flex-direction: column; '
         'align-items: center; justify-content: center; gap: 8px; padding: 32px 24px; text-align: center">'),
    ],
    'A-Video-Ekle': [
        (WRAP % '32px', WRAP % '24px'),
        ('padding: 32px 24px; border: 1.5px dashed var(--edge-strong);', 'padding: 24px 16px; border: 1.5px dashed var(--edge-strong);'),
        ('>Drop the file here</span>', '>Upload a video</span>'),  # telefonda sürükle-bırak yok
    ],
}
