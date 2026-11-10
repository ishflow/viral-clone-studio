"""İnceleme turu · Görev 2 (R2 Hesap erişimi ve hesap) mobil yamaları: yalnız -M / -ML kopyalara uygulanır (variants.py).
Giriş düzenindeki dört yeni sayfa, mevcut beş giriş panosuyla aynı yamayı kullanır (yama_g1.AUTH): form üstte, görsel
panel sayfanın altında kısa marka şeridi. A-Yetki-Yok, A-404 ile aynı düzen: düğme telefonda tam genişlik.
Pencere panoları (A-Hesap-Sil, A-Hesap-Iade-Onay) telefonda alttan açılan tam genişlik sayfa; düğmeler kaynakta alt alta iner.
Durum panolarında hücreler kaynakta akışkan (kendiliğinden alt alta iner); yama yalnız gerçek telefon sayfasının ölçüsü için.

Düzeltme turu 2: A-Hesap masaüstünde iki sütun oldu (kaynak değişti) → yaması DEGISTIR ile yenilendi; pencere sayfasının
üst boşluğu 48 → 24 px (A-Onay-M ile tek değer) → A-Hesap-Sil yaması DEGISTIR ile yenilendi."""
from yama_g1 import AUTH, YAMA as _G1
from yama_g3 import YAMA as _G3

# Pencere telefonda alttan açılan sayfa: yama_g3'teki A-Hesap-Sil yaması, üstteki boşluk 24 px.
SHEET = [(old, new.replace('padding: 48px 0 0;', 'padding: 24px 0 0;')) for old, new in _G3['A-Hesap-Sil']]
assert sum('padding: 24px 0 0;' in new for _, new in SHEET) == 1

STRETCH_BUY = ('style="align-self: flex-start; box-sizing: border-box; display: flex;', 'style="align-self: stretch; box-sizing: border-box; display: flex;')
STRETCH_SAVE = ('<button type="button" style="align-self: flex-start; min-height: 52px;', '<button type="button" style="align-self: stretch; min-height: 52px;')

# A-Hesap: telefonda tek sütun; sıra bakiye, kredi hareketleri, satın almalar, profil; çıkış ve hesap silme en altta ayrı blok.
# Masaüstündeki iki sütun kabı telefonda yok sayılır (display: contents) ki sıra kartlar arasında kurulabilsin.
HESAP = [
    ('<main style="display: flex; flex-wrap: wrap; align-items: flex-start; gap: 24px">', '<main style="display: flex; flex-direction: column; gap: 24px">'),
    ('<div style="flex: 1 1 420px; min-width: 0; display: flex; flex-direction: column; gap: 24px">', '<div style="display: contents">'),
    STRETCH_BUY,
    ('<section aria-labelledby="h-profil" style="box-sizing: border-box;', '<section aria-labelledby="h-profil" style="order: 1; box-sizing: border-box;'),
    STRETCH_SAVE,
    ('<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px 24px">\n<a href="A-Giris.dc.html"',
     '<div style="order: 2; display: flex; flex-direction: column; gap: 8px; padding-top: 8px">\n<a href="A-Giris.dc.html"'),
]

# Durum hücresindeki silme penceresi telefonda gerçek sayfanın (A-Hesap-Sil-M) ölçüsünde: kenardan kenara, 16 px iç boşluk, tutamak.
SIL_HUCRE = [
    ('style="width: 100%; max-width: 592px; box-sizing: border-box; padding: 24px; border-radius: 24px; background: var(--surface); border: 1px solid var(--edge); display: flex; flex-direction: column; gap: 24px">',
     'style="margin: 0 -16px; box-sizing: border-box; padding: 12px 16px 32px; border-radius: 24px 24px 0 0; background: var(--surface); border-top: 1px solid var(--edge); display: flex; flex-direction: column; gap: 24px">\n'
     '<span aria-hidden="true" style="align-self: center; width: 48px; height: 4px; border-radius: 999px; background: var(--edge-strong)"></span>'),
]

YAMA = {
    'A-Baglanti-Gecersiz': AUTH,
    'A-Sifre-Baglanti-Gecersiz': AUTH,
    'A-Oturum-Bitti': AUTH,
    'A-Hesap-Engelli': AUTH,
    'A-Yetki-Yok': _G1['A-404'],
    'A-Hesap-Iade-Onay': SHEET,  # pencere telefonda alttan açılan sayfa (A-Hesap-Sil ile aynı kap)
    # Durum hücrelerindeki düğmeler gerçek telefon sayfasındaki (A-Hesap-M) gibi tam genişlik; "Saved." satırı düğmenin altına iner.
    'A-Hesap-Durumlar': [
        STRETCH_SAVE,
        ('<button type="button" style="min-height: 52px; padding: 0 24px;', '<button type="button" style="flex: 1 1 100%; min-height: 52px; padding: 0 24px;'),
        STRETCH_BUY,
    ],
    'A-Hesap-Sil-Durumlar': SIL_HUCRE,
}

DEGISTIR = {
    'A-Hesap': HESAP,
    'A-Hesap-Sil': SHEET,
}
