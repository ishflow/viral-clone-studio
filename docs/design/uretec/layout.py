"""Tuvalin tüm yerleşimi tek yerde: sayfalar (1 Logo study, 2 Branding, 3 Website, 4 Website light, 5 Mobile dark,
6 Mobile light, arşiv), bölümler ve pano sırası. 4–6. sayfalar 3. sayfanın türevleridir (variants.py): aynı bölümler, aynı sıra.
Her çalıştırmada canvas.json'daki x, y, başlık, sayfa ve bölüm başlıkları buradan yeniden hesaplanır; dosyası henüz
olmayan panolar atlanır (satırlar çizildikçe yeniden çalıştır). Genişlik ve yükseklik pano dosyasındaki $preview'dan okunur."""
import json, os, re
from parts import P

PATH = os.path.join(P, 'canvas.json')
GAP_X, TITLE_TO_ROW, ROW_TO_TITLE = 80, 300, 200

WEB = [  # sayfa "a" = 3 · Website; sıra müşterinin yolu
    ('s31', '3.1 · Home and sign-up', [
        ('A-Ana-Sayfa', 'Home'), ('A-Fiyatlar', 'Pricing'), ('A-Giris', 'Log in and sign up'), ('A-Yasal', 'Legal page'),
        ('A-Iletisim', 'Contact and support'), ('A-404', '404'), ('A-Cerez', 'Cookie notice'), ('A-Dil-Menusu', 'Language menu'),
        ('A-Menu-Ziyaretci', 'Menu · visitor'),
        ('A-Yasal-Iade', 'Legal page · refund policy'), ('A-Iletisim-Durumlar', 'Contact and support · states'),
        ('A-Hata-Servis', 'Service unavailable')]),
    ('s32', '3.2 · Account access', [
        ('A-Eposta-Dogrula', 'Verify your email'), ('A-Karsilama', 'Welcome · first video free'), ('A-Sifre-Unuttum', 'Forgot password'),
        ('A-Sifre-Gonderildi', 'Reset link sent'), ('A-Sifre-Yeni', 'New password'),
        ('A-Giris-Durumlar', 'Log in and sign up · states'), ('A-Baglanti-Gecersiz', 'Verify link expired'),
        ('A-Sifre-Baglanti-Gecersiz', 'Reset link expired'), ('A-Oturum-Bitti', 'Session expired'),
        ('A-Hesap-Engelli', 'Account blocked'), ('A-Yetki-Yok', 'No access')]),
    ('s33', '3.3 · Gallery and templates', [
        ('Main', 'Gallery'), ('A-Menu', 'Menu · signed in'), ('A-Galeri-Yukleniyor', 'Gallery · loading'), ('A-Galeri-Sonuc-Yok', 'Gallery · no results'),
        ('A-Detay', 'Template detail'), ('A-Detay-Ozel', 'Template detail · your own template'), ('A-Video-Ekle', 'Add your own video'),
        ('A-Galeri-Hata', 'Gallery · could not load'), ('A-Video-Ekle-Durumlar', 'Add your own video · states')]),
    ('s34', '3.4 · Generate a video', [
        ('A-Form', 'Generate form'), ('A-Form-Hata', 'Generate form · errors'), ('A-Onay', 'Credit confirmation'),
        ('A-Onay-Yetersiz', 'Credit confirmation · not enough credits'), ('A-Is-Takibi', 'Job progress'), ('A-Is-Durdu', 'Job progress · stopped'),
        ('A-Sonuc', 'Result'), ('A-Sonuc-Varyant', 'Result · several variants'), ('A-Karsilastir', 'Compare side by side'),
        ('A-Oynatici', 'Video player'),
        ('A-Form-Yukleme', 'Generate form · upload states'), ('A-Onay-Durumlar', 'Credit confirmation · states'),
        ('A-Is-Kuyrukta', 'Job progress · in queue'), ('A-Is-Durumlar', 'Job progress · states'),
        ('A-Is-Durdu-Onay', 'Job stopped · confirm to continue'), ('A-Is-Kapat-Onay', 'Job stopped · confirm to close'),
        ('A-Is-Kapatildi', 'Job stopped · closed'),
        ('A-Sonuc-Varyant-Kismi', 'Result · some variants ready'), ('A-Sonuc-Durumlar', 'Result · states')]),
    ('s35', '3.5 · My videos', [('A-Uretimlerim', 'My videos'), ('A-Uretimlerim-Bos', 'My videos · empty'),
                              ('A-Uretimlerim-Durumlar', 'My videos · states'),
                              ('A-Video-Sil-Onay', 'My videos · confirm to delete')]),
    ('s36', '3.6 · Credits and account', [
        ('A-Hesap', 'Account'), ('A-Hesap-Sil', 'Delete account confirmation'), ('A-Odeme-Basarili', 'Payment received'),
        ('A-Fatura', 'Invoice (PDF)'), ('A-Odeme-Basarisiz', 'Payment declined'),
        ('A-Odeme-Dogrulaniyor', 'Payment · confirming'), ('A-Odeme-Gecikti', 'Payment · taking longer'),
        ('A-Odeme-Durumlar', 'Payment · cancelled and expired'), ('A-Hesap-Durumlar', 'Account · states'),
        ('A-Hesap-Iade-Onay', 'Account · confirm refund request'),
        ('A-Hesap-Sil-Durumlar', 'Delete account · states')]),
    ('s37', '3.7 · Emails', [
        ('E-Dogrulama', 'Email · verify your address'), ('E-Sifre', 'Email · reset password'), ('E-Hazir', 'Email · your video is ready'),
        ('E-Durdu', 'Email · job stopped'), ('E-Odeme', 'Email · payment received')]),
    ('s38', '3.8 · Admin', [
        ('A-Admin-Genel', 'Admin · overview'), ('A-Menu-Admin', 'Menu · admin'), ('A-Kullanicilar', 'Admin · users'),
        ('A-Kullanici-Detay', 'Admin · user detail'), ('A-Gelir', 'Admin · revenue'), ('A-Krediler', 'Admin · credits'),
        ('A-Isler', 'Admin · jobs'), ('A-Sablonlar', 'Admin · templates'), ('A-Gelen', 'Admin · template inbox'),
        ('A-Gelen-Bos', 'Admin · template inbox, empty'), ('A-Sablon-Duzenle', 'Admin · edit template'),
        ('A-Tarama', 'Admin · scan history'), ('A-Ayarlar', 'Admin · settings'),
        ('A-Admin-Onaylar', 'Admin · action confirmations'), ('A-Admin-Islem-Durumlar', 'Admin · action states'),
        ('A-Admin-Grafik-Durumlar', 'Admin · chart states'), ('A-Sablon-Ornek-Eski', 'Admin · edit template, sample out of date')]),
]
BRAND = [  # sayfa "marka" = 2 · Branding
    ('m21', '2.1 · Foundations', [
        ('Marka-Oz', 'Brand essence'), ('Marka-Logo', 'Logo and wordmark'), ('Marka-Ses', 'Voice and tone'),
        ('Marka-Renk', 'Color: dark and light'), ('Marka-Yazi', 'Typography'), ('Marka-Olcu', 'Spacing, radius, grid')]),
    ('m22', '2.2 · Components and rules', [
        ('Marka-Bilesen-1', 'Components: controls'), ('Marka-Bilesen-2', 'Components: cards and states'),
        ('Marka-Bilesen-3', 'Components: tables, panel, phone'), ('Marka-Ikonlar', 'Icon library'),
        ('Marka-Hareket', 'Motion'), ('Marka-Gorsel-Kurallar', "Imagery, do and don't"),
        ('Marka-Bilesen-4', 'Components: messages and money')]),
]
VARIANTS = [  # (sayfa kimliği, sayfa adı, dosya eki, bölüm numarası): 3. sayfa kaynak, diğerleri variants.py'nin ürettiği kopyalar
    ('a', '3 · Website', '', '3'), ('a-light', '4 · Website · Light', '-L', '4'),
    ('m-dark', '5 · Mobile · Dark', '-M', '5'), ('m-light', '6 · Mobile · Light', '-ML', '6')]
