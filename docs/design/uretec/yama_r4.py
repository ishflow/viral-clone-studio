"""R4 (form, onay, sonuç) mobil yamaları: 2026-10-04 inceleme turu. Yalnız -M / -ML kopyalara uygulanır (variants.py).
Kaynak metni değişen panoların listesi DEGISTIR ile yenilenir (yama_g2b.py'deki sabitlerden kurulur); yeni panolar YAMA'da.
A-Onay ve A-Onay-Yetersiz kabı değişmedi: yama_g2b.SHEET olduğu gibi geçerli.
Düzeltme turu 2: A-Form-Hata (görsel hatası kutunun hemen altında), A-Sonuc-Varyant (kaynakta video üstten hizalı; karolar arası en az 8 px),
A-Onay-Durumlar ve A-Sonuc-Durumlar (pencereler telefonda A-Onay-M gibi alttan açılan tam genişlik sayfa), A-Sonuc-Durumlar (video yuvası 270 px)."""
from yama_g2b import FORM, SONUC_VARYANT


def swap(pairs, old_start, new_pair):
    """Listede eski metni old_start ile başlayan tek çiftin yerine new_pair koyar."""
    hit = [i for i, (old, _) in enumerate(pairs) if old.startswith(old_start)]
    assert len(hit) == 1, old_start
    return pairs[:hit[0]] + [new_pair] + pairs[hit[0] + 1:]


# --- A-Form / A-Form-Hata: şablon kartı satır olur; altındaki vaat notu kartın içinde tam genişlik iner -------------------------
ASIDE = '<aside aria-label="Selected template" style="flex: 1 1 240px; max-width: 300px; display: flex; flex-direction: column; gap: 12px">'
FORM_R4 = swap(FORM, '<aside aria-label="Selected template"', (
    ASIDE,
    '<aside aria-label="Selected template" style="flex: 1 1 100%; box-sizing: border-box; display: flex; flex-wrap: wrap; align-items: center; gap: 12px 16px; '
    'padding: 12px; border-radius: 16px; background: var(--surface); border: 1px solid var(--line)">')) + [
    ('<div style="display: flex; flex-direction: column; gap: 4px">\n<span style="font-size: 15px; font-weight: 600">Fragrance layering recipe</span>',
     '<div style="flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; gap: 4px">\n<span style="font-size: 15px; font-weight: 600">Fragrance layering recipe</span>'),
    ('<p style="margin: 0; font-size: 13px; line-height: 1.5; color: var(--text-3); text-wrap: pretty">The structure stays the same',
     '<p style="flex: 0 0 100%; margin: 0; font-size: 13px; line-height: 1.5; color: var(--text-3); text-wrap: pretty">The structure stays the same'),
]

# --- A-Form-Hata: "Add at least one image" iletisi telefonda da yükleme kutusunun hemen altında (kaynakta satırın son çocuğu; telefonda alanlar araya giriyordu)
IMG_ERR = ('<sc-if value="{{ p.imgBad }}" hint-placeholder-val="{{ false }}">\n'
           '<p style="flex: 1 1 100%; margin: 0; display: flex; align-items: center; gap: 8px; font-size: 13px; line-height: 1.4; color: var(--warn)">'
           '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
           '<path d="M3.5 12a8.5 8.5 0 1 0 17 0a8.5 8.5 0 1 0 -17 0M12 8v5M12 16.2v.1"></path></svg>Add at least one image of this product.</p>\n</sc-if>\n')
FIELDS = '<div style="flex: 1 1 280px; min-width: 0; display: flex; flex-wrap: wrap; gap: 12px 16px">'
FORM_HATA_R4 = FORM_R4 + [
    ('</sc-if>\n</div>\n' + FIELDS, '</sc-if>\n</div>\n' + IMG_ERR + FIELDS),
    ('</label>\n</div>\n' + IMG_ERR + '</fieldset>', '</label>\n</div>\n</fieldset>'),
]

