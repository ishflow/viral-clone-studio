"""Grup 1 (3.1 Home and sign-up, 3.2 Account access) mobil yamaları: yalnız mobil kopyaya (-M, -ML) uygulanır.
Her çift (kaynaktaki tam metin, mobildeki metin). Yamalar variants.to_mobile içinde üst menü değiştikten ve GENEL kural
(video kartı ızgarası iki sütun) uygulandıktan sonra çalışır; A-Karsilama'daki ızgara yaması bu yüzden GENEL sonrası metni arar."""

EDGE = 'box-shadow: 0 0 0 1px var(--media-edge)'

# Giriş düzeni (A-Giris, A-Eposta-Dogrula, A-Sifre-*): telefonda form üstte, görsel panel sayfanın altına yaslı kısa marka şeridi
# (solda söz, sağda üç küçük kare). Form ilk ekranda kalır, kenar boşluğu 16.
AUTH = [
    ('<div style="flex: 1; display: flex; flex-wrap: wrap">',
     '<div style="flex: 1; display: flex; flex-direction: column">'),
    ('<section style="flex: 1 1 420px; min-width: 0; box-sizing: border-box; padding: clamp(24px, 4vw, 48px) clamp(16px, 4vw, 60px); display: flex; flex-direction: column; justify-content: space-between; gap: 48px; background: var(--surface)">',
     '<section style="order: 2; flex: 0 0 auto; box-sizing: border-box; padding: 24px 16px; display: flex; flex-direction: row-reverse; align-items: center; justify-content: space-between; gap: 16px; background: var(--surface)">'),
    ('<div style="display: flex; align-items: flex-end; gap: 16px">',
     '<div style="flex: 0 0 auto; display: flex; align-items: flex-end; gap: 8px">'),
    ('style="flex: 1 1 0; min-width: 0; max-width: 170px; aspect-ratio: 9 / 16; object-fit: cover; border-radius: 16px;',
     'style="flex: 0 0 40px; width: 40px; aspect-ratio: 9 / 16; object-fit: cover; border-radius: 8px;'),
    ('style="flex: 1.3 1 0; min-width: 0; max-width: 220px; aspect-ratio: 9 / 16; object-fit: cover; border-radius: 16px;',
     'style="flex: 0 0 52px; width: 52px; aspect-ratio: 9 / 16; object-fit: cover; border-radius: 8px;'),
    ('<p style="margin: 0; max-width: 520px; font-family: var(--display); font-weight: 800; font-size: clamp(32px, 4vw, 52px); line-height: 0.96; letter-spacing: -0.03em; text-wrap: balance">Same video. <span style="color: var(--accent-text)">Your product.</span></p>',
     '<p style="margin: 0; font-family: var(--display); font-weight: 800; font-size: 24px; line-height: 1; letter-spacing: -0.03em">Same video. <span style="display: block; color: var(--accent-text)">Your product.</span></p>'),
    ('<main style="flex: 1 1 420px; min-width: 0; box-sizing: border-box; padding: clamp(24px, 4vw, 48px) clamp(16px, 4vw, 60px); display: flex; align-items: center; justify-content: center">',
     '<main style="flex: 1 1 auto; min-width: 0; box-sizing: border-box; padding: 32px 16px 24px; display: flex; align-items: flex-start; justify-content: center">'),
]

