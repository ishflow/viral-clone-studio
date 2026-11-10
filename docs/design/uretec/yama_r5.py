"""İnceleme turu, grup R5 (iş ve videolarım) mobil yamaları. Yalnız -M / -ML kopyalara uygulanır (variants.py).
Eski metin kaynakta birebir geçmeli. Mevcut panoların eski yamaları (yama_g2b: A-Is-Takibi, A-Is-Durdu; yama_g3: A-Uretimlerim,
A-Uretimlerim-Bos, E-Durdu) kaynakta aradıkları metin değişmediği için hâlâ eşleşiyor: DEGISTIR gerekmedi.
Düzeltme turu 2: A-Video-Sil-Onay eklendi; A-Is-Durumlar, A-Is-Kapatildi ve A-Uretimlerim-Durumlar yamaları yeni kaynağa göre yenilendi;
A-Uretimlerim için yeni yama gerekmedi (Delete bağlantısı durum bloğunun sağ ucunda, kaynakta akışkan)."""
from yama_g2b import SHEET
from yama_g3 import YAMA as _G3

# Durum panosundaki pencere hücresi: telefonda pencerenin iç boşluğu 16 (gerçek pencere telefonda alttan açılan sayfa, kenar 16).
PENCERE = ('max-width: 592px; box-sizing: border-box; padding: 24px; border-radius: 24px;',
           'max-width: 592px; box-sizing: border-box; padding: 16px; border-radius: 24px;')

YAMA = {
    # Kuyruk kartı adımların üstünde (A-Is-Durdu'daki seçenek kartı gibi), iç boşluk 16.
    'A-Is-Kuyrukta': [
        ('<section aria-label="Queue" style="flex: 1 1 480px; min-width: 0; box-sizing: border-box; padding: 24px;',
         '<section aria-label="Queue" style="order: -1; flex: 1 1 480px; min-width: 0; box-sizing: border-box; padding: 16px;'),
    ],
    # Pencereler telefonda alttan açılan sayfa: A-Onay ile aynı kap, aynı yama.
    'A-Is-Durdu-Onay': SHEET,
    'A-Is-Kapat-Onay': SHEET,
    'A-Video-Sil-Onay': SHEET,
    # Kartların iç boşluğu telefonda 16 (A-Is-Durdu'daki gibi); karttaki tek düğme tam genişlik; süre yuvası telefondaki boyda (24);
    # pencere hücreleri: iç boşluk 16.
    'A-Is-Durumlar': [
        ('style="box-sizing: border-box; padding: 24px; border-radius: 16px; background: var(--surface);',
         'style="box-sizing: border-box; padding: 16px; border-radius: 16px; background: var(--surface);'),
        ('align-self: flex-start">Contact support</a>', 'align-self: stretch">Contact support</a>'),
        ('align-self: flex-start">Pick another template</a>', 'align-self: stretch">Pick another template</a>'),
        ('font-size: 32px; line-height: 1.1; color: var(--text)">Taking longer than usual</strong>',
         'font-size: 24px; line-height: 1.1; color: var(--text)">Taking longer than usual</strong>'),
        PENCERE,
    ],
    # Tek sütun: ileti, özet satırları, en altta tam genişlik düğme; kart iç boşluğu 16.
    'A-Is-Kapatildi': [
        ('<section aria-label="Job closed" style="box-sizing: border-box; padding: 24px; border-radius: 16px; background: var(--surface); border: 1px solid var(--line); '
         'display: flex; flex-wrap: wrap; align-items: flex-start; gap: 24px 48px">',
         '<section aria-label="Job closed" style="box-sizing: border-box; padding: 16px; border-radius: 16px; background: var(--surface); border: 1px solid var(--line); '
         'display: flex; flex-direction: column; gap: 24px">'),
        ('<div style="flex: 1 1 420px; min-width: 0; display: flex; flex-direction: column; gap: 24px">', '<div style="display: contents">'),
        ('<div style="flex: 1 1 480px; min-width: 0; display: flex; flex-direction: column; gap: 12px">', '<div style="display: flex; flex-direction: column; gap: 12px">'),
        ('align-self: flex-start">Pick another template</a>', 'order: 1; align-self: stretch">Pick another template</a>'),
    ],
    # Satırlar telefonda My videos'taki gibi kart (A-Uretimlerim yamasının satır kısmı; başlık burada h3); boş hâlin düğmesi tam genişlik.
    'A-Uretimlerim-Durumlar': [
        _G3['A-Uretimlerim'][1],
        ('<h3 style="margin: 0; font-size: 20px; font-weight: 600; line-height: 1.25; text-wrap: pretty">',
         '<h3 style="margin: 0; font-size: 17px; font-weight: 600; line-height: 1.25; text-wrap: pretty">'),
        ('font-size: 17px">Pick a template</a>', 'font-size: 17px; align-self: stretch">Pick a template</a>'),
        PENCERE,
    ],
}
