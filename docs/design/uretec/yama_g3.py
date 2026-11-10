"""Grup 3 mobil yamaları: 3.5 My videos · 3.6 Credits and account · 3.7 Emails.
Yalnız -M / -ML kopyalara uygulanır (variants.py). Eski metin kaynakta birebir geçmeli.
Kaynakta akışkan çözülenler burada yok: süzgeç tam genişlik + yana kayma, satır sütunlarının alt alta inmesi,
bakiye göstergesi (clamp), e-posta kenar boşlukları (clamp), anahtar / değer satırlarının iki satıra inmesi."""

STRETCH = [('align-self: flex-start', 'align-self: stretch')]  # e-postada tek düğme: telefonda tam genişlik

LOGOUT_SRC = '''<div style="margin-top: auto; display: flex; flex-wrap: wrap; gap: 8px 24px; padding-top: 16px; border-top: 1px solid var(--line)">
<a href="A-Giris.dc.html" style="display: flex; align-items: center; min-height: 44px; color: var(--text); font-size: 15px; text-decoration: none">Log out</a>
<a href="A-Hesap-Sil.dc.html" style="display: flex; align-items: center; min-height: 44px; color: var(--warn); font-size: 15px; text-decoration: none">Delete account</a>
</div>
</section>
'''
LOGOUT_M = '''</section>

<div style="order: 2; display: flex; flex-direction: column; gap: 8px; padding-top: 8px">
<a href="A-Giris.dc.html" style="box-sizing: border-box; display: flex; align-items: center; justify-content: center; min-height: 52px; padding: 0 24px; border-radius: 12px; border: 1px solid var(--edge-strong); color: var(--text); font-size: 15px; font-weight: 600; text-decoration: none">Log out</a>
<a href="A-Hesap-Sil.dc.html" style="display: flex; align-items: center; justify-content: center; min-height: 44px; color: var(--warn); font-size: 15px; font-weight: 500; text-decoration: none">Delete account</a>
</div>
'''

YAMA = {
    # Liste satırı telefonda kart: küçük görsel + başlık + durum, altında tam genişlik eylem düğmesi.
    'A-Uretimlerim': [
        ('<main style="display: flex; flex-direction: column">', '<main style="display: flex; flex-direction: column; gap: 12px">'),
        ('<article style="display: flex; flex-wrap: wrap; align-items: center; gap: 16px 24px; padding: 16px 0; border-top: 1px solid var(--line)">',
         '<article style="display: flex; flex-wrap: wrap; align-items: flex-start; gap: 16px; box-sizing: border-box; padding: 16px; border-radius: 16px; background: var(--surface); border: 1px solid var(--line)">'),
        ('<h2 style="margin: 0; font-size: 20px; font-weight: 600; line-height: 1.25; text-wrap: pretty">',
         '<h2 style="margin: 0; font-size: 17px; font-weight: 600; line-height: 1.25; text-wrap: pretty">'),
    ],
    'A-Uretimlerim-Bos': [
        ('font-size: 17px">Browse the gallery</a>', 'font-size: 17px; align-self: stretch">Browse the gallery</a>'),
    ],
    # Sıra: bakiye, kredi hareketleri, faturalar, profil; çıkış ve hesap silme en altta ayrı blok.
    'A-Hesap': [
        ('style="margin-top: auto; align-self: flex-start; box-sizing: border-box; display: flex;', 'style="align-self: stretch; box-sizing: border-box; display: flex;'),
        ('<section aria-labelledby="h-profil" style="box-sizing: border-box;', '<section aria-labelledby="h-profil" style="order: 1; box-sizing: border-box;'),
        ('<button type="button" style="align-self: flex-start; min-height: 52px;', '<button type="button" style="align-self: stretch; min-height: 52px;'),
        (LOGOUT_SRC, LOGOUT_M),
    ],
    # Pencere telefonda alttan açılan sayfa: tam genişlik, üst köşeler yuvarlak, tutamak, kenar boşluğu 16.
    'A-Hesap-Sil': [
        ('box-sizing: border-box; padding: 24px; background: var(--bg); color: var(--text); font-family: var(--body); display: flex; align-items: center; justify-content: center">',
         'box-sizing: border-box; padding: 48px 0 0; background: var(--bg); color: var(--text); font-family: var(--body); display: flex; align-items: flex-end; justify-content: center">'),
        ('style="width: 100%; box-sizing: border-box; padding: 24px; border-radius: 24px; background: var(--surface); border: 1px solid var(--edge); display: flex; flex-direction: column; gap: 24px">',
         'style="width: 100%; box-sizing: border-box; padding: 12px 16px 32px; border-radius: 24px 24px 0 0; background: var(--surface); border-top: 1px solid var(--edge); display: flex; flex-direction: column; gap: 24px">\n'
         '<span aria-hidden="true" style="align-self: center; width: 48px; height: 4px; border-radius: 999px; background: var(--edge-strong)"></span>'),
    ],
    'A-Odeme-Basarili': [
        ('<div style="display: flex; flex-wrap: wrap; gap: 12px">', '<div style="display: flex; flex-direction: column; gap: 12px">'),
    ],
    'E-Dogrulama': STRETCH,
    'E-Sifre': STRETCH,
    'E-Hazir': STRETCH,
    'E-Durdu': STRETCH,
    'E-Odeme': STRETCH,
}