YAMA = {
    'A-Giris': AUTH,
    'A-Eposta-Dogrula': AUTH,
    'A-Sifre-Unuttum': AUTH,
    'A-Sifre-Gonderildi': AUTH,
    'A-Sifre-Yeni': AUTH,

    'A-Ana-Sayfa': [
        # görsel şeridi: ekran kenarına taşan, yana kayan sıra (kademe yok, kareler 148 px)
        ('<div style="width: 100%; display: flex; justify-content: center; align-items: flex-start; gap: 16px; overflow-x: auto; padding-top: 16px">',
         '<div style="align-self: stretch; display: flex; justify-content: flex-start; align-items: flex-start; gap: 12px; overflow-x: auto; margin: 0 -16px; padding: 8px 16px 4px; scroll-snap-type: x mandatory; scroll-padding: 0 16px; scrollbar-width: none">'),
        ('style="flex: 1 1 0; min-width: 120px; max-width: 230px; aspect-ratio: 9 / 16; object-fit: cover; border-radius: 16px; display: block; ' + EDGE + '; margin-top: {{ c.drop }}"',
         'style="flex: 0 0 148px; width: 148px; aspect-ratio: 9 / 16; object-fit: cover; border-radius: 16px; display: block; ' + EDGE + '; scroll-snap-align: start"'),
        # üç adım: rakam solda, başlık ve metin sağda (kart yüksekliği yarıya iner)
        ('<li style="box-sizing: border-box; padding: 24px; border-radius: 16px; background: var(--surface); border: 1px solid var(--line); display: flex; flex-direction: column; gap: 16px">',
         '<li style="box-sizing: border-box; padding: 16px; border-radius: 16px; background: var(--surface); border: 1px solid var(--line); display: grid; grid-template-columns: 40px minmax(0, 1fr); align-items: start; gap: 8px 12px">'),
        ('<span style="font-family: var(--display); font-weight: 800; font-size: clamp(48px, 4.6vw, 64px); line-height: 1; color: var(--accent-text)">{{ s.no }}</span>',
         '<span style="grid-row: 1 / span 2; font-family: var(--display); font-weight: 800; font-size: clamp(48px, 4.6vw, 64px); line-height: 1; color: var(--accent-text)">{{ s.no }}</span>'),
        ('<h3 style="margin: 0; font-family: var(--display); font-weight: 700; font-size: 24px; letter-spacing: -0.02em">{{ s.title }}</h3>',
         '<h3 style="margin: 0; font-family: var(--display); font-weight: 700; font-size: 20px; line-height: 1.25; letter-spacing: -0.01em">{{ s.title }}</h3>'),
        ('<p style="margin: 0; font-size: 17px; line-height: 1.5; color: var(--text-2); text-wrap: pretty">{{ s.body }}</p>',
         '<p style="margin: 0; font-size: 15px; line-height: 1.5; color: var(--text-2); text-wrap: pretty">{{ s.body }}</p>'),
        # düğmeler tam genişlik
        ('<a href="Main.dc.html" style="align-self: flex-start; display: flex; align-items: center; min-height: 52px;',
         '<a href="Main.dc.html" style="align-self: stretch; display: flex; align-items: center; justify-content: center; min-height: 52px;'),
        ('<a href="A-Giris.dc.html" style="display: flex; align-items: center; justify-content: center; min-height: 60px; padding: 0 48px;',
         '<a href="A-Giris.dc.html" style="flex: 1 1 100%; display: flex; align-items: center; justify-content: center; min-height: 60px; padding: 0 48px;'),
    ],

    'A-Fiyatlar': [
        # paket kartı: solda ad ve açıklama, sağda fiyat ve kredi; düğme altta tam genişlik (üç kart bir ekrana sığar)
        ('<article style="box-sizing: border-box; padding: 24px; border-radius: 16px; background: {{ p.bg }}; color: {{ p.fg }}; border: 1px solid {{ p.bd }}; display: flex; flex-direction: column; gap: 24px">',
         '<article style="box-sizing: border-box; padding: 16px; border-radius: 16px; background: {{ p.bg }}; color: {{ p.fg }}; border: 1px solid {{ p.bd }}; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start; gap: 8px 16px">'),
        ('<div style="display: flex; flex-direction: column; gap: 4px">\n<span style="font-family: var(--display); font-weight: 800; font-size: clamp(40px, 4vw, 52px);',
         '<div style="grid-row: span 2; display: flex; flex-direction: column; align-items: flex-end; gap: 4px; text-align: right">\n<span style="font-family: var(--display); font-weight: 800; font-size: clamp(40px, 4vw, 52px);'),
        ('<a href="A-Giris.dc.html" style="margin-top: auto; display: flex;',
         '<a href="A-Giris.dc.html" style="grid-column: 1 / -1; margin-top: 8px; display: flex;'),
    ],

    'A-Yasal': [
        # belge listesi: üstte yana kayan sekme sırası
        ('<nav aria-label="Legal pages" style="flex: 1 1 200px; max-width: 260px; display: flex; flex-direction: column; gap: 4px">',
         '<nav aria-label="Legal pages" style="flex: 1 1 100%; min-width: 0; display: flex; gap: 8px; overflow-x: auto; margin: 0 -16px; padding: 0 16px; scrollbar-width: none">'),
        ('style="display: flex; align-items: center; min-height: 44px; padding: 0 16px; border-radius: 12px; background: var(--raised); color: var(--text); text-decoration: none; font-size: 15px; font-weight: 600"',
         'style="flex: 0 0 auto; display: flex; align-items: center; min-height: 44px; box-sizing: border-box; padding: 0 16px; border-radius: 999px; border: 1px solid var(--raised); background: var(--raised); color: var(--text); text-decoration: none; font-size: 15px; font-weight: 600; white-space: nowrap"'),
        ('style="display: flex; align-items: center; min-height: 44px; padding: 0 16px; border-radius: 12px; color: var(--text-3); text-decoration: none; font-size: 15px"',
         'style="flex: 0 0 auto; display: flex; align-items: center; min-height: 44px; box-sizing: border-box; padding: 0 16px; border-radius: 999px; border: 1px solid var(--edge); color: var(--text-2); text-decoration: none; font-size: 15px; white-space: nowrap"'),
    ],

    'A-Iletisim': [
        ('<button type="button" style="align-self: flex-start; display: flex;', '<button type="button" style="align-self: stretch; display: flex;'),
    ],

    'A-404': [
        ('<a href="Main.dc.html" style="display: flex; align-items: center; justify-content: center; min-height: 60px; padding: 0 32px;',
         '<a href="Main.dc.html" style="align-self: stretch; display: flex; align-items: center; justify-content: center; min-height: 60px; padding: 0 32px;'),
    ],

    'A-Cerez': [
        # ekranın altına yaslı kart: kenar boşluğu 16, iki düğme yan yana eşit
        ('padding: 24px clamp(16px, 4vw, 60px)">', 'padding: 16px">'),
        ('box-sizing: border-box; padding: 24px; border-radius: 24px; background: var(--surface);', 'box-sizing: border-box; padding: 16px; border-radius: 16px; background: var(--surface);'),
        ('<div style="display: flex; flex-wrap: wrap; gap: 12px">', '<div style="flex: 1 1 100%; display: flex; gap: 12px">'),
        ('cursor: pointer; min-height: 52px; padding: 0 24px; border: 1px solid var(--edge-strong);', 'cursor: pointer; flex: 1 1 0; min-width: 0; min-height: 52px; padding: 0 12px; border: 1px solid var(--edge-strong);'),
    ],

    'A-Karsilama': [
        ('<a href="Main.dc.html" style="align-self: flex-start; display: flex; align-items: center; justify-content: center; box-sizing: border-box;',
         '<a href="Main.dc.html" style="align-self: stretch; display: flex; align-items: center; justify-content: center; box-sizing: border-box;'),
        # beş şablon: iki sütunda biri yalnız kalıyordu; telefonda yana kayan sıra (kart 220 px: ikinci kartın süre etiketi kesilmeden ekran dışında kalır)
        ('<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 32px 16px">',
         '<div style="display: grid; grid-auto-flow: column; grid-auto-columns: 220px; gap: 16px; overflow-x: auto; margin: 0 -16px; padding: 0 16px 4px; scroll-snap-type: x mandatory; scroll-padding: 0 16px; scrollbar-width: none">'),
        ('<article style="display: flex; flex-direction: column; gap: 12px; min-width: 0">',
         '<article style="display: flex; flex-direction: column; gap: 12px; min-width: 0; scroll-snap-align: start">'),
    ],
}
