"""R1 (inceleme turu 2026-10-04) mobil yamaları: satın alma ve pazarlama grubu. Yalnız -M / -ML kopyalara uygulanır (variants.py).
Mevcut panoların eski yamaları (yama_g1, yama_g3) kaynakta hâlâ birebir eşleşiyor; burada yalnız yeni panolar ve yeni eklenen
düğmeler var. Durum panolarında hücreler kendiliğinden alt alta iner (flex-wrap); yama yalnız düğmeleri tam genişlik yapar."""
from yama_g1 import YAMA as G1
from yama_g3 import YAMA as G3

STRETCH = [('align-self: flex-start', 'align-self: stretch')]  # tek düğme: telefonda tam genişlik
# alt bilgi bağlantıları telefonda 3 + 3 (düzeltme turu 2: 5 + 1 kırılıyordu, "Contact" tek başına ikinci satırdaydı)
FOOT = [
    ('<nav aria-label="Footer menu" style="display: flex; flex-wrap: wrap; gap: 4px 24px">',
     '<nav aria-label="Footer menu" style="flex: 1 1 100%; display: grid; grid-template-columns: repeat(3, auto); justify-content: start; gap: 4px 24px">'),
]

YAMA = {
    # belge listesi telefonda yana kayan sekme sırası (A-Yasal ile aynı yama)
    'A-Yasal-Iade': G1['A-Yasal'] + FOOT,
    # iki düğme alt alta, tam genişlik (A-404-M ile aynı duruş)
    'A-Hata-Servis': [
        ('<div style="display: flex; flex-wrap: wrap; justify-content: center; gap: 12px">',
         '<div style="align-self: stretch; display: flex; flex-direction: column; gap: 12px">'),
    ],
    'A-Odeme-Gecikti': G3['A-Odeme-Basarili'] + STRETCH,
    'A-Odeme-Basarisiz': STRETCH,
    'A-Iletisim-Durumlar': STRETCH,
    # düzeltme turu 2: hücreler gerçek sayfanın düzeninde; tek düğmeler telefonda tam genişlik (A-Odeme-Basarisiz, A-Odeme-Gecikti ile aynı)
    'A-Odeme-Durumlar': STRETCH,
    # mevcut panoların yama_g1 listesine eklenir (variants.py aynı adın yamalarını birleştirir)
    'A-Ana-Sayfa': FOOT,
    'A-Fiyatlar': FOOT,
    'A-Yasal': FOOT,
    'A-Iletisim': FOOT,
}