PAGES = ([{"id": "logo", "name": "1 · Logo study"}, {"id": "marka", "name": "2 · Branding"}]
         + [{"id": pid, "name": pname} for pid, pname, _, _ in VARIANTS]
         + [{"id": "yonler", "name": "Archive · Other directions"}])
OLD_NOTES = ['akis', 'satis', 'yonetim', 'satin-alma', 'hesap', 'marka']  # eski satır başlıkları


def size(name):
    s = open(os.path.join(P, name), encoding='utf-8').read()
    pv = json.loads(re.search(r"data-props='([^']*)'", s).group(1))['$preview']
    return pv['width'], pv['height']


def place(c, page, sections, suffix='', number=None):
    """suffix: türev eki ('-L', '-M', '-ML'); number: bölüm başlığındaki sayfa numarası ('3.1' → '4.1')."""
    y = -TITLE_TO_ROW
    placed = set()
    for note_id, text, boards in sections:
        if suffix:
            note_id, text = note_id + suffix, number + text[1:]
        x, bottom = 0, 0
        for stem, title in boards:
            name = stem + suffix + '.dc.html'
            local = os.path.exists(os.path.join(P, name))
            if not local and name not in c['boards']:
                continue  # henüz çizilmedi
            w, h = size(name) if local else (c['boards'][name]['w'], c['boards'][name]['h'])
            src = c['boards'].get(stem + '.dc.html', {})
            fresh = {"expand": "fill"} if w >= 1280 and stem.startswith(('A-', 'Main')) else {}
            if suffix and src.get('is_interactive'):
                fresh["is_interactive"] = True
            e = c['boards'].setdefault(name, fresh)
            e.update({"x": x, "y": y + TITLE_TO_ROW, "w": w, "h": h, "title": title, "page": page})
            if name not in c['order']:
                c['order'].append(name)
            placed.add(name)
            x += w + GAP_X
            bottom = max(bottom, y + TITLE_TO_ROW + h)
        if not x:
            continue
        c['notes'][note_id] = {"kind": "title1", "maxW": min(max(x - GAP_X, 1440), 8000), "page": page, "text": text, "w": 240, "x": 0, "y": y}
        y = bottom + ROW_TO_TITLE
    return placed


def main():
    c = json.load(open(PATH, encoding='utf-8'))
    for n in OLD_NOTES:
        c['notes'].pop(n, None)
    placed = place(c, 'marka', BRAND)
    for pid, _, suffix, number in VARIANTS:
        placed |= place(c, pid, WEB, suffix, number)
    for name, e in c['boards'].items():  # ilk sayfa artık logo: her panoda sayfa açıkça yazılı olmalı
        if name not in placed:
            assert e.get('page') in ('logo', 'yonler'), f'yerleşmemiş pano: {name}'
    for n in c['notes'].values():
        assert n.get('page'), n
    c['pages'] = PAGES
    c['launch'] = {"page": "a", "view": "canvas"}
    json.dump(c, open(PATH, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    for pg in PAGES:
        bs = [e for e in c['boards'].values() if e.get('page') == pg['id']]
        if not bs:
            print(f"{pg['name']}: pano yok")
            continue
        print(f"{pg['name']}: {len(bs)} pano, {sum(1 for n in c['notes'].values() if n.get('page') == pg['id'])} başlık, "
              f"alt kenar {max(e['y'] + e['h'] for e in bs)}")


if __name__ == '__main__':
    main()
