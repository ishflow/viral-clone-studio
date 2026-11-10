# Viral Clone tuvali: pano çizen ajan için kurallar

Bu dosya, tuvale pano çizen her ajanın (ana oturum ya da subagent) uyduğu ortak kurallardır. Göreve özel bilgi ajanın kendi görev metnindedir.

## 1. Ürün (uydurma yapmamak için bilinmesi gerekenler)
- **Viral Clone** (`viralclone.app`): müşteri galeriden tutmuş (viral) bir video şablonu seçer, ürün fotoğraflarını yükler, aynı videoyu kendi ürünüyle alır. Söz: "Same video. Your product." Çağrı: "Seen it? Clone it." Ana düğme: "Clone it".
- Arayüz dili İngilizce. Ödeme **kredi paketi** (abonelik yok). Fiyat, kredi, süre ve sınır değerlerinin **tek kaynağı** `docs/specs/2026-10-04-flow-contract.md` (akış sözleşmesi): Starter 10 / $19, Standard 30 / $54, Studio 100 / $169; video başına 2 / 5 / 4 / 8 kredi.
- Form seçenekleri: biçim **No talking / Talking**, kalite **Fast / Best**, video dili (varsayılan English), ürün sayısı, varyant sayısı.
- E-postasını doğrulayan yeni üyeye **bir** ücretsiz video: No talking, Fast, bir varyant (sözleşme §3).
- İş (job) yarıda durabilir: teslim edilmeyen videonun kredisi o an bakiyeye geri döner (`Credits returned`), biten parçalar saklanır, devam etmek aynı tutarı yeniden alır (sözleşme §6). **returned** = kredi bakiyeye döner; **refund** = para karta döner. İkisi karıştırılmaz.
- Müşteri kendi video bağlantısını ekleyebilir: 2–5 dakikada yalnız onun gördüğü özel şablon olur; hazırlamak 1 kredi (sözleşme §4).
- Yönetim tarafı: sistem belirli saatlerde TikTok Creative Center Top Ads ve YouTube Shorts'u tarar, adayları puanlar; eşiği geçen aday şablon olarak hazırlanır ve yayın için Inbox'a düşer.
- Ödeme sağlayıcı seçilmedi: metinde "payment provider" de, marka adı yazma.
- **Site içi reklam, promosyon, "upgrade" kartı yok** (sahip iptal etti).

## 2. Sözlük
template · shot · clip · sample · reference · generate · credit · credit pack · "No talking / Talking" · "Fast / Best" · job · variant.
Müşteri menüsü: Gallery · My videos · Pricing · Account. Ziyaretçi menüsü: Gallery · How it works · Pricing · Log in · Get started.
Yönetim menüsü: Overview · Users · Revenue · Jobs · Templates · Settings.
Yazım: düğme ve başlıklar cümle düzeninde ("Buy credits", "Download invoice"); kısa, düz cümle; ünlem yok; emoji yok.

## 3. Uydurma yok
Rakam, fiyat, tarih, kişi adı, e-posta, yorum, logo şeridi uydurma. Bilinmeyen her değer köşeli yer tutucu:
`[BALANCE]` `[BALANCE AFTER]` `[AMOUNT]` `[DATE]` `[REASON]` `[COUNT]` `[EMAIL]` `[INVOICE NUMBER]` `[VIDEO NAME]` `[REFERENCE]` `[NAME]` `[ADMIN NAME]` `[JOB ID]` `[TIME]` (dinamik veri) · `[COMPANY NAME]` `[ADDRESS]` `[SUPPORT EMAIL]` `[TAX ID]` (sahibin vereceği bilgi) · faturada `[CUSTOMER NAME]` `[BILLING ADDRESS]` `[PAYMENT METHOD]` · `[CREDITS]` yalnız dinamik satırda (defter, tablo).
**Artık yer tutucu değil, sözleşmedeki değer yazılır:** fiyat, video başına kredi, bağlantı geçerliliği, en kısa şifre, destek yanıt süresi, ürün sınırı, diller, fatura saklama, yasal metin özeti (`[PRICE]` `[CREDIT AMOUNT]` `[CREDIT DIFFERENCE]` `[LINK VALIDITY]` `[MIN LENGTH]` `[RESPONSE TIME]` `[PRODUCT LIMIT]` `[MORE LANGUAGES]` `[INVOICE RETENTION]` `[LEGAL TEXT]` yasak: `python3 sozlesme.py` yakalar).
Yeni yer tutucu gerekiyorsa aynı biçimde yaz ve raporunda listele. Durum adları (Active, Blocked, Done, Stopped…) ve seçenek adları veri değildir, düz yazılır. Gerçek şablon adları `parts.TEMPLATES` içindedir; şablon adı gereken yerde onları kullan. Grafik çizme: `panel.chart_slot()`.

