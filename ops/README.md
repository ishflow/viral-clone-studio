# ops: üretim kurulum kiti

Web (site) + worker + günlük yedek için launchd kurulumu. Tek okuyucu: sahibi. Betikler `/path/to/viral-clone` içinde, `ops/` altından çalışır.
**Hiçbir betik kendiliğinden bir şey kurmaz:** `install.sh` ve `rollback.sh` varsayılan olarak dry-run'dır (yalnız ne yapacağını yazar); `--apply` verince yazar; servisleri başlatmak ayrıca `--load` ister. Hiçbir betik dosya silmez.

| Betik | Ne yapar |
|---|---|
| `install.sh` | Env dosyasını (gizli bilgiler, `0600`) ve 4 launchd plist'ini yazar: web, worker, günlük yedek (03:30), ödeme taraması (60 sn) |
| `run.sh web\|worker` | launchd'nin çağırdığı giriş: env dosyasını yükler, sonra gerçek süreçle yer değiştirir |
| `set-secret.sh AD` | Tek bir gizli değeri env dosyasına gizli promptla yazar (kabuk geçmişine ve `ps`'e girmez) |
| `payments-sweep.sh` | Ödeme taraması: `POST /api/payments/sweep` (e-posta teslimi, bekleyen ödeme süre dolumu, iade yeniden denemeleri). launchd her 60 sn çağırır (`app.viralclone.payments`) |
| `health.sh` | Okuma-yalnız sağlık kontrolü; bir şey bozuksa çıkış kodu 1 |
| `backup.sh` | `db.sqlite` (SQLite `.backup`) + `site.json` kopyası, yeni tarihli klasöre. Silmez |
| `rollback.sh` | Servisleri durdurur, plist'leri kenara taşır (silmez). Env dosyası, veri ve yedekler yerinde kalır |
| `worker-restart.sh` | Worker'ı (`app.viralclone.worker`) yeniden başlatır, ama **yalnız çalışan video üretimi yokken**: varsa reddeder ve kaç tane olduğunu yazar. `--force` acil durum için (uyarır: o an sağlayıcıya giden istek `submission-unknown` olur, `docs/runbook.md` bölüm 9); `--dry-run` ne yapacağını yazar, `launchctl`'e dokunmaz; `--data-dir D` (yalnız `--dry-run` ile; gerçek koşuda reddedilir, çünkü yeniden başlatılan hep canlı worker'dır) env dosyası yerine bu klasörün `db.sqlite`'ını okur. Veritabanına yazmaz |

## Kurulum (sırayla)

Ön koşul: Node 24+, pnpm, `sqlite3`, `openssl`; `pnpm --dir web install`, `pnpm --dir viraleditor install` yapılmış olmalı; site için bir kez `pnpm --dir web build`.

```
cd /path/to/viral-clone
ops/install.sh                        # 1. dry-run: ne yazılacağını gör, hiçbir şey değişmez
ops/install.sh --apply                # 2. env dosyası + plist'ler yazılır (servis başlamaz)
ops/set-secret.sh CLAUDE_CODE_OAUTH_TOKEN   # 3. önce başka terminalde:  claude setup-token
ops/install.sh --apply --load         # 4. worker, site, yedek başlar (worker önce: veritabanını o kurar)
ops/health.sh                         # 5. her şey yeşil mi
```

Seçenekler: `--data-dir D` (varsayılan `~/viralclone-data`), `--backup-dir D` (`~/viralclone-backups`), `--env-file F` (`~/.config/viralclone/env`), `--provider fake|magnific` (varsayılan `fake`), `--bind-host IP`, `--port N`, `--trust-proxy`, `--demo-links` (yalnız `fake` sağlayıcıda, kendi Mac'inde demo: üretim derlemesinde doğrulama ve şifre sıfırlama bağlantılarını sayfada gösterir, `VC_DEMO_LINKS=1`; gerçek e-posta bağlanana kadar kayıt doğrulamanın tek yolu budur, siteyi başkasına açıyorsan kullanma), `--admin-password-prompt` / `--admin-password-generate` (terminalde varsayılan prompt, değilse üretir; üretilen şifre **yalnız bir kez** ekrana basılır, hemen parola yöneticine yaz).

### Gizli bilgiler

Hepsi tek dosyada: `~/.config/viralclone/env` (klasör `0700`, dosya `0600`). Repoya hiçbir değer yazılmaz; plist'lerde de yoktur (plist yalnız dosyanın yolunu taşır).

| Anahtar | Kaynak |
|---|---|
| `VC_SESSION_SECRET` | `install.sh` rastgele 32 bayt üretir (en az 32 karakter gerekir). Değiştirmek tüm oturumları sonlandırır |
| `VC_ADMIN_PASSWORD` | Sen girersin ya da üretilir (en az 12 karakter). Yalnız **ilk** `site.json` yazılırken okunur; sonra özet olarak `site.json` içinde durur (değiştirme: `docs/runbook.md` bölüm 13) |
| `CLAUDE_CODE_OAUTH_TOKEN` | `claude setup-token` çıktısı; `ops/set-secret.sh CLAUDE_CODE_OAUTH_TOKEN`. Boşsa her model çağrısı reddedilir (`health.sh` FAIL der) |
| `MAGNIFIC_API_KEY` | Yalnız `VC_PROVIDER=magnific` için; `ops/set-secret.sh MAGNIFIC_API_KEY` |

Var olan env dosyası **asla yeniden yazılmaz**: `install.sh` yeniden çalışınca dosyayı olduğu gibi bırakır, yalnız plist'leri günceller (eskisini `~/Library/Logs/viralclone/plist-backups/` altına kopyalar). Değer değiştirmek için `set-secret.sh`. Değişiklikten sonra servisi yeniden başlat: worker için `ops/worker-restart.sh` (üretim sürerken reddeder), web için
`launchctl kickstart -k gui/$UID/app.viralclone.web`.

### Ödeme hattı gizli bilgileri: `payments.env`

Ödeme hattı kendi dosyasını okur: `~/.config/viral-klon/payments.env` (`VC_PAYMENTS_ENV_FILE` ile değişir). Dosya **varsa** `run.sh` onu yalnız **web** için yükler ve önce modunu `600` ve sahibini senin olarak doğrular (değilse site başlamaz); `VC_PROVIDER`'ı değiştirmeye çalışırsa da başlamaz. Dosyayı sen yazarsın (`umask 077`, `chmod 600`); kitap değer üretmez ve plist'e hiçbir ödeme gizli bilgisi koymaz. **Tarama işi:** `ops/payments-sweep.sh` (`app.viralclone.payments`, `StartInterval` 60) siteye `http://$VC_BIND_HOST:$VC_PORT/api/payments/sweep` adresine POST atar. `INTERNAL_CRON_SECRET` curl'e **stdin'den** (`-K -`) verilir: argv'de, log'da ya da plist'te görünmez; başarıda sessizdir, hatada yalnız HTTP durumunu yazar (401 = site başka bir sırla başlamış, sırrı değiştirince siteyi yeniden başlat). `payments.env` ya da sır yoksa sessizce atlar. Bu iş olmadan e-posta teslimi ve bekleyen ödeme süre dolumu yalnız elle çalışır; `health.sh` `payments.env` varken iş yüklü değilse FAIL verir. Beklenen anahtarlar: `VC_PAYMENTS=fake` (açıkça seçilir; yoksa demo ödeme portları çalışır), `VC_PAYMENTS_WEBHOOK_SECRET` (en az 32 karakter), `PUBLIC_BASE_URL`, `INTERNAL_CRON_SECRET` (en az 32 karakter, `/api/payments/sweep` için; yalnız POST + Bearer). Site açılırken `paymentConfig()` doğrulanır (`web/src/instrumentation-node.ts`): hatalıysa `site-not-started: <neden>` yazıp çıkar (değer yazılmaz). `live` modunun bağdaştırıcısı henüz yoktur ve reddedilir; `VC_PROVIDER=magnific` ile `fake` ya da `test` de reddedilir (ikisi de müşteriden gerçek para almaz): **ücretli mod şu an hiç başlamaz**, canlı ödeme (C10) gelene kadar.

**Dodo deneme modu (`VC_PAYMENTS=test`):** yalnız deneme ağacında, kendi dosyasıyla (`VC_PAYMENTS_ENV_FILE=~/.config/viral-klon/dodo-test.env`); canlının `payments.env`'i `fake` kalır. Zorunlu anahtarlar: `DODO_API_KEY_TEST`, `DODO_WEBHOOK_SECRET_TEST` (panelin verdiği `whsec_…`), `DODO_PRODUCT_PACK_STARTER`, `DODO_PRODUCT_PACK_STANDARD`, `DODO_PRODUCT_PACK_STUDIO` (`pdt_…`, her pakete ayrı ürün), ayrıca `PUBLIC_BASE_URL` (müşterinin ödemeden döneceği adres) ve `INTERNAL_CRON_SECRET` (en az 32 karakter: taramanın ucu daha kısasına hep 401 döner, tarama hiç çalışmaz ve webhook'u kaybolan ödeme hiç kredilenmezdi). Biri eksik ya da bozuksa site başlamaz ve nedeni yazar (`dodo-key-required`, `dodo-webhook-secret-required`, `dodo-product-required:<AD>`, `sweep-secret-required`); değer hiçbir yere yazılmaz. Bu mod yalnız kalıcı depoyla (`VC_ENGINE=sqlite`) başlar (`test-payments-require-sqlite`): bellekteki depoda yeniden başlatma, çağrıdan önce yazılan ödeme ve iade kayıtlarını silerdi. `VC_PAYMENTS_WEBHOOK_SECRET` bu modda kullanılmaz; `DODO_*_LIVE` anahtarı varsa site başlamaz. Bu modda:
- Kredi yalnız iki kaynaktan, aynı tek kapıdan yazılır: Dodo'nun imzalı bildirimi (`/api/payments/webhook`) ya da sunucunun Dodo'ya kendi sorduğu ödeme durumu. Tarayıcıdan gelen hiçbir şey (dönüş adresindeki `payment_id` / `status` dahil) kredi yazmaz. Bir ödeme en fazla bir kez kredi yazar.
- **Mutabakat (webhook gelmese de):** dakikalık tarama (`ops/payments-sweep.sh`) ödenmemiş Dodo oturumlarını ve sonuçlanmamış iadeleri Dodo'ya sorar: bir turda en çok 10 kayıt, kayıt başına 1 istek, yeniden deneme yok; Dodo hata verirse kayıt değişmez, sonraki turda yeniden sorulur. Müşteri ödemeden dönünce dönüş sayfası da kendi kaydını sorar (kayıt başına 5 saniyede en çok bir kez, bir hesabın bütün sayfaları için dakikada en çok 20 soru; sınırı aşan bakış Dodo'ya sormaz, kayıtlı durumu gösterir). Oturumu biten (24 saat) kayıt 10 dakika daha sorulur (bizim süremiz Dodo oturumu açmadan önce yazıldığı için Dodo'nunki biraz sonra biter), ondan sonraki ilk kesin cevapla kapanır; Dodo 3 gün boyunca cevap veremezse kayıt kredisiz kapanır ve `reconcile-gave-up:` işareti düşer. Okunan ödeme kurala uymuyorsa `reconcile-refused:<neden>:` ya da `payment-review:` düşer; bu üç durumda kayıt, kredisi yazılana dek "Kredisi yazılmayan ödemeler" tablosunda nedeniyle görünür. İlk kez okunan ödemenin tamamı Dodo'da zaten geri gitmişse (tek iade ya da toplamı tamamı eden kısmi iadeler) kredi aynı yazımda donuk yazılır ve `refund-review:` düşer; yalnız bir kısmı geri gitmişse ya da iade sürüyorsa kredi yazılır, işaret düşer. Cevabı gelmeyen iade Dodo'daki iade listesinden sonuçlanır (toplamı tamamı eden kısmi iadeler tam iade sayılır); Dodo'da hiç iade yoksa gönderimden 1 saat sonra krediler geri döner (`refund-not-found:`). Dodo gönderime "bu ödemenin zaten iadesi var" demişse boş liste krediyi geri vermez: iki cevaptan biri yanlıştır, kayıt "İade gönderildi" kalır ve `refund-conflict:` düşer (Dodo'nun sonradan listelediği ya da bildirdiği iade yine sonuçlandırır). Gönderimden 3 gün sonra hâlâ sonuçlanmamış iade bir kez daha sorulur, sonra sorulmaz (`stale-refund:`); kredi değişmez, Dodo'nun bildirimi (panelden yeniden gönderilebilir) yine sonuçlandırır. **İkinci bakış (bildirimi kaçan panel iadeleri için):** turun kalan istekleriyle kredisi yazılmış Dodo ödemeleri de yeniden okunur: ödeme başına saatte en çok bir kez, yalnız son 90 günün ödemeleri, en uzun süredir bakılmayan önce (son bakış kayıtta: `refundsReadAt`). Önce sorulması gereken oturum ve iadeler 10 isteğin hepsini alsa bile bakışın turda 2 isteği kendine ayrılıdır (açık bırakılmış ödeme sayfaları bakışı durduramaz): bir tur en çok 12 istek atar, bakış en yavaş halinde saatte 120 ödemeye bakar. Ödemenin listesindeki her başarılı iade, bildirimi gelmiş gibi aynı kuraldan geçer: kısmi iade `refund-review:` düşürür ve paketi dondurmaz, toplamı ödenenin tamamını eden iadeler paketi dondurur, tutarı bilinmeyen iade yalnız işaretlenir; bizim gönderdiğimiz iade, yanında geri gitmiş dış parçalarla ödenenin tamamını ediyorsa `refunded` olur. Bildirimi de gelen iade bir kez sayılır. Dodo hata verirse o bakış sessizce geçilir; `fake` kipte hiç çalışmaz.
- Kredi için ödeme USD olmalı, vergisi bildirilmiş olmalı, sepette yalnız o paketin ürünü (1 adet) bulunmalı ve vergi hariç tutar paket fiyatına eşit olmalı. Uymayan ödeme kredi yazmaz; `site.json` içinde `paymentsState.attention` listesine `payment-review:<neden>:<ödeme kaydı>` düşer (elle bakılır) ve ödeme, kredisi yazılana dek yönetici ekranında (Gelir → "Kredisi yazılmayan ödemeler") alıcısı, paketi, tutarı ve nedeniyle görünür.
- Aynı listede görülebilecek diğer işaretler: `second-payment:` (aynı oturumda ikinci başarılı ödeme), `refund-review:` (bizim göndermediğimiz ya da kısmi iade: Dodo panelinden yapılmış olabilir; ödemenin tamamı geri gittiyse paket itirazdaki gibi dondurulur: krediler harcanamaz, müşteri isteği geri alamaz; bizim iademiz daha önce başarısız olmuş ya da sonradan başarısız olan pakette de böyledir: geri dönen krediler tutulur. Çıkışı: yönetici iadeyi buradan gönderir, Dodo "zaten iade edilmiş" der ya da bir sonraki okumada o iadeyi listeler, kayıt `refunded` olur ve işaret kalkar. Daha ağır bir işaret hafifiyle değişmez: `disputed` > `refund-review` > ötekiler), `refund-unknown:` (iade isteğinin sonucu bilinmiyor: yanıt gelmedi ya da Dodo "iade yok" anlamına geldiği bilinmeyen bir yanıt verdi; yeniden gönderilmez, kredi geri dönmez, Dodo'nun bildirimi sonuçlandırır; iade `refunded` olunca işaret listeden kalkar), `refund-refused:` (Dodo iadeyi, iade yapılmadığı kesin olan bir nedenle reddetti: `REFUND_WINDOW_EXPIRED`, `PAYMENT_NOT_SUCCEEDED`, `ZERO_AMOUNT_PAYMENT_REFUND_NOT_ALLOWED`, `INSUFFICIENT_WALLET_FUNDS` (Dodo cüzdanındaki bakiye iadeye yetmiyor: satırda ve iade penceresinde nedeni yazar; bakiye yetince yeniden gönderilir); krediler geri döndü, müşteriye "iade gönderildi" postası gitmedi, yönetici yeniden gönderebilir), `payment-review:no-account:` (hesabı silinmiş birinin ödemesi: kredi yazılacak kimse yok), `checkout-not-opened:` (ödeme sayfası açılamadı), `disputed:` (itiraz: paket donduruldu; Dodo `dispute.won` bildirirse paket itirazdan önceki durumuna döner ve işaret kalkar, kaybedilen itirazda donuk kalır). `disputed`, `refund-review` ve `second-payment` işaretleri yönetici ekranında (Gelir → Satın almalar) ilgili satırın durumunun altında da yazar; sonuçlanmamış iadenin durumu da orada yazar: sonucu bilinmeyen ("sonuç bekleniyor"; iade penceresi de bu durumda "para yolda" demez), Dodo'nun iki cevabı çelişen, 3 günü geçen ve Dodo'da bulunamadığı için kredisi geri dönen iade. Bir satırda tek işaret görünür: önce donduranlar, sonra iadeninki, sonra ötekiler.
- Webhook yanıtları: `200` = işlendi ya da etkisiz saklandı (neden yanıtta yazmaz, `paymentsState.unhandled` içinde tür + nedenle durur; gövde saklanmaz); `400` = imza geçersiz ya da gövde UTF-8 değil; `503` = iade / itiraz henüz kaydı olmayan bir ödemeyi anlatıyor ve olay bir saatten yeni (Dodo sonra yeniden gönderir; bir saatten eski olay `200` alır ve `unknown-payment` nedeniyle saklanır: beklediğimiz bir ödeme değildir. Bu notta olayın türü ile adlandırdığı ödeme ve iade kimliği de durur: o ödemenin kredisi sonradan yazılırsa (webhook ya da tarama) tam iade ve itiraz krediyi donuk yazar, kısmi ya da başarısız iade yalnız `refund-review` işareti bırakır); `500` = kayıt yazılamadı (Dodo yeniden gönderir).

### Sağlayıcı: site ve worker aynı değeri okur

`VC_PROVIDER` env dosyasında **tek** yerde durur; web de worker da aynı dosyayı yüklediği için ayrışamaz (biri `magnific`, öbürü `fake` olursa site gerçek para tahsil edip worker sahte video üretirdi). `health.sh` ayrıca worker'ın kendi bildirdiği sağlayıcıyı env dosyasıyla karşılaştırır. `magnific`'e geçmeden önce `docs/launch-checklist.md`. Geçiş: `VC_PROVIDER` satırını elle `'magnific'` yap, `set-secret.sh MAGNIFIC_API_KEY`, ikisini de `kickstart -k` ile yeniden başlat.

### Ağ: yalnız 127.0.0.1

`run.sh` siteyi `next start -H $VC_BIND_HOST -p $VC_PORT` ile başlatır; varsayılan `127.0.0.1:3000`. `0.0.0.0` / `::` hiçbir yerde kabul edilmez (`install.sh`, `run.sh`, `health.sh`).
- **Tailscale (isteğe bağlı, bilinçli):** kurulumda `--bind-host 100.x.y.z` ya da env dosyasındaki `VC_BIND_HOST` satırını o adresle değiştirip web'i yeniden başlat. Önce `docs/runbook.md` bölüm 5 ve 13.
- **`--trust-proxy`** (`VC_TRUST_PROXY=1`): yalnız bu Mac'te çalışan bir proxy'nin (örn. `tailscale serve`) siteye giden **tek** yol olduğu durumda. Proxy yoksa `x-forwarded-for` başlıkları sahtelenebilir; bu yüzden `--bind-host 127.0.0.1` dışında reddedilir.
- **`VC_TRUST_PROXY='cloudflare'`** (kurulum seçeneği yok; env dosyasına elle yazılır): site bir Cloudflare Tunnel (`cloudflared`) arkasındayken. Çağıranın adresi yalnız Cloudflare'in yazdığı `cf-connecting-ip` başlığından okunur; `x-forwarded-for` okunmaz (Cloudflare ona yalnız ekleme yapar, ilk parçası çağıranın kendi sözüdür). Varsayım: site loopback'te (`VC_BIND_HOST` `127.0.0.1` ya da `::1`) dinler ve tünel tek giriş yoludur; başka bağlamada `run.sh` ve sitenin kendisi başlamaz (`site-not-started: cloudflare-proxy-requires-loopback`). Sahip testi kipinde izin verilen tek proxy değeri budur (`preflight.sh`).

## Yedek

`backup.sh` her çalışmada `~/viralclone-backups/YYYYMMDD-HHMMSS/` açar: `db.sqlite` (tutarlı kopya, `integrity_check` doğrulanır), `site.json` (JSON olarak doğrulanır; kullanıcı e-postaları ve şifre özetleri içerir, bu yüzden klasör `0700`, dosyalar `0600`), `MANIFEST.sha256`. Worker çalışırken güvenle alınır. Elle: `ops/backup.sh`; deneme: `ops/backup.sh --dry-run`.

- **Silme yok:** `--keep N` (varsayılan 14) aşılırsa en eskiler yalnız **listelenir**; silmeyi sen yaparsın.
- **Kapsam sınırı:** `uploads/`, `retired/` ve veri klasöründeki video/görsel dosyaları yedeğe girmez (büyük). Müşteri videosu ve yüklemeler yalnız bu Mac'te durur: ayrıca kopyalanması gerekiyorsa `docs/launch-checklist.md`.
- **Aynı disk:** varsayılan yedek klasörü veri ile aynı diskte; diskin ölmesine karşı korumaz. `VC_BACKUP_DIR`'ı harici bir diske ayarlayabilirsin. Veri ya da yedek klasörünü **Nextcloud/iCloud gibi eşitlenen bir klasöre koyma** (SQLite ve `site.json` çakışma dosyası üretir).
- Son yedek 36 saatten eskiyse `health.sh` uyarır.

### Geri yükleme (elle, bilerek)

```
launchctl bootout gui/$UID/app.viralclone.web
launchctl bootout gui/$UID/app.viralclone.worker
mv ~/viralclone-data ~/viralclone-data.bozuk-$(date +%Y%m%d-%H%M)       # silme, kenara al
mkdir -m 700 ~/viralclone-data
cp ~/viralclone-backups/<TARİH>/db.sqlite ~/viralclone-backups/<TARİH>/site.json ~/viralclone-data/
chmod 600 ~/viralclone-data/site.json
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/app.viralclone.worker.plist
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/app.viralclone.web.plist
ops/health.sh
```

`site.json` ile `db.sqlite` aynı anın kopyası olmalıdır (aynı `<TARİH>` klasöründen). Yüklemeler/medya yedekte yoksa, geri yüklenen kayıtlarda o dosyalar eksik görünür.

## Sağlık: `health.sh`

Kontrol eder (okuma-yalnız): env dosyası modu `600`; `VC_SESSION_SECRET` ≥ 32; `VC_PROVIDER`; `CLAUDE_CODE_OAUTH_TOKEN` (ve `magnific`'te `MAGNIFIC_API_KEY`) dolu mu; bağlama adresi; web ve worker launchd'de `running` mi; `/login` 200 ve güvenlik başlıkları; port yalnız beklenen adreste mi dinliyor (`*:PORT` ise FAIL: açık bir dev sunucusu da bunu yakalar); worker kalp atışı ≤ 90 sn, sağlayıcı env ile aynı, renderer `ready`, not boş; `site.json` modu `600`; boş disk ≥ 10 GB; son yedek yaşı. Çıkış kodu 0 = FAIL yok (uyarılar olabilir), 1 = en az bir FAIL.

## Geri alma: `rollback.sh`

```
ops/rollback.sh            # dry-run
ops/rollback.sh --apply    # web, worker, yedek durur; plist'ler ~/Library/Logs/viralclone/plists-removed-<tarih>/ altına taşınır
```

Env dosyası, veri ve yedekler olduğu gibi kalır; yeniden kurmak için `install.sh --apply --load`.

## Doğrulama notu

Bu kit yazıldığında hiçbir servis kurulmadı/başlatılmadı. `install.sh` (dry-run ve `HOME` geçici klasöre yönlendirilmiş `--apply`), `backup.sh` (gerçek bir SQLite dosyasıyla), `health.sh`, `set-secret.sh` (yazma mantığı), `rollback.sh` dry-run ve `run.sh` (`pnpm`/`node` yerine stub ile) çalıştırıldı; `shellcheck` makinede kurulu değil, betikler `bash -n` ve `zsh -n` ile sözdizimi kontrolünden geçti. Gerçek launchd yüklemesi ve gizli promptun gerçek terminalde yazılması ilk kurulumda sende doğrulanır.

### Gerçek e-posta (Resend)

Ana `~/.config/viralclone/env` dosyasında `VC_MAIL=resend`, `RESEND_API_KEY`, `MAIL_FROM` (doğrulanmış alanın gönderici adresi), `VC_MAIL_ALLOW` ve `INTERNAL_CRON_SECRET` (en az 32 karakter) doldurulur. Varsayılan `VC_MAIL=fake` gerçek e-posta göndermez. `VC_MAIL_ALLOW`, virgülle ayrılmış tam adresler veya tam alan adlarıdır; alan adı alt alanları kapsamaz. Tek başına `*` (başka öğe ve kısmi joker olmadan) her geçerli adrese gönderir: yalnız site herkese açılacağı zaman kullan. Boş/geçersiz liste veya eksik anahtar/gönderici siteyi `site-not-started` ile durdurur. `MAIL_FOOTER_ADDRESS` isteğe bağlıdır; boşsa adres satırı yoktur, marka her iki dilde Viral Clone'dur.

`ops/run.sh web` ana env'i yükler; `ops/payments-sweep.sh` aynı dosyayı okuyup her dakika siteye yetkili POST yapar. E-postayı site gönderir. E-posta için ayrı payments.env gerekmez; varsa mevcut ödeme ayarları ayrıca yüklenir. Ana mail değişkenlerini payments.env'de tekrar tanımlamayın. Env değişikliğinden sonra web'i yeniden başlatın. Gönderim durumları `/admin/emails` sayfasındadır; engellenen alıcılar `blocked-by-allowlist` olarak kalır ve listeye eklenince sonraki sweep'te denenir. 429/5xx ve bağlantı/zaman aşımı aynı mail kimliğiyle mevcut exponential backoff'u kullanır (en çok beş deneme); diğer HTTP hataları kalıcıdır ve attention kaydı oluşur. Gönderilmiş mail tekrar gönderilmez.

Resend modunda `VC_DEMO_LINKS=1` olsa bile doğrulama ve sıfırlama yardımcıları kapanır. Gerçek mailin bağlantısını kullanın. Sağlayıcı endpoint/auth/idempotency desteği **unverified**: yerel sahte HTTP sözleşme testleri geçti; canlı kabul ve teslim edilebilirliği sahibi doğrulamalıdır.

`ops/mail-smoke.sh --to ADDRESS` varsayılan dry-run'dır. Sahibi yalnız allowlist'teki adres için `VC_LIVE_MAIL=1 ops/mail-smoke.sh --to ADDRESS` ile **tek** e-posta gönderir; anahtarı argv/log'a basmaz, hatada otomatik tekrar yapmaz. Kabul ID'si inbox teslimini kanıtlamaz. Bu betik ajan tarafından canlı çalıştırılmadı. `RESEND_BASE_URL` yalnız `VC_MAIL_TEST=1` ile loopback sahte sunucu testleri içindir; gerçek mod endpoint'i `https://api.resend.com` olarak sabittir.

## Sahip test modu (yerel gerçek Magnific)

Bu mod gerçek Magnific parası harcar. Yalnız tek kullanıcılı loopback denemesi içindir; site ve worker aynı env dosyasını okur. Canlı kontrolleri yalnız sahip/ana yönetici çalıştırır.

1. Servisleri durdur; env dosyasını sahibine ait `0600` olarak koru. `VC_PROVIDER='magnific'`, `VC_OWNER_TEST='1'`, `VC_ENGINE='sqlite'`, `VC_BIND_HOST='127.0.0.1'` (veya `::1`), `VC_PORT='3203'` ayarla. `VC_TRUST_PROXY` satırını kaldır/boş bırak; site bir Cloudflare Tunnel arkasındaysa izin verilen tek değer `'cloudflare'`dir (yukarıda "Ağ" bölümü), `1` ve başka her değerle site ve worker başlamaz. `VC_DEMO_LINKS` boş olsun; Resend ile kullanılıyorsa `VC_MAIL='resend'` ve dolu/geçerli `VC_MAIL_ALLOW` zorunludur. Bu kipte listenin her öğesi tam adres olmalıdır: `*` ya da alan adı ile site başlamaz (`owner-test-forbids-open-mail-allowlist`), `preflight.sh` de `FAIL` der. Gerçek e-postada demo bağlantıları yine gösterilmez.
2. `VC_PROVIDER_DAILY_CAP='30'`, `VC_PROVIDER_JOB_CAP='26'` gibi pozitif tamsayı sınırları koy. **Bunlar doğrulanmış Magnific kredi/dolar fiyatları değil, muhafazakâr rezervasyon birimleridir:** görsel/müzik/ses = 1, klip = saniye. Örnek değerler bir fiyat veya uygun bütçe tavsiyesi değildir. Üretim, yeniden üretim, devam ve kuyruk kabulü sınırı kredi düşmeden denetler; hazırlama 1 birim ayırır (şimdiki hazırlama yerel araçlar kullanır).
3. Ödeme yoksa `VC_PAYMENTS` boş bırak ve krediyi admin'den ver. Sahte checkout istiyorsan `VC_PAYMENTS='fake'`, en az 32 karakterli `VC_PAYMENTS_WEBHOOK_SECRET` ve loopback `PUBLIC_BASE_URL` ayarla. Gerçek `test/live` ödeme adaptörü hâlâ desteklenmez. Anahtarları `ops/set-secret.sh` ile koy; bu belgeye/repoya değer yazma.
4. `ops/preflight.sh` salt okunur kontrol yapar. Whisper'ın ağsız çalıştığı kanıtlanmadıysa `FAIL … unverified` der; ilk indirmeyi operatör yapmalı, ardından ağ kapalıyken yerel ses ile tekrar doğrulamalıdır. `small.en` İngilizce, `large-v3` diğer diller için kullanılır.
5. İki servisi yeniden başlat. Site üstünde `OWNER TEST` bandını ve admin `Limits and safety` bölümünde sınırları gör. UTC günlük sayaç `db.sqlite` içindedir; yeniden başlatma veya kullanıcı kredisi iadesi sıfırlamaz. İade sınırdan rezervasyonu geri vermez. Reddedilmiş/belirsiz POST ve tekrar ücretli denemeler de tüketilir; yalnız GET resume yeniden tüketmez.
6. Operatör önce `ops/live-llm-check.sh` ile Claude izolasyonunu denetler. `ops/live-magnific-smoke.sh` varsayılan dry-run'dır; `--yes` **tek** desteklenen Nano Banana Pro görsel isteği yapar, tekrar POST yapmaz. Bu en az adetli desteklenen görsel isteğidir; en ucuz canlı model olduğu ve varsayılan çözünürlük fiyatı **unverified**. Beklenen sağlayıcı maliyeti/bakiye **unverified**: yerel adapter ve referans belgelerinde doğrulanmış bakiye ucu/tarife yoktur; uydurma uç çağrılmaz.
7. `<VC_DATA_DIR>/provider-spend.jsonl` ekleme-yalnız kayıt: zaman, run, kalem, intent/accepted/unfinished/completed, ticket, rezervasyon, maliyet/bakiye doğrulama durumu. Anahtar ve prompt yazılmaz. `submission-unknown` varsa elle incele; isteği yeniden gönderme. Müşteri bu işi hiçbir yolla sürdüremez (kredi kesilmez, posta ve sayfa "biz kontrol ediyoruz" der); yalnız yönetici ücretsiz "İşi tekrar dene" ile sürdürür. `worker.err.log` içindeki `produce-unknown: run <id> <kalem> … ticket|no-ticket` satırından isteği bul (işçi yanıt gelmeden öldüyse satır `worker-stopped no-ticket` der). `ticket`: sağlayıcı isteği almış, çözülecek bir şey yok; yönetici "İşi tekrar dene" der, sonuç biletle sorulur (GET), istek yeniden gönderilmez. `no-ticket`: Magnific'in görev listesine bak; görev orada yoksa yönetici İşler ekranında işin ayrıntısındaki "İstek sağlayıcıya ulaşmadı" ("Request never reached the provider") düğmesiyle ya da `viraleditor settle-unknown <run id> --by <ad>` komutuyla çöz, sonra işi yönetici "İşi tekrar dene" ile sürdür (komutla çözünce site eski nedeni göstermeye devam eder; "İşi tekrar dene" yine çalışır); görev listede varsa çözme (aynı parça iki kez ödenir). Çözmeden "İşi tekrar dene" denirse istek yeniden gönderilmez: iş hemen yeniden durur ve müşteriye ikinci bir "durdu" postası gider. Log/SQLite yazılamazsa sağlayıcıya gitmeden durur.

Sınır konulması API fiyatını ölçmez: B21'in gerçek Magnific bakiye/kredi/dolar alanları canlı sağlayıcı sözleşmesi doğrulanana kadar `unverified` kalır. Kalıcı rezervasyon ve POST tüketimi ayrı tutulur; ücret iadesi harcama yetkisini tekrar açmaz. Owner modundan çıkarken `VC_OWNER_TEST` kaldırılır; Magnific + sahte ödeme tekrar reddedilir.
