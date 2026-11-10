"""İnceleme turu, grup R3 (3.3 Gallery and templates) mobil yamaları: yalnız mobil kopyaya (-M, -ML) uygulanır.
Kaynakta değişenler (44 px'lik biçim anahtarı, Free etiketi, kendi şablonundaki hak satırı) yama_g2a.py'deki eski
metinlerle artık eşleşmediği için o panoların listesi DEGISTIR ile baştan verilir; yeni panolar YAMA'dadır.
Değişmeyen çiftler yama_g2a'dan içe aktarılır (o dosyaya dokunulmaz)."""
from yama_g2a import ADD_CARD, FIGURE, HIDDEN, LEAD_OZEL, SKELETON, TAG, WRAP, YAMA as G2A

# ---- galeri: dört panoda aynı (Main, yükleniyor, sonuç yok, yüklenemedi) ----
GALLERY = [
    (WRAP % '48px', WRAP % '24px'),  # telefonda bölüm aralığı
    ('placeholder="Search templates: category, format, product type"', 'placeholder="Search templates"'),  # uzun ipucu kesiliyordu
    # kategori hapları: tek satır, yana kayar, ekran kenarına kadar uzanır
    ('<div style="display: flex; flex-wrap: wrap; gap: 8px">\n<button type="button" aria-pressed="true"',
     '<div style="flex: 1 1 100%; min-width: 0; display: flex; flex-wrap: nowrap; gap: 8px; overflow-x: auto; scrollbar-width: none; '
     'margin: 0 -16px; padding: 0 16px">\n<button type="button" aria-pressed="true"'),
    # biçim anahtarı + sıralama tek satır: anahtar kalan genişliği doldurur, "Sort" yazısı yalnız ekran okuyucuda.
    # Anahtarın her seçeneği 44 px yüksek (dokunma hedefi); görünen hap 36 px.
    # Dar ekranda (ikisi yan yana sığmayınca, ör. 320 px) satır ikiye bölünür: anahtar üstte, sıralama altta, ikisi de tam genişlik (R7).
    ('<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 12px">\n<div role="group" aria-label="Format" style="display: flex; padding: 0 4px;',
     '<div style="flex: 1 1 100%; display: flex; flex-wrap: wrap; align-items: center; gap: 8px">\n<div role="group" aria-label="Format" style="flex: 999 1 auto; display: flex; padding: 0 4px;'),
    ('style="display: flex; min-height: 44px; box-sizing: border-box; padding: 4px 0; border: 0;',
     'style="flex: 1 1 auto; display: flex; min-height: 44px; box-sizing: border-box; padding: 4px 0; border: 0;'),
    ('justify-content: center; padding: 0 14px; border-radius: 999px; white-space: nowrap',
     'justify-content: center; padding: 0 8px; border-radius: 999px; white-space: nowrap'),
    ('<label style="display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-3)">Sort\n<select',
     '<label style="flex: 1 0 auto; display: flex; align-items: center"><span style="' + HIDDEN + '">Sort</span>\n<select'),
    ('<select style="min-height: 44px; padding: 0 12px;', '<select style="flex: 1 1 auto; min-width: 0; min-height: 44px; padding: 0 12px;'),
]

FREE = TAG.replace('color: var(--on-scrim)', 'color: var(--accent)')
FIFTH_CARD = f'''
<article style="display: flex; flex-direction: column; gap: 12px; min-width: 0">
<a href="A-Detay.dc.html" style="position: relative; display: block; aspect-ratio: 9 / 16; border-radius: 16px; overflow: hidden; background: var(--surface); box-shadow: 0 0 0 1px var(--media-edge)">
<img src="/_blob/de5244c861eb9107996b5404d64ca159" alt="" style="width: 100%; height: 100%; object-fit: cover; display: block">
<span style="position: absolute; top: 10px; left: 10px; right: 10px">
<span style="float: left; margin-bottom: 7px; {TAG}">No talking</span>
<span style="float: right; margin-bottom: 7px; {TAG}">15 sec</span>
<span style="float: left; clear: left; {FREE}">Free</span>
</span>
</a>
<div style="display: flex; flex-direction: column; gap: 4px">
<h3 style="margin: 0; font-size: 15px; font-weight: 600; line-height: 1.3; color: var(--text); text-wrap: pretty">Shower routine: problem, result, how to use</h3>
<p style="margin: 0; font-size: 13px; line-height: 1.4; color: var(--text-3); text-wrap: pretty">Hair · reference 12.7M views</p>
</div>
</article>'''

# "Free with your first video" satırı: masaüstünde düğme satırının altında (order: 1), telefonda ana düğmenin hemen altında
FREE_LINE = ('style="order: 1; flex: 1 1 100%; display: flex; align-items: center; gap: 8px;', 'style="flex: 1 1 100%; display: flex; align-items: center; gap: 8px;')

# ---- şablon ayrıntısı · kendi şablonu: hak satırı düğme satırının içinde olduğu için açıklamanın ineceği yer değişti ----
OZEL = [p for p in G2A['A-Detay-Ozel'] if p[0] != '</dl>\n</div>\n']
assert len(OZEL) == len(G2A['A-Detay-Ozel']) - 1
OZEL.insert(4, ('as a reference.</p>\n</div>\n', 'as a reference.</p>\n</div>\n' + LEAD_OZEL + '\n'))  # açıklama düğme ve hak satırının altına iner
OZEL.append(FREE_LINE)
# örnek henüz yok: telefonda da 9:16 boş çerçeve (A-Detay-M'deki video gibi kart içinde ortalı, genişliğin %60'ı); eski kısa şerit kalktı
BOX = ('<div style="aspect-ratio: 9 / 16; box-sizing: border-box; border-radius: 16px; border: 1.5px dashed var(--edge-strong); display: flex; flex-direction: column; '
       'align-items: center; justify-content: center; gap: 8px; padding: 24px; text-align: center">')
OZEL = [p for p in OZEL if p[0] not in (FIGURE, BOX)]
assert len(OZEL) == len(G2A['A-Detay-Ozel']) - 1
OZEL += [
    (FIGURE, dict(G2A['A-Detay'])[FIGURE]),
    (BOX, BOX.replace('aspect-ratio: 9 / 16;', 'width: 60%; aspect-ratio: 9 / 16;').replace('border-radius: 16px;', 'border-radius: 12px;').replace('padding: 24px;', 'padding: 16px;')),
    ('<figcaption style="font-size: 13px; line-height: 1.45; color: var(--text-3)">', '<figcaption style="font-size: 13px; line-height: 1.45; color: var(--text-3); text-align: center">'),
]

DEGISTIR = {
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
    'A-Detay-Ozel': OZEL,
}

YAMA = {
    # eski yamalar (yama_g2a) aynen geçerli; ek: "Free with your first video" satırı telefonda ana düğmenin hemen altında kalır
    'A-Detay': [FREE_LINE],
    'A-Galeri-Hata': GALLERY,
    'A-Video-Ekle-Durumlar': [
        ('>Drop the file here</span>', '>Upload a video</span>'),  # telefonda sürükle-bırak yok (A-Video-Ekle ile aynı)
    ],
}
