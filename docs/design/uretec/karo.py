"""7b görsel inceleme karoları: her grubun panolarını okunur boyutta parçalara böler.
D: 1 sütun, doğal genişlik, 800 px dilim · L: 0.694 ölçek, 1100 px dilim · M / ML: 3 sütun, doğal 390, 950 px dilim."""
import os, glob, collections
from PIL import Image, ImageDraw, ImageFont
T = './docs/design/tuval'
os.chdir(T)
F = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', 18)
G = {1: 'A-Ana-Sayfa A-Fiyatlar A-Karsilama A-Yasal A-Yasal-Iade A-Iletisim A-Iletisim-Durumlar A-404 A-Hata-Servis A-Cerez A-Odeme-Basarili A-Odeme-Basarisiz A-Odeme-Dogrulaniyor A-Odeme-Gecikti A-Odeme-Durumlar A-Fatura E-Odeme',
     2: 'A-Giris A-Giris-Durumlar A-Eposta-Dogrula A-Baglanti-Gecersiz A-Sifre-Unuttum A-Sifre-Gonderildi A-Sifre-Yeni A-Sifre-Baglanti-Gecersiz A-Oturum-Bitti A-Hesap-Engelli A-Yetki-Yok A-Hesap A-Hesap-Durumlar A-Hesap-Iade-Onay A-Hesap-Sil A-Hesap-Sil-Durumlar E-Dogrulama E-Sifre',
     3: 'Main A-Galeri-Yukleniyor A-Galeri-Sonuc-Yok A-Galeri-Hata A-Detay A-Detay-Ozel A-Video-Ekle A-Video-Ekle-Durumlar',
     4: 'A-Form A-Form-Hata A-Form-Yukleme A-Onay A-Onay-Yetersiz A-Onay-Durumlar A-Sonuc A-Sonuc-Varyant A-Sonuc-Varyant-Kismi A-Sonuc-Durumlar A-Karsilastir A-Oynatici E-Hazir',
     5: 'A-Is-Takibi A-Is-Kuyrukta A-Is-Durumlar A-Is-Durdu A-Is-Durdu-Onay A-Is-Kapat-Onay A-Is-Kapatildi A-Uretimlerim A-Uretimlerim-Bos A-Uretimlerim-Durumlar E-Durdu',
     6: 'A-Admin-Genel A-Admin-Grafik-Durumlar A-Kullanicilar A-Kullanici-Detay A-Gelir A-Krediler A-Isler A-Admin-Onaylar A-Admin-Islem-Durumlar A-Sablonlar A-Sablon-Duzenle A-Sablon-Ornek-Eski A-Gelen A-Gelen-Bos A-Tarama A-Ayarlar'}
G = {g: s.split() for g, s in G.items()}
G[3] += sorted(os.path.basename(p)[:-8] for p in glob.glob('project/Marka-*.dc.html') if not p[:-8].endswith(('-L', '-M', '-ML')))
G[0] = ['A-Dil-Menusu', 'A-Menu', 'A-Menu-Admin', 'A-Menu-Ziyaretci']
man = {}
for l in open('manifest.tsv'):
    b, v, p = l.strip().split('\t'); man[b] = p
def fresh(b):
    """manifest bayatsa pv-rev* altındaki yeni çizime bak"""
    p = man.get(b)
    if p and p != 'STALE': return p
    for d in ('pv-rev', 'pv-rev-light', 'pv-rev-m'):
        if os.path.exists(f'{d}/{b}.png'): return f'{d}/{b}.png'
VIEWS = {'D': ('', 1.0, 800, 1, 1440), 'L': ('-L', 1000 / 1440, 1100, 1, 1000), 'M': ('-M', 1.0, 950, 3, 390), 'ML': ('-ML', 1.0, 950, 3, 390)}
LAB, OV, GAP = 28, 40, 8
tot = collections.Counter()
for g, boards in sorted(G.items()):
    out = f'pv-7b/g{g}'; os.makedirs(out, exist_ok=True)
    for f in glob.glob(out + '/*'): os.remove(f)
    idx = [f'# Grup {g} karoları\n', 'Karo dosyası · içindeki parçalar (pano · görünüş · parça no / toplam · panodaki y aralığı, px)\n']
    for v, (suf, sc, ch, cols, cw) in VIEWS.items():
        chunks = []
        for b in boards:
            p = fresh(b + suf)
            if not p:
                idx.append(f'- {b}{suf}: bu görünüş yok'); continue
            im = Image.open(p).convert('RGB')
            if sc != 1.0 or im.width > cw:
                k = sc if sc != 1.0 else cw / im.width
                im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
            else: k = 1.0
            ys = list(range(0, max(im.height - OV, 1), ch - OV))
            for i, y in enumerate(ys):
                c = im.crop((0, y, im.width, min(y + ch, im.height)))
                chunks.append((b + suf, i + 1, len(ys), round(y / k), round(min(y + ch, im.height) / k), c))
        for n in range(0, len(chunks), cols):
            grp = chunks[n:n + cols]
            W = cols * cw + (cols - 1) * GAP; H = LAB + max(c[5].height for c in grp)
            sheet = Image.new('RGB', (W, H), (96, 96, 96)); d = ImageDraw.Draw(sheet)
            names = []
            for j, (b, i, m, y0, y1, c) in enumerate(grp):
                x = j * (cw + GAP)
                d.rectangle((x, 0, x + cw, LAB), fill=(20, 20, 20))
                d.text((x + 6, 4), f'{b}  {i}/{m}  y {y0}-{y1}', font=F, fill=(255, 255, 255))
                sheet.paste(c, (x, LAB)); names.append(f'{b} {i}/{m} y {y0}-{y1}')
            fn = f'{v}-{n // cols + 1:02d}.png'; sheet.save(f'{out}/{fn}'); tot[(g, v)] += 1
            idx.append(f'- `{fn}` · ' + ' | '.join(names))
    open(f'{out}/index.md', 'w').write('\n'.join(idx) + '\n')
for g in sorted(G):
    print(g, len(G[g]), 'pano', {v: tot[(g, v)] for v in VIEWS}, 'toplam', sum(tot[(g, v)] for v in VIEWS))