## 4. Marka ölçüleri (zorunlu)
- Yazı: 13 / 15 / 17 / 20 / 24 / 32 px + akışkan başlıklar (`parts.H2`, `parts.H3`). Başka boyut yok. Başlıklar `var(--display)` (Bricolage Grotesque 700–800), metin `var(--body)` (Onest 400/500/600).
- Boşluk (gap, padding, margin): 4 / 8 / 12 / 16 / 24 / 32 / 48 / 72 / 112. Köşe: 8 / 12 / 16 / 24 / tam (999px).
- Kontrol yüksekliği: 44 / 52 / 60 / 72. Dokunma hedefi en az 44 px (bağlantılar dahil: `min-height: 44px`).
- İkon: `parts.icon(ad)`, 24'lük ızgara, çizgi 2. Listede olmayan ikon gerekiyorsa önce `tuval/project/Marka-Ikonlar.dc.html` içindeki çizimi kullan; orada da yoksa aynı dilde (yuvarlak uç, çizgi 2) çiz ve raporla.
- **Renk yalnız belirteçle**: `var(--bg)` zemin · `var(--surface)` kart · `var(--raised)` seçili / kabarık · `var(--line)` ince çizgi · `var(--edge)` kenar · `var(--edge-strong)` kontrol kenarı · `var(--text)` `var(--text-2)` `var(--text-3)` · `var(--accent)` lime dolgu, üstündeki yazı `var(--on-accent)` · `var(--accent-text)` vurgulu yazı / bağlantı (dark'ta lime, light'ta koyu yeşil) · `var(--warn)` uyarı yazısı, `var(--warn-edge)` uyarı kenarı · `var(--scrim)` + `var(--on-scrim)` video üstü etiket. **Ham hex yazma.** Lime yazı için her zaman `--accent-text` (light'ta `--accent` yazı olarak okunmaz).
- **Lime kuralı**: aynı anda görünen alanda en fazla **bir** lime panel ya da **bir** lime ana düğme. Üst menüdeki "Get started" sayılmaz. İkincil eylemler kenarlı düğme (`parts.SECONDARY`).
- Durum: renk tek başına taşımaz; `parts.status(kind, label)` (ikon / biçim + yazı).
- Her pano hem dark hem light okunmalı (`write()` her panoya `theme` tweak'i koyar).

## 5. Pano biçimi (.dc.html): sessizce bozulan kurallar
- Panoyu `parts.write(name, title, root_style, body, vals='', props=None, w=1440, h=900, theme='dark')` yazar; iskeleti elle yazma.
- Bütün arayüz `<x-dc>` içi işaretlemedir. `{{ delik }}` yalnız noktalı arama (`{{ a.b }}`); ifade olmaz. Tekrar `<sc-for list="{{ rows }}" as="r" hint-placeholder-count="3">`, dal `<sc-if value="{{ x }}" hint-placeholder-val="{{ true }}">`.
- Her boş olmayan öğe kapatılır, her öznitelik tırnaklıdır. Stil **satır içi** `style="…"`; sınıf ve `<style>` yazma (helmet hazır gelir).
- Gerçek öğeler: `<button type="button">`, `<a href>`, `<input>` + `<label>`, `<table>` + `<th scope>`. `div`'e `onClick` / `role="button"` yok. Yalnız ikonlu düğmeye `aria-label`.
- Pano bağlantıları: `<a href="A-Hesap.dc.html">`; düğme görünümü `<a>`'nın kendisine verilir.
- SAYFA (web ekranı): kökte px genişlik yok, `parts.ROOT_PAGE` + içeride `max-width: 1320px`; yan yana bölümler `flex-wrap: wrap` + `flex: 1 1 <taban>px; min-width: 0`; ızgara `repeat(auto-fit, minmax(min(240px, 100%), 1fr))`; geniş tablo `overflow-x: auto` kutusunda (`panel.table`). `vh`, `position: fixed/sticky` yok.
- `<iframe>`, emoji, dış görsel, `data:` URI yok. Görsel yalnız `/_blob/<kimlik>` (bkz. `parts.TEMPLATES`).
- `data-props` tek tırnaklı JSON'dur: içinde `'` olamaz.

## 6. Araçlar
```bash
D=./docs/design; T=$D/tuval
export VK_PROJECT=$T/project
cd $D/uretec && python3 rowN.py                                   # panoları $T/project altına yazar
cd $D && DC_BLOBS=$T python3 preview_dc.py $T/pv-<ajan> $T/project/A-X.dc.html [...]     # dark PNG + "icerik=<gerçek yükseklik>"
cd $D && DC_BLOBS=$T DC_THEME=light python3 preview_dc.py $T/pv-<ajan>-light $T/project/A-X.dc.html
cd $T/pv-<ajan> && python3 $D/uretec/sheet.py $T/pv-<ajan>/sheet.png 2 900 A-X.png A-Y.png   # kontak tabakası
cd $D/uretec && python3 dar.py [A-X-M ...]                        # dar ekran: mobil panoları 320 ve 360 px'te çizer ($T/pv-dar), yana taşmayı ve taşan öğeleri yazar (adsız: hepsi)
```
- Önizleme pano başına ~10 sn sürer ve sıraya girer; Bash `timeout` 240000 ver. PNG'yi `Read` ile aç ve **gerçekten bak**: taşma, üst üste binme, kırık hizalama, okunmayan yazı. Dark ve light ikisine de bak.
- `parts.py`: `header_in(current, balance)` girişli müşteri menüsü · `header_out(current)` ziyaretçi menüsü · `icon()` · `video_card()` · `auth_page()` · `status()` · stil sabitleri (`H2…H6`, `LEAD`, `BODY2`, `SMALL`, `CARD`, `PRIMARY`, `PRIMARY_L`, `SECONDARY`, `SECONDARY_L`, `QUIET`, `INPUT`, `LABEL`, `ROOT_PAGE`, `WRAP`, `GRID`, `TAG`).
- `panel.py` (yönetim): `header_panel(current)` · `subnav(items, current)` + `SUB_REVENUE`, `SUB_TEMPLATES` · `page_head(title, lead, actions)` · `segment(options, current, label)` · `tile(label, value, sub)` + `TILES` · `table(caption, heads, rows, min_w, num)` · `pager()` · `chart_slot(label)` · `PANEL_WRAP`.
- Örnek betikler: `uretec/row6.py` (durum panoları, mevcut ekrandan türetme), `row7.py`, `row8.py`.
- Yükseklik: `write()`'a `h` verme zorunluluğu yok; içerik 900'den uzunsa kökün `min-height`'ını ve `h`'yi önizlemenin yazdığı `icerik` değerine (20'nin katına yuvarla) eşitle.

## 7. Yasaklar
- `canvas.json`, `layout.py`, `fit_dc.py`, `parts.py`, `panel.py`, `preview_dc.py` **değiştirilmez / çalıştırılmaz** (ana oturumun işi). Eksik bir ortak parça gerekiyorsa kendi betiğinde tanımla, raporda söyle.
- Görevinde adı geçmeyen panoya dokunma. Dosya silme. `git commit` / `push` yok. Tuvale yayın yok (Artifact publish ana oturumun işi). Tuvali tarayıcıda açma.
- Başka şirketin tasarımını kopyalama. Kullanıcıya soru sorma (uyuyor): en makul kararı ver, raporda "varsayım" diye yaz.

## 8. Rapor biçimi (kısa)
1. Yazılan / değiştirilen dosyalar. 2. Her pano için gerçek içerik yüksekliği (dark). 3. Kontak tabakası PNG yolu (dark ve light). 4. Verilen kararlar ve varsayımlar. 5. Yeni yer tutucular, yeni ikonlar. 6. Çözemediğin ya da emin olmadığın şeyler.

## 9. Light ve mobil türevler (variants.py)
Her kaynak pano (masaüstü, dark; `tuval/project/<ad>.dc.html`) üç türev verir. **Türev dosyaları elle düzenlenmez**: kaynak ya da yama değişir, betik yeniden çalışır.

| Türev | Ne | Tuval sayfası |
|---|---|---|
| `<ad>-L` | masaüstü light (aynı dosya, tema varsayılanı light) | 4 · Website · Light |
| `<ad>-M` | mobil dark, genişlik 390 | 5 · Mobile · Dark |
| `<ad>-ML` | mobil light, 390 | 6 · Mobile · Light |

Mobil kopyada betik şunları yapar: genişlik 390; üst menü telefon menüsüne döner (`parts.header_m`: logo + bakiye ya da "Get started" + menü düğmesi; açık hâli `A-Menu-M`, `A-Menu-Ziyaretci-M`, `A-Menu-Admin-M` panoları); kökteki sabit `width` kalkar, sabit `height` → `min-height`; video kartı ızgarası (`minmax(min(210px, 100%), 1fr)`) iki sütun olur; `yama_*.py` içindeki `YAMA['<ad>']` değişiklikleri uygulanır; yükseklik ölçülür (sayfalar en az 844). Bağlantılar aynı türeve gider. Kaynağı zaten light olan panolar (e-postalar) yalnız `-ML` verir; `A-Dil-Menusu` ve `A-Fatura` mobil türev vermez.

```bash
D=./docs/design; T=$D/tuval; export VK_PROJECT=$T/project
cd $D/uretec && python3 variants.py A-Hesap A-Form            # bu kaynakların -L, -M, -ML türevlerini yeniden üretir (mobil PNG: $T/pv-m)
cd $D && DC_BLOBS=$T python3 preview_dc.py $T/pv-<ajan> $T/project/A-Hesap-L.dc.html $T/project/A-Hesap-M.dc.html $T/project/A-Hesap-ML.dc.html
```

Bir ekran dar ekranda ya da light'ta bozuksa düzeltme sırası:
1. **Kaynağı akışkan yap** (masaüstü görünüşü değişmeden): `flex-wrap: wrap`, `flex: 1 1 <taban>px; min-width: 0`, `clamp()`, `min(…, 100%)`, `overflow-wrap: anywhere`, uzun satırda `flex-wrap`. Sabit `width: Npx` yerine `width: 100%; max-width: Npx`. Masaüstü dark PNG'si düzeltmeden önceki hâliyle aynı kalmalı.
2. Akışkan çözüm yoksa (ör. masaüstünde yan yana 3 sütun, telefonda farklı sıra; sabit ölçülü pencere) **yama**: `uretec/yama_<grup>.py` içinde `YAMA = {'<ad>': [('<kaynaktaki tam metin>', '<mobildeki metin>'), ...]}`. Eski metin kaynakta birebir geçmeli (geçmezse betik durur). Yama yalnız mobil kopyaya uygulanır.
3. Light kusuru her zaman **kaynakta** düzeltilir (belirteç yanlışı): bkz. §4. Light için yama yoktur.

Mobilde bakılacaklar: yatay taşma yok (hiçbir şey 390'ın dışına çıkmaz, kırpılmaz) · yazı 13'ten küçük değil, başlıklar ekrana sığıyor · dokunma hedefi ≥ 44, yan yana düğmeler sığmıyorsa alt alta ve tam genişlik · kenar boşluğu 16 · tablo kendi kutusunda yana kayıyor · görseller oranını koruyor · pencere (modal) panoları telefonda alttan açılan tam genişlik sayfa gibi: kenar boşluğu 16, düğmeler alt alta · lime kuralı telefon ekranında da geçerli (bir ekran boyunda tek lime).
Light'ta bakılacaklar: lime yazı yok (`--accent-text`) · lime dolgu üstü `--on-accent` · video üstü etiketler `--scrim` / `--on-scrim` · kartlar zeminden ayrışıyor · kenarlar görünüyor · uyarı rengi okunuyor.

## 10. Grup geçişi: light + mobil + ayrıntılı kontrol
Bir grup ajanı kendi bölümlerindeki **kaynak** panoların sahibidir (yalnız onları ve kendi `yama_<grup>.py` dosyasını değiştirir). Kaynak artık `.dc.html` dosyasının kendisidir: `rowN.py` betikleri ilk çizimin kaydıdır, **yeniden çalıştırılmaz** (üzerine yazar). Kaynağı doğrudan düzenle (Edit) ya da yeniden çalıştırılabilir küçük bir betikle.

Her ekran için sıra:
1. Kaynağı dark masaüstünde çiz, bak. Aşağıdaki denetim listesini uygula, kusuru kaynakta düzelt.
2. `python3 variants.py <adlar>` → `-L`, `-M`, `-ML`. Üçünü çiz, **her birine bak** (kontak tabakası + şüpheliyi tek tek).
3. Light kusuru → kaynak (belirteç). Mobil kusuru → önce kaynağı akışkan yap, olmuyorsa yama (§9).
4. Kaynak değiştiyse `python3 boy.py <adlar>` (yüksekliği içeriğe eşitler), sonra yine `variants.py`. Son hâli dört görünüşte yeniden çiz.

Denetim listesi (kaynakta):
- **Yazı boyutu** yalnız 13 / 15 / 17 / 20 / 24 / 32 + akışkan başlıklar. Başka değer (12, 14, 16, 18, 22, 28, 80…) en yakın basamağa çekilir; büyük gösterge sayıları `clamp()` ile akışkan olabilir.
- **Boşluk** (gap, padding, margin) yalnız 4 / 8 / 12 / 16 / 24 / 32 / 48 / 72 / 112. Merdiven dışı değerler (6, 10, 14, 18, 20, 22, 26, 28, 36, 40…) en yakın basamağa çekilir. İstisna: hap / etiket iç boşluğu (`4px 8px`, `5px 10px`, `8px 14px`) ve üst menü ölçüleri ortak parçadan geldiği için **aynen kalır**. Video kartı ızgarası: `gap: 32px 16px`.
- **Köşe** 8 / 12 / 16 / 24 / 999. **Kontrol yüksekliği** 44 / 52 / 60 / 72; dokunma hedefi ≥ 44 (satır içi bağlantılar dahil).
- **Lime kuralı** (§4): ekranda iki lime dolgu aynı anda görünüyorsa biri kenarlı düğmeye döner (ana eylem lime kalır).
- **Tek `<h1>`**; başlık sırası h1 → h2 → h3.
- **Sözlük** (§2) ve **yer tutucular**: mevcut köşeli yer tutucular kalır, yenisini uydurma; rakam / fiyat / kişi adı uydurma yok.
- **Müşteri ekranlarında model ve sağlayıcı adı yok** (Seedance, Kling, Nano Banana, Lyria, Magnific, "500"): yansız söze çevir. Fast = "720p", Best = "1080p"; tahmin satırları "Images", "Clips", "Music"; durma nedeni "Two clips could not be generated."; seçenekler "Try again" ve "Continue with the backup model". Yönetim ekranlarında adlar kalır.
- **Bağlantılar**: her `href="X.dc.html"` var olan bir panoya gider; `href="#"` kalmışsa doğru panoya bağla (fatura → `A-Fatura.dc.html`, destek → `A-Iletisim.dc.html`, yasal → `A-Yasal.dc.html`).
- **Görsel kenarı**: her fotoğraf / video karesinin köşeli kabına (ya da köşeyi taşıyan `<img>`'e) `box-shadow: 0 0 0 1px var(--media-edge)` ekle (dark'ta görünmez, light'ta beyaz fotoğrafın kenarı erimez).
- **Durumlar**: liste ekranının boş / yükleniyor / hata hâli var mı? Eksikse çizme, raporda söyle.
- Masaüstü dark görünüş, bu listedeki düzeltmeler dışında değişmemeli.

Rapor (§8'e ek): ekran başına yapılan düzeltmeler (tek satır), yazılan yamalar, **çözülemeyenler**, eksik durum / sayfa önerileri; kontak tabakaları dört görünüş için ayrı (`sheet-D.png`, `sheet-L.png`, `sheet-M.png`, `sheet-ML.png`; mobilde 8 sütun, hücre 390).

## 11. İnceleme turu (2026-10-04): eksik durumlar

Değerler ve **bütün yeni metinler** `docs/specs/2026-10-04-flow-contract.md` içinde: metni oradan **birebir** al, kendi cümleni yazma. Sözleşmede olmayan bir metin gerekiyorsa aynı seste yaz ve raporda listele.

**Pano adları sabit.** Yeni panoların adı `layout.py` içinde kayıtlı; yalnız görevindeki adlarla dosya aç. Fazladan pano gerekiyorsa çizme, raporda öner.

**İki tür yeni pano:**
- **Sayfa**: bütün sayfa değişiyorsa (ör. ödeme doğrulanıyor, bağlantı süresi dolmuş). Mevcut en yakın panoyu kopyalayıp değiştir; aynı üst menü, aynı düzen.
- **Durum panosu** (`…-Durumlar`, `…-Yukleme`, `…-Onaylar`): sayfanın bir bölgesi değişiyorsa. Üst menü yok. Kök `parts.ROOT_PAGE` + `max-width: 1320px` sarmalayıcı; tek `<h1>` (pano adı, `parts.H4`); altında `display: flex; flex-wrap: wrap; gap: 32px` ile hücreler. Her hücre `flex: 1 1 400px; min-width: 0; max-width: 520px`: üstte 13 px `var(--text-3)` etiket (durumun adı, cümle düzeninde), altında o bölgenin **gerçek ölçüsünde** o durumdaki hâli (pencere, form kartı, satır). Telefonda hücreler kendiliğinden alt alta iner. Bir durum panosunda 3–6 hücre; 6'dan fazlaysa hücreler `<h2>` alt başlıklarıyla (20 px, 600, `var(--text)`; gruplar arası 48 px) gruplanır, her grupta 2–6 hücre: `<h1>` → `<h2>` sırası bozulmaz. **Pencere hücresi:** hücrede bir pencere (onay, bildirim) çiziliyorsa hücre `flex: 1 1 560px; min-width: 0; max-width: 640px` olur; pencere gerçek genişliğinde durur, düğmeleri gerçek penceredeki gibi yan yana (telefonda alt alta) dizilir. Gerçek sayfadaki bir yuvayı gösteren hücre o yuvanın ölçüsünü ve hizasını kullanır (video 390 px ve ortalı, gösterge sayısı 32 px, düğme tam genişlikse tam genişlik).

**Kalıp uydurma; var olanı kopyala.** Aynı kalıp her grupta aynı görünmeli:

| Kalıp | Birebir alınacak kaynak |
|---|---|
| Alan hatası (kenar + altında ileti) | `A-Form-Hata` |
| Uyarı kutusu (`--warn`, `--warn-edge`, ikon + yazı; ilk cümle 600 ve `--warn`, kalan yazı `--text`) | `A-Onay-Yetersiz` (satır içi kutu), `A-Is-Durdu` (kart) |
| Kaldıran onay (hesap silme, iş kapatma, video silme; yönetimde `Refund`, `Block user`) | `A-Hesap-Sil`: güvenli seçenek geniş ve kenarlı (`flex: 2 1 240px`, `--edge-strong`), kaldıran seçenek dar ve `--warn` kenarlı (`flex: 1 1 160px`); telefonda güvenli seçenek üstte; lime yok |
| Pencere (onay, özet satırları, iki düğme) | `A-Onay`, `A-Onay-Yetersiz` |
| Boş durum | `A-Uretimlerim-Bos` |
| Yükleniyor iskeleti | `A-Galeri-Yukleniyor` |
| Durum etiketi | `parts.status()`: aynı durum müşteri ve yönetim ekranlarında aynı sözcük, renk ve işaret; yalnız renkli yazı durum etiketi değildir |
| Giriş düzeni | `parts.auth_page()` (`A-Sifre-Gonderildi` örnek) |
| Yönetim tablo / başlık / gösterge | `panel.py` |
| "Yüklenemedi, yeniden dene" bloğu | `A-Galeri-Hata` (grup 3 çizer; diğerleri aynı yapıyı kendi metniyle kurar: ikon + 20 px başlık + 15 px açıklama + kenarlı `Try again`) |

**Yama dosyaları.** Eski `yama_g*.py` dosyalarına **dokunma**. Kendi dosyan `yama_r<N>.py`: yeni panolar için `YAMA = {...}`; mevcut bir panonun yaması kaynağı değiştirdiğin için artık eşleşmiyorsa `DEGISTIR = {'<ad>': [...]}` ile o panonun bütün yama listesini yeniden ver (eski dosyadaki sabitleri `from yama_g2b import FORM` gibi içe aktarabilirsin). `variants.py` dosyaları ad sırasıyla okur; `DEGISTIR` öncekilerin yerine geçer.

**Denetim (raporundan önce, hepsi 0 hata):**
```bash
D=./docs/design; T=$D/tuval; export VK_PROJECT=$T/project
cd $D/uretec && python3 boy.py <kaynak adlar> && python3 variants.py <kaynak adlar>     # yükseklik + türevler
cd $D/uretec && python3 sozlesme.py <kaynak adlar ve türevleri>                          # kalmış yer tutucu yok
cd $D/uretec && python3 dogrula.py                                                       # biçim + bağlantılar
```
Önizleme PNG'lerinde `YATAY-TASMA` yazan mobil pano hatadır.

**Git komutu çalıştırma** (`add` dahil): aynı klasörde başka bir oturum da çalışıyor. `web/`, `viraleditor/`, `packages/`, `spike/` klasörlerine dokunma; `pnpm build` çalıştırma.