# --- A-Sonuc-Varyant: düğmeler + saklama notu tek blok; bağlantı satırı tam genişlik (tur 2: kaynakta <main> üstten hizalı) ---------
BTN_OLD = '<div style="display: flex; flex-direction: column; gap: 12px">\n<div style="display: flex; flex-wrap: wrap; gap: 12px">\n<button'
BTN_NEW = '<div style="flex: 0 0 100%; display: flex; flex-direction: column; gap: 12px">\n<div style="display: flex; flex-wrap: wrap; gap: 12px">\n<button'
LINKS = ('<div style="display: flex; flex-wrap: wrap; gap: 4px 24px">\n<a href="A-Karsilastir.dc.html"',
         '<div style="flex: 0 0 100%; display: flex; flex-wrap: wrap; gap: 4px 24px">\n<a href="A-Karsilastir.dc.html"')
MAIN_TOP = '<main style="display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: center; gap: 32px 72px">'
SONUC_VARYANT_R4 = [(MAIN_TOP, new) if old.startswith('<main ') else (old, new)
                    for old, new in swap(SONUC_VARYANT, '<div style="display: flex; flex-wrap: wrap; gap: 12px">\n<button', (BTN_OLD, BTN_NEW))] + [LINKS]
assert sum(old == MAIN_TOP for old, _ in SONUC_VARYANT_R4) == 1
# varyant sütunu videodan uzunsa (320 px; duran varyantın ikinci satırı) karolar birbirine yapışmasın: en az 8 px
COL_OLD = 'display: flex; flex-direction: column; justify-content: space-between">'
SONUC_VARYANT_R4 = [(old, new.replace(COL_OLD, COL_OLD[:-2] + '; gap: 8px">')) if old.startswith('<div role="group" aria-label="Variants"') else (old, new)
                    for old, new in SONUC_VARYANT_R4]
assert sum('justify-content: space-between; gap: 8px">' in new for _, new in SONUC_VARYANT_R4) == 1

# --- A-Sonuc-Varyant-Kismi: aynı düzen; duran varyantın kutusu tam genişlik -------------------------------------------------------
KISMI = SONUC_VARYANT_R4 + [
    ('<section aria-labelledby="durdu-baslik" style="box-sizing: border-box;', '<section aria-labelledby="durdu-baslik" style="flex: 0 0 100%; box-sizing: border-box;'),
]

# --- Durum panolarındaki pencereler: telefonda gerçek pencere gibi (A-Onay-M: tutamak, kenar 16, ekran kenarından kenarına) -------------
# Pano kökünün yan boşluğu telefonda 16 px: -16 px kenar boşluğu pencereyi kenardan kenara taşır; hücre etiketi yerinde kalır.
WIN = ('style="width: 100%; max-width: 592px; box-sizing: border-box; padding: 24px; border-radius: 24px; background: var(--surface); '
       'border: 1px solid var(--edge); display: flex; flex-direction: column; gap: 24px">')
WIN_M = ('style="margin: 0 -16px; box-sizing: border-box; padding: 12px 16px 32px; border-radius: 24px 24px 0 0; background: var(--surface); '
         'border-top: 1px solid var(--edge); display: flex; flex-direction: column; gap: 24px">\n'
         '<span aria-hidden="true" style="align-self: center; width: 44px; height: 4px; border-radius: 999px; background: var(--edge-strong)"></span>')

# --- A-Sonuc-Durumlar: video yuvası telefonda A-Sonuc-M'deki ölçüde (270 px, ortalı) -----------------------------------------------
SONUC_DURUMLAR = [
    (WIN, WIN_M),
    ('align-self: center; width: 100%; max-width: 390px; border-radius: 16px', 'align-self: center; width: 100%; max-width: 270px; border-radius: 16px'),
]

# --- A-Form-Yukleme: kapalı Generate telefonda formdaki gibi tam genişlik ---------------------------------------------------------
YUKLEME = [
    ('<button type="button" aria-disabled="true" style="min-height: 60px; padding: 0 48px;',
     '<button type="button" aria-disabled="true" style="flex: 1 1 100%; box-sizing: border-box; min-height: 60px; padding: 0 48px;'),
]

YAMA = {
    'A-Sonuc-Varyant-Kismi': KISMI,
    'A-Form-Yukleme': YUKLEME,
    'A-Sonuc-Durumlar': SONUC_DURUMLAR,
    'A-Onay-Durumlar': [(WIN, WIN_M)],
}
DEGISTIR = {
    'A-Form': FORM_R4,
    'A-Form-Hata': FORM_HATA_R4,
    'A-Sonuc-Varyant': SONUC_VARYANT_R4,
}
