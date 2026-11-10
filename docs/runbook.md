# viraleditor: işletme el kitabı

Tek okuyucu: sahibi. Komutlar `/path/to/viral-clone` içinde, olduğu gibi çalıştırılır.
Veri klasörü: `VC_DATA_DIR` (verilmezse `<repo>/data`). İçinde `db.sqlite` ve üretilen dosyalar durur.

## 1. Başlatma ve durdurma

El ile (iki ayrı terminal):

```
cd /path/to/viral-clone
pnpm --dir viraleditor worker
pnpm --dir web build && pnpm --dir web start -H 127.0.0.1
```

⚠️ **Dikkat:** `launchd` ile çalışan worker (`app.viralclone.worker`) varsa ikinci worker AÇMA — iki worker aynı işin ara dosyalarına yazabilir. Kontrol: `launchctl print gui/$UID/app.viralclone.worker` komutuyla bak.

Durdurma: terminalde Ctrl+C (worker çalışan işi bitirip kapanır).

**Aynı anda birden çok inceleme ve video (şeritler).** Tek worker, birden çok incelemeyi ve birden çok video üretimini yan yana yürütebilir; ikinci worker açmak yerine bunlar ayarlanır. Hiçbiri verilmezse worker bugünkü gibi tek tek çalışır.

| Ayar | Anlamı | Varsayılan | Önerilen (10 çekirdekli bu Mac) |
|---|---|---|---|
| `VC_WORKER_PREPARE` | aynı anda kaç inceleme (1-16) | 1 (tek tek) | önce 4, günlükte `stage=` süreleri iyiyse 6-8 |
| `VC_WORKER_PRODUCE` | aynı anda kaç video üretimi (1-6) | 1 (tek tek) | önce 2; bir gün sorunsuzsa 3 (aşağıdaki "Video üretimini yan yana açma") |
| `VC_GATE_PROVIDER` | TÜM videolarda birlikte, aynı anda uçuştaki ücretli sağlayıcı isteği (1-12) | 3 (bir videonun tek başına bugün gönderdiği sayı) | 3; 6 yalnız bir gün boyunca `provider-spend.jsonl`'de `rejected` yoksa |
| `VC_GATE_RENDER` | aynı anda kaç render (1-4) | 1 (bir render zaten 4 Chrome işçisi açar) | 1; render kısa, işlemci boşsa 2 denenir |
| `VC_GATE_TRANSCRIBE` | aynı anda kaç konuşma çözme (whisper) | çekirdek ÷ 4, en az 1 (10 çekirdekte 2) | 2 |
| `VC_GATE_CHROME` | aynı anda kaç `hyperframes check` (Chrome) | çekirdek ÷ 4, en az 1 (10 çekirdekte 2) | 2 |

- Geçersiz değer (0, kesirli, sayı olmayan, sınırın üstü) worker'ı açık bir hatayla açtırmaz (hata değişkenin adını söyler); sessizce varsayılana dönmez.
- `VC_WORKER_PRODUCE` ve `VC_WORKER_PREPARE` ikisi de boş ya da 1 ise worker tek döngüdür: her türden tek iş, bugünkü gibi (ve inceleme ya da tarama da üretimi bekletir). Biri 1'den büyükse şeritler açılır: inceleme `VC_WORKER_PREPARE` tane, video üretimi `VC_WORKER_PRODUCE` tane, tarama ve düzenleme birlikte tek şerit. Tek döngüden şeritlere geçişte tarama ve düzenleme de üretimle yan yana koşar; bu bilinçlidir.
- **Sıra (adalet).** Video şeridinde sıra: önce devralınacak yarım iş (çöken ya da kapanırken geri verilen), sonra o an en az videosu çalışan müşterinin işi, eşitse en eskisi; şerit boş kalmaz. Müşteri başına aynı anda en çok `jobsAtOnce` (sitede, canlıda 2) video motora verilir; `VC_WORKER_PRODUCE` bundan büyük tutulur (3 > 2: bir şerit hep başka müşteriye açıktır).
- **Para.** Günlük sağlayıcı tavanı, iş tavanı, iş başı onay ve "belirsiz cevap yeniden gönderilmez" kuralları iş başına ve her ücretli istekte işler; kaç video yan yana koştuğundan bağımsızdır (kanıt: `viraleditor/src/robust/parallel-produce.test.ts`). `VC_GATE_PROVIDER` yalnız aynı anda uçuştaki istek sayısını sınırlar; bir istek kapıda beklerken henüz satırı yazılmamıştır (worker orada ölürse sahte `submission-unknown` doğmaz). Magnific'in kendi eşzamanlılık sınırı bilinmiyor: ücretli bir POST'a 429 gelirse istek reddedilir, birimler geri verilir ama o video durur; bu yüzden kapı bugünkü 3'te açılır, 6'ya yalnız yukarıdaki koşulla çıkılır.
- **Ücretli istek açıkken önce tavanı düşün.** Canlıda günlük tavan 100, bir büyük video 60 birim: tavan büyümeden müşteri günde 1-2 büyük videodan fazlasını zaten başlatamaz (`VC_PROVIDER_DAILY_CAP`, sahibin para kararı).
- Kapılar yalnız bekleyeni sıraya koyar (gelen sırayla); kapıya takılan iş hata almaz, yalnız bekler. Kapı sayısı `VC_WORKER_PREPARE`'den büyük olsa da etkisizdir. Video üretimindeki render kendi işçi sayısını ayrıca sınırlar; kapı ona dokunmaz.
- Doğru sayıyı günlük söyler: `worker.err.log` içindeki `stage=<port>.<yöntem> ms=<n>` satırları yalnız işin kendi süresini yazar (kapıda bekleme dahil değil); beklemek zorunda kalan her çağrı ayrıca `stage=gate.<ad> wait_ms=<n>` yazar (`gate.provider`, `gate.renderer.render`, `gate.aligner.align`, ...). `transcriber.words`, `renderer.check` ve `renderer.render` süreleri şeritler arttıkça uzuyorsa işlemci doluyor demektir (tek işteki sürenin 1,5 katını geçmesin): `VC_GATE_*` düşür; kısa kalıyorsa yükselt.
- Değişiklik için worker'ı yeniden başlat: `ops/worker-restart.sh` (launchd'de değer env dosyasına girer). **Üretim sürerken worker yeniden başlatılmaz:** bir video yapılırken kesilen, o an sağlayıcıya giden (birkaç saniyelik) istek `submission-unknown` olur ve bölüm 9'daki gibi elle çözülür; şeritlerle bu bir değil birkaç video olabilir. `ops/worker-restart.sh` çalışan video varsa reddeder ve kaç tane olduğunu söyler; bitmelerini bekle. `--force` yalnız acildir (uyarır, sonucu yukarıdaki), `--dry-run` ne yapacağını yazar ve hiçbir şeye dokunmaz. Aynısı `launchctl kickstart -k gui/$UID/app.viralclone.worker` için de geçerlidir: betik varken onu elle kullanma.

**Video üretimini yan yana açma (adım adım).** Açmak tek satır ayar, geri kapamak aynı satırı silmek.

1. **Parasız deneme (sahte sağlayıcı).** Otomatik hâli: `pnpm --dir viraleditor exec vitest run src/e2e/parallel.test.ts` (iki müşteri, beş video, `VC_WORKER_PRODUCE=3`: 3'ü aynı anda, ikinci müşterinin ilk işi birincinin üçüncüsünden önce, 55 istek tam bir kez, hepsi biter). Elle denemek için ayrı bir klasörde: `VC_DATA_DIR=<geçici klasör>`, `VC_PROVIDER` boş (sahte üretici), `VC_LLM_SCRIPT=<cevap dosyası>`, `VC_FAKE_DELAY_MS=20000`, `VC_WORKER_PRODUCE=3` ile worker; iki müşteriden 5 video kuyruğa konur. Bakılacak: 3'ü aynı anda `running`; `fake-generator.log` satır sayısı beklenen kadar (çift yok); günlükte `stage=gate.*` satırları; hepsi `done`.
2. **Canlıda açma.** `~/.config/viralclone/env` dosyasına `VC_WORKER_PRODUCE='2'` satırı eklenir (dosya `0600` kalır; kapılar varsayılanda kalır). Çalışan video YOKKEN önce `ops/worker-restart.sh --dry-run`, sonra `ops/worker-restart.sh`; ardından `ops/health.sh`. Worker açılmazsa `worker.err.log` hatayı değişkenin adıyla söyler. Varsayılan `VC_GATE_PROVIDER=3` ile `VC_WORKER_PRODUCE=2` Magnific bekleme süresini kısaltmaz (iki video aynı 3 yeri paylaşır); asıl kazanç kapı 6 ile gelir (adım 4).
3. **En küçük gerçek para doğrulaması (yalnız sahibi; gerçek Magnific parası).** İki ayrı kullanıcıyla en ucuz şablonla (≈18 birim: 1 resim, 15 sn klip, müzik, ses) aynı anda birer video ≈ 36 birim. Bakılacak: ikisi de aynı anda ilerliyor; `<VC_DATA_DIR>/provider-spend.jsonl`'de her istek için tek `intent` ve tek `accepted`; `provider_budget.consumed` toplamı gönderilen birimlere eşit; günlükte `produce-unknown` ve `rejected` yok; `stage=renderer.render ms` tek işteki sürenin 1,5 katını geçmiyor.
4. **Artırma.** Bir gün sorunsuzsa `VC_WORKER_PRODUCE='3'`. `VC_GATE_PROVIDER='6'` yalnız `provider-spend.jsonl`'de bir gün boyunca `rejected` (429) yoksa. `VC_GATE_RENDER` 1'de kalır. Süre uzuyorsa bir önceki sayıya dön.
5. **Geri kapama.** Env dosyasından `VC_WORKER_PRODUCE` (ve eklendiyse `VC_GATE_*`) satırını sil; çalışan video yokken `ops/worker-restart.sh`. Worker bugünkü tek döngüye döner. Videolar sürerken kapatmak gerekiyorsa önce bitmelerini bekle; bekleyemiyorsan `--force` ve sonrasında bölüm 9.
Site `VC_ENGINE=sqlite` ile worker'ın veritabanını (`<VC_DATA_DIR>/db.sqlite`) okur ve yazar; kendi kayıtlarını (kullanıcılar, krediler, iş kayıtları) `<VC_DATA_DIR>/site.json` içinde tutar. Bu modda `VC_DATA_DIR` zorunlu, ikisine de aynı klasör verilir:

```
VC_ENGINE=sqlite VC_DATA_DIR=/yol/data VC_ADMIN_PASSWORD=<12+ karakter> pnpm --dir web start -H 127.0.0.1
```

Site yalnız bu Mac'ten (`127.0.0.1`) açılır; başka cihazdan açmak bölüm 5'te, giriş ve oturum ayarları bölüm 13'te.

Worker'ı siteden önce bir kez başlat: veritabanını o kurar (yoksa site `engine-db-missing`, tablolar yoksa `engine-db-not-migrated` hatası verir).

**Yetim `held` işler.** Site, bir işi worker'a `held` olarak devreder, kendi kaydını (`site.json`) diske yazar, sonra işi `queued` yapar. Site bu iki adımın arasında ölürse iş `held` kalır. Site açılırken ve uzun yaşayan süreçte, iş durumu ya da sağlık bilgisi okunurken (en çok 5 dakikada bir kez), son devri 5 dakikadan eski her `held` iş `site.json`'a bakılarak düzeltilir; 5 dakikadan gençlere dokunulmaz (başka bir sürecin canlı devri olabilir). Düzeltme:

- `site.json`'da işi var ve ilk başlatma: `queued` (worker alır).
- Devam ettirme (`reason` ya da `missing` dolu): yalnız `site.json`'daki iş `running` ise ve bu devam ettirmenin işaretini taşıyorsa serbest bırakılır; yoksa `stopped` durumuna döner ve bu devam ettirmeyle onaylanan istekler (`approved`) geri alınır.
- `site.json`'da işi yok: hiç `operations` satırı yoksa satır silinir (şablonun `times_generated` sayısı bir azalır); `operations` satırı varsa iş `stopped` olur, neden `engine-error`.

Her düzeltme log'a `engine-orphan-settled: run <id>` yazar; `site.json` okunamıyorsa hiçbir şey düzeltilmez ve `engine-orphans-not-settled: site.json cannot be read` görünür.

**`site.lock`.** Bir veri klasöründe yalnız bir site süreci düzeltme ve yükleme temizliği (bölüm 12) yapar: `<VC_DATA_DIR>/site.lock` o sürecin pid'ini tutar. Sahibi artık yaşamayan kilit kendiliğinden devralınır, kapanırken kilit bırakılır; elle silmek gerekmez. Kilit başka canlı bir süreçte ise ikinci site normal çalışır ama hiçbir şeyi düzeltmez ve temizlemez; log'da `engine-settlement-skipped: another site process holds site.lock in <klasör>` görünür. Aynı klasörde iki site süreci (örneğin `next start` iki kez) başlatma. Yarıda ölmüş bir kaydın `site.json.<pid>.tmp` artıkları site açılırken silinir.

launchd ile: kurulum kiti `ops/` (ayrıntı: [ops/README.md](../ops/README.md)). Gizli bilgiler tek bir `0600` env dosyasında (`~/.config/viralclone/env`) durur; web ve worker aynı dosyayı `ops/run.sh` ile yükler, böylece `VC_PROVIDER` ikisinde ayrışamaz. Hiçbir betik kendiliğinden bir şey kurmaz: `install.sh` varsayılan olarak dry-run'dır.

```
ops/install.sh                          # dry-run: ne yazılacağını gösterir
ops/install.sh --apply                  # env dosyası + 4 plist (web, worker, günlük yedek 03:30, ödeme taraması 60 sn); servis başlamaz
ops/set-secret.sh CLAUDE_CODE_OAUTH_TOKEN
ops/install.sh --apply --load           # worker, site, yedek başlar
ops/health.sh                           # sağlık kontrolü (çıkış kodu 1 = bir şey bozuk)
```

Yeniden başlatma ve kaldırma:

```
ops/worker-restart.sh                   # worker; çalışan video varsa reddeder (--force acil durum için, --dry-run yalnız söyler)
launchctl kickstart -k gui/$UID/app.viralclone.web
ops/rollback.sh --apply                 # durdurur, plist'leri kenara taşır (silmez); env dosyası, veri ve yedekler kalır
```

## 2. Loglar

```
tail -n 50 ~/Library/Logs/viralclone/worker.err.log
tail -n 50 ~/Library/Logs/viralclone/worker.out.log
tail -n 50 ~/Library/Logs/viralclone/web.err.log
tail -n 20 ~/Library/Logs/viralclone/backup.err.log
ops/health.sh
```

Sahte üreticinin istek günlüğü: `<VC_DATA_DIR>/fake-generator.log` (`VC_FAKE_GENERATOR_LOG` ile değişir). Worker sağlık bilgisini her 30 sn `db.sqlite` içindeki `health` satırına yazar:

```
sqlite3 "$VC_DATA_DIR/db.sqlite" "SELECT value FROM health WHERE id = 1"
```

## 3. Örnek veri (seed)

```
pnpm --dir viraleditor seed
pnpm --dir viraleditor seed --json
```

## 4. Veri klasörünü sıfırlama

Önce `ops/backup.sh` ile yedek al, worker ve siteyi durdur. Sonra klasörü taşı (silme):

```
mv "$VC_DATA_DIR" "$VC_DATA_DIR.eski-$(date +%Y%m%d-%H%M)"
```

Kaybolanlar: `db.sqlite` içindeki her şey (ayarlar, adaylar, şablonlar, işler, `operations` kayıtları) ve klasördeki üretilmiş/indirilmiş dosyalar. Sağlayıcıda gönderilmiş ücretli istekler geri alınmaz; `operations` kayıtları gidince hangi isteğin gittiği de kaybolur. Yeniden başlatınca boş bir veritabanı kurulur; `seed` ile örnek veri dolar.

## 5. İkinci cihazdan site (Tailscale)

Site varsayılan olarak yalnız bu Mac'in kendi adresinde (`127.0.0.1`, port 3000) dinler: launchd plist'i ve yukarıdaki el komutları `-H 127.0.0.1` ile başlar. Aynı Wi-Fi'deki ya da tailnet'teki başka cihazlar siteye ulaşamaz. (`next start` bir `HOSTNAME` ortam değişkenine bakmaz; yalnız `-H` bayrağı geçerlidir.)

İkinci cihazdan açmak **bilinçli bir seçimdir**; önce bölüm 13'teki giriş ayarlarının (`VC_SESSION_SECRET`, `VC_ADMIN_PASSWORD`) yapıldığından emin ol. Mac'in Tailscale adresini Tailscale uygulamasından oku (`100.x.y.z`, menü çubuğu), ikinci cihaz aynı tailnet'te olsun. Sonra siteyi yalnız o adreste dinlet:

```
pnpm --dir web start -H 100.x.y.z
```

launchd'de env dosyasındaki (`~/.config/viralclone/env`) `VC_BIND_HOST` satırı o adresle değiştirilir (kurulumda `ops/install.sh --bind-host 100.x.y.z`), `launchctl kickstart -k gui/$UID/app.viralclone.web` ile yeniden başlatılır. `0.0.0.0` ve `::` `ops/run.sh` tarafından reddedilir; `ops/health.sh` port tüm arayüzlerde dinliyorsa FAIL verir. Sonra ikinci cihazdan:

```
http://100.x.y.z:3000
```

`-H 0.0.0.0` (tüm arayüzler, Wi-Fi dahil) kullanma. Tailscale arkasında HTTPS (`tailscale serve`) kurulursa site çerezi `Secure` işaretiyle gelir (istek `x-forwarded-proto: https` taşıdığında); düz HTTP'de işaret konmaz. Başka bir port gerekirse: `pnpm --dir web start -H 127.0.0.1 -p 3100` (launchd'de env dosyasında `VC_PORT`).

**Proxy arkasında (`VC_TRUST_PROXY=1`).** Anonim işlemlerin hız sınırı (bellekte, süreç başına: kayıt 5/saat, giriş 10/10 dk, şifre sıfırlama 10/saat ve e-posta başına 3/10 dk, yeni şifre ve doğrulama e-postası yeniden gönderme; `web/src/core/rate-limit/rate-limit.ts`) istemciyi `x-forwarded-for` / `x-real-ip` başlığından tanır; bu başlıklar yalnız `VC_TRUST_PROXY=1` ise okunur, değilse tüm istekler tek paylaşılan anahtar (`local`) sayılır ve sınırları 10 kat geniştir (bir betik herkesi kilitleyemesin diye). Yalnız siteye giden **tek** yol bu Mac'teki bir proxy (`tailscale serve` gibi) ise aç; site doğrudan erişilebilir bir adreste dinliyorsa açma, başlıklar sahtelenebilir (`ops/install.sh --trust-proxy` yalnız `127.0.0.1` bağlamayla kabul edilir).

**Cloudflare Tunnel arkasında (`VC_TRUST_PROXY=cloudflare`).** İstemci yalnız Cloudflare'in yazdığı `cf-connecting-ip` başlığından tanınır; `x-forwarded-for` / `x-real-ip` okunmaz (Cloudflare `x-forwarded-for`'a yalnız ekleme yapar, ilk parçası istemcinin kendi sözüdür). IPv6 istemcinin kovası /64 ağıdır; tek adres olmayan bir değer paylaşılan kovaya düşer. Varsayım: site loopback'te dinler (`VC_BIND_HOST` `127.0.0.1` ya da `::1`) ve `cloudflared` tek giriş yoludur; başka bağlamada site başlamaz (`site-not-started: cloudflare-proxy-requires-loopback`, `ops/run.sh` de reddeder). Sahip testi kipinde (`VC_OWNER_TEST=1`) izin verilen tek proxy değeri budur; `1` reddedilir. Değer env dosyasına elle yazılır (web ve worker aynı dosyayı okur), sonra ikisi de yeniden başlatılır (`web/src/core/rate-limit/trusted-proxy.ts`).

**Sıra (`cloudflare` değeri).** Değeri yalnız onu tanıyan kod kabul eder. Önce yeni kodu al, siteyi derle ve iki servisi de (web ve worker) yeni kodla yeniden başlat; değeri env dosyasına ancak **ondan sonra** yaz ve ikisini bir kez daha yeniden başlat. Değer yazılı, kod ya da derleme eskiyse site de worker da başlamaz (kapalı tarafa düşer, para riski yok; log'da `site-not-started`). Geri dönerken tersi: eski koda dönmeden ve `ops/rollback.sh`'tan **önce** `VC_TRUST_PROXY` satırını boşalt, yoksa eski kod bu değerle başlamaz.

**Sahip testi ve gerçek e-posta: yasak bileşim.** `VC_OWNER_TEST=1` iken `VC_MAIL=resend` ise `VC_MAIL_ALLOW`'un her öğesi tam adres olmalıdır. `*`, alan adı, boş öğe ya da boş liste ile site başlamaz (`site-not-started: owner-test-forbids-open-mail-allowlist`); `ops/preflight.sh` de `FAIL` der. Neden: sahip testinde sahte ödeme sayfası açıktır, yabancıyı dışarıda tutan tek kapı posta listesidir.

**Davetli kip.** Gerçek e-postada (`VC_MAIL=resend`) liste tek başına `*` değilse site davetli kiptedir: listenin dışındaki adres hesap açamaz (hesabı olsa da olmasa da cevap aynıdır) ve doğrulama postası yalnız listedeki adrese gider. Kapı kayıtta ve doğrulamadadır: listeden çıkarılan ama önceden doğrulanmış bir hesap giriş yapıp üretmeye devam eder; birini çıkarırken hesabını Yönetim → Kullanıcılar'dan da engelle.

## 6. HyperFrames: doctor, Chrome önbelleği, kare önbelleği

Her HyperFrames komutu şu üç anahtarla çalışır (telemetri ve güncelleme kontrolü kapalı):

```
export HYPERFRAMES_NO_TELEMETRY=1 DO_NOT_TRACK=1 HYPERFRAMES_NO_UPDATE_CHECK=1
```

Sağlık kontrolü (sürüm 0.8.120, Node, FFmpeg, Chrome, kare önbelleği yolu):

```
cd viraleditor
node_modules/.bin/hyperframes doctor
pnpm viraleditor doctor
```

Kare önbelleği (çıkarılmış video kareleri; `doctor` yolunu "Frames cache" satırında gösterir, bu makinede birkaç GB olabilir). Önce ne silineceğine bak, sonra sil:

```
node_modules/.bin/hyperframes clean --dry-run
node_modules/.bin/hyperframes clean
```

Chrome önbelleği (render için indirilen `chrome-headless-shell`, `~/.cache/hyperframes/chrome/` altında):

```
node_modules/.bin/hyperframes browser path
node_modules/.bin/hyperframes browser ensure
node_modules/.bin/hyperframes browser clear
```

`clear` sonrası bir sonraki render için `ensure` indirme yapar (ağ trafiği; bilerek çalıştır).

## 7. Komut satırını PATH'e bağlama

```
ln -s /path/to/viral-clone/viraleditor/src/cli/main.ts <PATH'teki bir klasör>/viraleditor
```

Sonra `viraleditor doctor` her yerden çalışır (dosya çalıştırılabilir ve `node` kabuk yolunda olmalı).

## 8. Gerçek sağlayıcıya geçiş (yalnız sahibi)

Varsayılan `VC_PROVIDER=fake`: hiçbir ücretli istek gitmez. Gerçek için worker ortamına şunlar girer: `VC_PROVIDER=magnific` ve `MAGNIFIC_API_KEY=<anahtar>`. Anahtarı yalnız sahibi koyar, hiçbir dosyaya işlenmez, repoya girmez. launchd'de env dosyasına `ops/set-secret.sh MAGNIFIC_API_KEY` ile yazılır (gizli prompt; plist'e girmez); el ile başlatırken:

```
MAGNIFIC_API_KEY=... VC_PROVIDER=magnific pnpm --dir viraleditor worker
```

Ödeme hattının gizli bilgileri ayrı bir `0600` dosyada (`~/.config/viral-klon/payments.env`, `ops/README.md`); gerçek ödeme bağdaştırıcısı olmadığından `VC_PROVIDER=magnific` ile site şu an `site-not-started` verir. Site de **aynı** `VC_PROVIDER=magnific` ortamıyla başlar (launchd kurulumunda tek env dosyasından; ayrı verilirse web gerçek para tahsil edip worker sahte video üretebilir ya da tersi); o zaman `VC_SESSION_SECRET` ve `VC_ADMIN_PASSWORD` zorunludur (bölüm 13): biri yoksa site açılmaz (çıkış kodu 1, log'da `site-not-started`), sahte ödeme ve sahte e-posta onayı sayfaları kapalıdır.

`VC_PROVIDER=magnific` olup anahtar yoksa worker sahte üreticiye DÖNMEZ: her ücretli istek `not-configured` ile reddedilir ve `health` notu "MAGNIFIC_API_KEY is not set" der.

Worker'ın model çağrıları (`claude -p`) sahibin kendi girişi olmadan, boş bir HOME ile çalışır: `CLAUDE_CODE_OAUTH_TOKEN` şarttır (`claude setup-token` ile alınır; `ops/set-secret.sh CLAUDE_CODE_OAUTH_TOKEN` ile env dosyasına yazılır, repoya girmez). Yoksa her model çağrısı reddedilir, `health` notu "CLAUDE_CODE_OAUTH_TOKEN is not set: model calls are refused" der ve çalışma `engine-error` ile durur (sebep worker log'unda).

Deneme için sahte üretici ayarları (isteğe bağlı): `VC_FAKE_GENERATOR_LOG`, `VC_FAKE_FAIL_CLIP` (N. klip hata verir), `VC_FAKE_DELAY_MS`. Modelsiz deneme: `VC_LLM_SCRIPT=<cevap dosyası>` (`{"answers":[{"match":"...","answer":...}]}`).

## 9. `unknown` durumundaki işlem satırını çözme

Bir `operations` satırı `unknown` ise, istek sağlayıcıya gitmiş olabilir ya da olmayabilir. İş bu yüzden durur (`submission-unknown`) ve o satır için hiçbir devam denemesi tekrar göndermez: bilerek böyle. Çözüm elle:

1. Bakılacak satırlar:

```
sqlite3 "$VC_DATA_DIR/db.sqlite" "SELECT run_id, key, kind, external_id, updated_at FROM operations WHERE state = 'unknown'"
```

2. Sağlayıcının panelinde (Magnific) o zamanda böyle bir görev var mı bak.
3. Görev VARSA ve dosyası alındıysa, dosyayı veri klasörüne koy ve satırı `done` yap (`output`: veri klasörüne göre dosya yolu, `external_id`: panelden görev kimliği):

```
sqlite3 "$VC_DATA_DIR/db.sqlite" "UPDATE operations SET state = 'done', output = '<dosya yolu>', external_id = '<görev kimliği>', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE run_id = '<run_id>' AND key = '<key>'"
```

4. Görev YOKSA satırı `failed` yap:

```
sqlite3 "$VC_DATA_DIR/db.sqlite" "UPDATE operations SET state = 'failed', error = 'sağlayıcıda görev yok (elle doğrulandı)', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE run_id = '<run_id>' AND key = '<key>'"
```

Sütunlar `viraleditor/schema.sql` içindeki `operations` tablosundan: `run_id, key, kind, state, external_id, output, error, created_at, updated_at`. Worker durmuşken yap.

**Satırı çözmek işi yeniden başlatmaz.** İş `stopped` durumunda kalır. Devam ettirmek sitenin işidir: iş sayfasındaki "devam et" adımı (müşteri) ya da yönetimdeki "yeniden dene" eksik kalan istekleri onaylar (`approved = approved + missing`), işi `held` yapar, site kendi kaydını diske yazınca `queued` yapar; worker oradan alır ve çözülmüş satırı bir daha göndermez. Elle komut gerekmez. Kontrol:

```
sqlite3 "$VC_DATA_DIR/db.sqlite" "SELECT ref, state, approved, missing FROM runs WHERE id = '<run_id>'"
```

`ref` sitedeki iş kimliğidir (`/jobs/<ref>`).

## 10. İlk ücretli deneme kontrol listesi (yalnız sahibi)

1. Sayıyı ve kredi tavanını önceden yaz: tek bir Fast, konuşmasız video için kaç görsel / klip (klip saniyesi) / müzik / ses ve toplam kredi üst sınırı.
2. Anahtar okunabilir mi: `echo ${#MAGNIFIC_API_KEY}` sıfırdan büyük bir sayı vermeli (anahtarı ekrana basma).
3. `VC_PROVIDER=magnific` ile worker'ı başlat; `health` satırında `provider` `magnific`, `note` boş olmalı.
4. Tek bir iş çalıştır.
5. Karşılaştır:
   - Gönderilen istek = onaylanan istek: işin `sent` ve `approved` alanları eşit olmalı:
     `sqlite3 "$VC_DATA_DIR/db.sqlite" "SELECT approved, sent FROM runs WHERE kind = 'produce' ORDER BY created_at DESC LIMIT 1"`
   - Sağlayıcı panelindeki istek sayısı ve harcanan kredi aynı sayılar.
   - Çıkan videonun boyutu ve süresi şablonunkiyle uyuşuyor:
     `pnpm --dir viraleditor viraleditor probe <video>`
6. Uyuşmazlık varsa dur, ikinci deneme yapma; `unknown` satırı varsa bölüm 9.

## 11. Tarama: kaynaklar, hashtag aramaları, durma nedenleri

Tarama `scanTimes` saatlerinde (varsayılan 09:00, 15:00, 21:00; yerel saat) kaynak başına bir `scan` işi olarak çalışır. Ayarlar yönetim sayfasında (Ayarlar) ya da `db.sqlite` içindeki `settings` satırında durur.

**Top Ads.** Creative Center sayfasını sistem Chrome'u ile açar, kartları okur, beğeniye göre sıralar ve en çok `topAdsCards` (varsayılan 30) tanesini tutar. Her kart kendi video dosyasının adresini taşır (en yüksek çözünürlüklü olan); aday satırında `candidates.video` olarak saklanır. Hazırlama (prepare) sayfa adresini değil bu dosyayı indirir; şablonun kaynağı yine sayfa adresidir. Video dosyası olmayan kart atlanır. Dosya indirilemezse hazırlama `source-unavailable` ile biter.

**YouTube Shorts.** Kaynak, `searches` listesindeki her hashtag için `https://www.youtube.com/hashtag/<etiket>/shorts` sayfasını `yt-dlp` ile okur:

- Etiket: baştaki `#` atılır, küçük harfe çevrilir, boşluklar silinir (`Skin Care` → `skincare`). Aynı etikete çıkan iki yazım tek arama olur; iki etikette çıkan video bir kez alınır.
- Sayfanın ilk 60 satırı okunur; `shortsMinViews` (varsayılan 500000) ve üstü, daha önce görülmemiş olanlar en çok izlenenden başlayarak ayrılır, hashtag başına en çok `perScan` (varsayılan 15) tanesinin ayrıntısı (kesin izlenme ve süre) istenir (aynı anda 3).
- Yönetim sayfasında hashtag'ler satır satır yazılır (en çok 50; her biri en çok 100 karakter, yalnız harf, rakam, `_`); Shorts açıksa en az bir hashtag zorunludur. Veritabanında `searches` boşsa (varsayılan) Shorts taraması hiçbir şey bulmadan `done` biter.
- Bir hashtag okunamazsa atlanır; hepsi okunamazsa tarama durur.

**İki kaynakta ortak süzgeç.** Süresi `secondsMin`–`secondsMax` (6–35 sn) dışında olanlar ve daha önce görülmüş adresler elenir; bir tarama kaynak başına en çok `perScan` yeni aday tutar. Günlük sınırlar: `dailyCandidates` (puanlanan aday, 45) ve `dailyTemplates` (10).

**Durma nedenleri.** Durmuş bir tarama yönetim sayfasında nedeniyle görünür. İki neden var: `source-unavailable` (Top Ads sayfası cevap vermedi ya da hiçbir hashtag okunamadı) ve `scan-failed` ("Tarama beklenmedik bir hatayla durdu…": taramanın kendi kodunda beklenmedik bir hata, ya da bir tarama işi üç kez sahipsiz kaldı ve karantinaya alındı, bölüm 14). Motor ikincisini `scans.reason = 'engine-error'` olarak yazar; site onu `scan-failed` olarak gösterir. Tarama bir sonraki planlı saatte kendiliğinden yeniden çalışır; yine duruyorsa nedenin kodu: `sqlite3 "$VC_DATA_DIR/db.sqlite" "SELECT ref, reason, detail FROM runs WHERE kind = 'scan' AND state = 'stopped' ORDER BY updated_at DESC LIMIT 5"` (kodların anlamı bölüm 14) ve `worker.err.log` (bölüm 2).

## 12. Yüklenen ürün fotoğrafları

Müşterinin yüklediği fotoğraf `<VC_DATA_DIR>/uploads/<uuid>/1.<jpg|png|webp>` olarak durur; yanında yükleyenin kimliğini tutan `uploader` dosyası vardır. Tür dosyanın ilk baytlarından anlaşılır (ad değil); en çok 10 MB.

- **Kota:** bir kullanıcı 24 saatte en çok 100 fotoğraf yükleyebilir (son 24 saatte yazılmış, onun işaretini taşıyan klasörler sayılır). Aşılınca form "bugün çok fotoğraf eklediniz, yarın dene" der (`upload-quota`); elle bir şey yapmak gerekmez, kota 24 saat içinde kendiliğinden açılır. Sınır kodda sabittir: `web/src/data/real/uploads.ts` içinde `UPLOADS_PER_DAY`.
- **Temizlik:** hiçbir işin girdisinde adı geçmeyen ve 2 günden eski yükleme klasörleri site açılırken silinir (en çok 1000; yalnız `site.lock` (bölüm 1) sahibi süreç yapar). Bir işin kullandığı fotoğraf kalır. Temizlik başarısız olursa log'da `uploads-sweep-failed: …` görünür, site yine açılır.

**Yüklenen videolar ("Kendi videonu ekle", dosya).** Tarayıcı dosyayı `POST /api/uploads/video` ile gönderir (oturum şart, doğrulanmış e-posta şart, `Content-Length` zorunlu ve en çok 101 MiB, farklı kaynaktan `Origin` reddedilir); dosya `<VC_DATA_DIR>/uploads/<uuid>/source.mp4` olarak durur (yanında `video.json`: boyut, süre, en-boy, sha256; `uploader`; `video-reservation`). Gerçek kap, süre ve şekli ffprobe okur, tarayıcının söylediği yalnız bilgidir. Sınırlar: mp4/mov (`ftyp` kabı), en çok 100 MiB, en çok 60 sn, dikey 9:16, kullanıcı başına günde 10 deneme (reddedilenler de sayılır). Reddedilince HTTP kodu: 415 tür, 413 boyut, 429 kota, 422 süre/en-boy, 400 ya da 500 diğer; müşteri formda ilgili mesajı görür, ücret alınmaz. Dosya yalnız yükleyene ve yöneticiye `/media/uploads/<uuid>/source.mp4` altında sunulur. Bir işte kullanılmayan yükleme 2 gün sonra aynı temizlikle (yukarıda) kenara alınır; süresi dolan medya bölüm 15'teki gibi `retired/` altına taşınır.

## 13. Güvenlik: giriş, oturum, başlık ayarları

**Oturum.** `vc_session` çerezi imzalıdır: `<kullanıcı>.<giriş>.<bitiş>.<hmac-sha256>`; anahtar `VC_SESSION_SECRET` ortam değişkeninden gelir (en az 32 karakter; örnek: `openssl rand -base64 32`). Çerez 30 gün geçerlidir ve site kullanıldıkça yenilenir, ama oturum girişten en geç 90 gün sonra biter; `HttpOnly`, `SameSite=Lax`, istek https ise `Secure`. Eski biçimde çerez (`vc_session=usr-admin`) ve değiştirilmiş ya da süresi geçmiş çerez "oturum yok" sayılır. Çıkış yapmak oturumu her cihazdan çıkarır (sunucuda kapanır), çalınmış çerez de geçersiz olur. Bu sürümden sonra herkes bir kez yeniden giriş yapar (eski biçimdeki çerezler geçmez). İki şey oturumları toptan sonlandırır: anahtarı (`VC_SESSION_SECRET`) değiştirmek **tüm** oturumları; bir kullanıcının **şifresini bağlantıyla sıfırlaması** yalnız o kullanıcının eski oturumlarını (kullanıcı kaydındaki `sessionVersion` artar, eski çerez `/login?reason=expired` açar, şifre sıfırlama otomatik giriş yapmaz). Engelli hesap `/blocked`'a, yönetici olmayanın `/admin` isteği 403'e gider. Kayıttan sonraki oturum yalnız e-posta doğrulama içindir: doğrulanmamış kullanıcı iş akışına ve ücretsiz videoya erişemez (bölüm 16).

- `VC_SESSION_SECRET` yoksa ve ücretli mod yoksa: site rastgele bir anahtarla açılır, log'da bir kez uyarır; her yeniden başlatmada herkes çıkış yapmış olur.
- `VC_PROVIDER=magnific` (ücretli mod) ise anahtar yoksa ya da 32 karakterden kısaysa site açılmaz (`site-not-started: session-secret-required` / `session-secret-too-short`).
- `VC_DEMO_LINKS=1`: üretim derlemesinde (`next start`) sahte modda bile "bağlantıyı açtım" ve şifre sıfırlama bağlantısı yardımcıları kapalıdır, çünkü bağlantıyı sayfaya soran herkese verirler; yalnız sahibinin kendi Mac'inde demo için açılır (`ops/install.sh --demo-links`) ve yalnız site loopback adresine (`127.0.0.1`) bağlıyken, `VC_TRUST_PROXY` boşken çalışır; yönetici hesabı için sıfırlama bağlantısı hiç gösterilmez. Ücretli modda (`VC_PROVIDER=magnific`) her zaman kapalıdır. Gerçek e-posta bağlanana kadar doğrulama ve sıfırlama bu yardımcılara bağlıdır.
- Değerler repoya girmez, plist'lere de yazılmaz: launchd kurulumunda `~/.config/viralclone/env` (`0600`) içinde durur (`ops/install.sh` üretir, `ops/set-secret.sh` değiştirir; bölüm 1).

**Şifreler.** Şifre `scrypt` ile, kullanıcı başına rastgele tuzla özetlenir (`site.json` içindeki `credentials` listesi; `User` kaydında durmaz, dosya yalnız sahibine okunur: `0600`). Yanlış şifre ile bilinmeyen e-posta aynı cevabı verir; 5 yanlış deneme e-postayı 15 dakika kilitler. Şifre sıfırlama yalnız e-postadaki bağlantı ile çalışır (1 saat geçerli, tek kullanımlık; kullanılınca o kullanıcının öbür sıfırlama bağlantıları da geçersiz olur); bağlantısız `resetPassword` hiçbir şifreyi değiştirmez. Gerçek bir e-posta sağlayıcısı henüz bağlı değildir: e-postalar gönderilmez, `site.json` içindeki `outbox` listesinde birikir (`docs/launch-checklist.md`).

- **Sahte mod (varsayılan, `VC_ENGINE` yok):** örnek hesapların hepsi (`demo@viralclone.app`, `admin@viralclone.app`, ...) şifre `demo-password` ile girer. Değiştirmek: `VC_DEV_PASSWORD=<şifre>`; yalnız yönetici için: `VC_ADMIN_PASSWORD=<12+ karakter>`.
- **Gerçek motor (`VC_ENGINE=sqlite`) ve ücretli mod:** varsayılan şifre YOKTUR. İlk `site.json` yazılmadan önce `VC_ADMIN_PASSWORD` (en az 12 karakter) verilmelidir; yoksa site `admin-password-required` ile ilk kaydı yapmaz. Örnek müşteri hesaplarının (`demo@...`) şifresi yoktur, giriş yapamazlar (`VC_DEV_PASSWORD` bilerek verilirse alırlar). Şifre eklenmeden önce yazılmış bir `site.json` varsa, yönetici `VC_ADMIN_PASSWORD` ile açılışta şifresini alır; verilmemişse log'da `admin-has-no-password` uyarısı çıkar ve yönetici o zamana kadar giremez.
- Yönetici şifresini değiştirmek: siteyi durdur, `site.json` içinde `credentials` listesindeki `usr-admin` satırını sil (dosyayı önce yedekle), yeni `VC_ADMIN_PASSWORD` ile başlat.

**Başlıklar** (`web/next.config.ts`, her sayfada): `Content-Security-Policy` (`default-src 'self'`; görsel / medya / yazı tipi: `'self' data: blob:`; script ve stil için `'unsafe-inline'`, çünkü Next'in kendi başlangıç kodu satır içi; üretimde `unsafe-eval` yok; `frame-ancestors 'none'`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `Permissions-Policy` (kamera, mikrofon, konum vb. boş izin listesi). Kontrol: `curl -I http://127.0.0.1:3000/login`.

## 14. Duran işler: nedenler, karantina, kodlar

Bir `runs` satırı `stopped` ise `reason` makine kodu, `detail` (varsa) ham hata metni **değil**, izin verilen kısa bir tanı kodudur:

```
sqlite3 "$VC_DATA_DIR/db.sqlite" "SELECT id, kind, ref, reason, detail, takeovers FROM runs WHERE state = 'stopped' ORDER BY updated_at DESC LIMIT 20"
```

| `detail` | Anlamı |
|---|---|
| `handler-error` | işleyici beklenmedik bir hatayla bitti (ayrıntı: `worker.err.log`) |
| `handler-incomplete` | işleyici bitti ama işi sonuçlandırmadı |
| `llm-error` | model çağrısı (`claude -p`) başarısız: çoğu zaman `CLAUDE_CODE_OAUTH_TOKEN` yok ya da geçersiz |
| `tool-timeout` / `tool-failed` | ffmpeg, yt-dlp, HyperFrames gibi bir araç süre aştı / hata verdi |
| `database-error` | SQLite hatası |
| `takeover-limit` | karantina (aşağıda) |
| `invalid-run-json` | işin girdisi okunamadı |

**Karantina (`takeover-limit`).** Worker ölür ya da takılırsa (kalp atışı 60 sn'den eski) başka bir worker işi devralır. Devralma en çok 3 kez yapılır (`runs.takeovers`; işi çalışanın kendi isteğiyle geri bırakması sayılmaz). Dördüncüsünde iş `stopped` / `engine-error` / `takeover-limit` olur: aynı işin sonsuz çöküş döngüsüne girmesi bu şekilde durdurulur. Hazırlıktaki şablon `failed` (`engine-error`) olur (başka bir etkin hazırlık yoksa); tarama `scan-failed` olarak görünür. Müşteri işinde site "yeniden dene" (yönetim) ya da "devam et" (müşteri) ile işi yeniden kuyruğa alır. Aynı iş tekrar tekrar karantinaya giriyorsa nedenini `worker.err.log`'da ara, tekrar deneme. Kuyruk adaleti: 5 dakikadan fazla bekleyen iş, türüne bakılmadan öne geçer (üretim normalde önceliklidir).

**Sitenin gösterdiği kodlar** (`web/src/data/ports.ts`; kod bilinmiyorsa site genel mesajını gösterir): iş durma nedenleri `adaptation-failed`, `images-failed`, `clips-failed`, `audio-failed`, `render-failed`, `submission-unknown` (bölüm 9), `estimate-exceeded`, `llm-invalid`, `template-missing`, `engine-error`, `content-rule` (devam ettirilemez); şablon hazırlama notları `below-threshold`, `unsupported`, `split-screen`, `too-long`, `check-failed`, `source-unavailable`, `llm-invalid`, `daily-cap`; kendi videonu ekle reddi `type`, `size`, `length`, `ratio`, `unreadable`, `link-not-found`, `private`, `removed`, `unsupported-site`; ürün fotoğrafı reddi `type`, `size`, `unreadable`, `too-many`; iş kapanma nedeni `customer` / `expired`; ödeme durumu `open`, `pending`, `paid`, `declined`, `cancelled`, `expired`; satın alma `paid`, `not-completed`, `refund-requested`, `refund-sent`, `refunded`, `refund-failed`.

**Log'da görünen kodlar:** `engine-orphan-settled`, `engine-orphans-not-settled`, `engine-settlement-skipped` (bölüm 1), `engine-db-missing`, `engine-db-not-migrated`, `engine-close-failed` (kapanışta veritabanı kapanmadı, yeniden denenmez), `uploads-sweep-failed` (bölüm 12), `media-retirement-pending: N` / `media-retirement-failed` (bölüm 15), `site-not-started`, `admin-password-required`, `admin-has-no-password` (bölüm 13).

## 15. Medya süresi ve `retired/`

Müşteri medyası (`/media/…`) şu sürelerden sonra **sunulmaz** (`RULES`, `web/src/data/ports.ts`): bitmiş videolar 12 takvim ayı, ödenmiş ara görseller (`jobs/<koşu>/paid`) iş bittikten ya da durduktan 30 gün, durmuş işin kendisi 30 gün; kapatılmış (`closed`) ya da hesabı silinmiş kullanıcının işi, yüklemesi ve özel şablonunun kaynağı hemen. Süresi dolmuş bir dosya yönetici işaretiyle bile açılmaz (404).

Dosyalar **silinmez**, sunulmayan bir ağaca taşınır: `<VC_DATA_DIR>/retired/<jobs|uploads|sources|templates>/<kimlik>` (`jobs` altında ödenmiş ara görseller `retired/jobs/<koşu>/paid`). Taşıma site açılırken ve (en çok 5 dakikada bir, `site.lock` sahibi süreçte) çalışırken yapılır; bir seferde en çok 1000 klasör; etkin (`held`/`queued`/`running`) bir koşunun işine, yayınlanmış şablonun kaynağına ve 2 günden gençlere dokunulmaz. Çakışma ya da yeniden adlandırma hatasında kaynak olduğu yerde kalır ve bir sonraki taramada yeniden denenir; log'da `media-retirement-pending: N`.

Bu **fiziksel silme değildir**: `retired/` disk yer tutar, yedek ya da fiziksel imha anlamına gelmez. Yer açmak ve yasal saklama süresi dolanı kalıcı silmek sahibinin elle yapacağı iştir (önce ne silineceğine bak: `du -sh "$VC_DATA_DIR"/retired/*`). Gizlilik metni de fiziksel silmeyi garanti etmez; `docs/launch-checklist.md`.

## 16. Ücretsiz ilk video: kalıcı hak

Ücretsiz video, e-posta **doğrulandığı anda** ve yönetici ayarı (`freeFirstVideo`) açıkken verilir. Hak e-postanın özetine bağlıdır: küçük harf, boşluksuz, `+etiket` atılmış adresin SHA-256'sı (`a+x@b.com` ile `a@b.com` aynı). Özet `site.json` içindeki `freeEntitlements` listesinde durur ve hesap silinse de kalır: aynı adresle yeniden kayıt ikinci bir ücretsiz video vermez. Özetin yazıldığı yerde e-posta adresi tutulmaz. Doğrulanmış ama özet kaydı olmayan eski bir `site.json` açılışta tamamlanır. Birine hakkı istisna olarak yeniden vermek: siteyi durdur, `site.json`'u yedekle, o özeti listeden sil.

## 17. Testler: komutlar

Hepsi `/path/to/viral-clone` içinde. Aynı anda en çok 2 render / e2e / `vitest run`; boş disk ≥ 10 GB.

```
pnpm --dir web typecheck && pnpm --dir web test                  # site: tip + birim testleri
pnpm --dir viraleditor typecheck && pnpm --dir viraleditor test  # motor (render gerektirmeyenler)
pnpm --dir viraleditor test:render                               # render testleri (VE_RENDER=1; Chrome + ffmpeg, yavaş)
node web/scripts/check-legal.mjs                                 # yasal metinler (bölüm 18)
```

**Site e2e (sahte depo, `next dev`):** `pnpm --dir web e2e` (port 3100; doluysa `VC_E2E_PORT=3116 NEXT_DIST_DIR=.next-e2e pnpm --dir web e2e`; ikinci `next dev` `tsconfig.json`'a `.next-*` satırı ekler, işin bitince o satırı geri al). Tek dosya: `pnpm --dir web e2e e2e/session.spec.ts`.

**Gerçek e2e (üretim derlemesi + gerçek worker + sahte sağlayıcı + gerçek SQLite):** önce derle, sonra çalıştır; port 3200 sabit (`web/e2e/real/world.ts`), bu yüzden o portta başka bir şey çalışmamalı:

```
cd web
NEXT_DIST_DIR=.next-real pnpm build
pnpm real:e2e                          # tüm e2e/real/*.spec.ts
pnpm real:e2e auth.spec.ts             # tek dosya
```

Testler siteyi ve worker'ı kendileri başlatır (geçici veri klasörü, `VC_FAKE_GENERATOR_LOG`, `VC_LLM_SCRIPT`); gerçek `claude`, Magnific, ödeme ya da e-posta çağrısı yapılmaz. Çıktı: `web/test-results-real/`. Her kaynak değişikliğinde yeniden `build` gerekir.

## 18. Yasal metinler: yayından önce

```
node web/scripts/check-legal.mjs
```

Her iki dildeki (`web/src/messages/{en,tr}/marketing.json`, `legal`) metni tarar. `[LEGAL TEXT]` kalmışsa hata verir (çıkış kodu 1); her `[OWNER TO CONFIRM: …]` işareti için bir uyarı yazar (çıkış kodu 0): bunlar işletici adı, ödeme/e-posta sağlayıcısı, saklama süreleri, hukuki dayanak, iletişim e-postası gibi **senin dolduracağın** kararlardır. Metinler hukuki tavsiye değildir; yayından önce avukat incelemesi gerekir (`docs/launch-checklist.md`).

## 19. Render kararlılığı (C1d, açık)

Aynı belge bazen kare kare aynı çıkmayabilir (render 1'in 8 karesi farklı çıkan bir koşu görüldü; son 40 render aynıydı). Kök neden **bilinmiyor** (`docs/plans/2026-10-05-c1d-render-investigation.md`). Şu an: süpürme testi katıdır (`VE_RENDER=1 VE_SWEEP_LOG=<dosya> pnpm --dir viraleditor exec vitest run src/sweep/repeat.render.test.ts`). Müşteriye teslim edilen her video (şablonun kendi örnek videosu hariç) yayından önce ikinci bir renderla kare kare karşılaştırılır (`verifyRepeat`, `viraleditor/src/produce/assemble.ts`). İki render aynıysa yayımlanır. Farklıysa üçüncü render yapılır: ilk ikisinden birini tekrarlıyorsa o yayımlanır ve `worker.err.log`'a tek satır düşer (`render-picture-mismatch: <dosya> render 3 repeats render <1|2>, published`; canlıdaki oran bu satırlardan sayılır). Üçü de farklıysa `render-picture-unstable` ile **yayımlanmaz**: iş `render-failed` ile durur, ücretli istek yinelenmez. En çok 3 render yapılır; render süresi 2 katına (uyuşmazlıkta 3 katına) çıkar. Müşteriye gösterilen süre tahmini iki render sayar; daha önce hazırlanmış şablonların kayıtlı dakikası kendiliğinden değişmez, aşağıdaki komutla yenilenir. Bilinen sınır: kontrol "doğru mu"yu değil "iki kez aynı mı"yı ölçer; her renderda aynı çıkan bozuk kare yakalanmaz.

**Kayıtlı dakikayı yenileme (`backfill-minutes`).** Ne zaman: süre formülü değişen bir sürüm canlıya alındıktan sonra bir kez (yoksa eski şablonlarda "beklenenden uzun sürüyor" uyarısı erken çıkar). Önce kuru koşu, sonra yazan koşu:

```
VC_DATA_DIR=<veri klasörü> pnpm --dir viraleditor backfill-minutes            # kuru koşu: hangi şablon kaç dakikadan kaça gider, hiçbir şey yazmaz
VC_DATA_DIR=<veri klasörü> pnpm --dir viraleditor backfill-minutes --apply    # dakikaları yazar
```

Parasızdır: indirme, model, ücretli istek ve anahtar yok; `VC_DATA_DIR` verilmezse durur. Yalnız `templates.minutes` sütununu yazar (hazır, yayında ve gizli şablonlarda; güncelleme tarihi, kart, ücret tahmini ve dosyalar aynı kalır). Her şablon için tek satır (`<id>: 5 -> 7 min`) ve sonunda `updated` / `unavailable` listesi basar. `unavailable`: veri klasöründe okunabilir `templates/<id>/template.json` yok ya da satır o anda değişti; o şablonun dakikası olduğu gibi kalır. İkinci koşu `updated: []` verir (dakikası doğru olan satır yazılmaz). Geri alma: veritabanını yedekten döndür (`ops/backup.sh`; eski dakikalar kuru koşunun çıktısında da yazar).

## 20. Sağlayıcının kredisi bitince: ücretli istek kilidi

**Ne zaman kurulur.** Sağlayıcı ücretli bir isteği "kredi yok" diye reddederse (HTTP 402; başka ret kodu kurmaz) worker veritabanına tek satırlık bir kilit yazar (`provider_hold`: hangi işin hangi isteği, ne zaman). Kilit durdukça hiçbir iş yeni ücretli istek göndermez: süren işler bir sonraki ücretli isteğinde, yeni işler modele sorulmadan önce `provider-credits` ile durur; hiçbir şey harcanmaz, müşterinin kredisi geri döner, biten parçalar saklanır. Daha önce gönderilmiş ve bilet almış bir isteğin sonucu kilit dursa da ücretsiz sorularak alınır. Kilit bir veritabanı satırıdır: worker'ı ya da Mac'i yeniden başlatmak onu kaldırmaz.

**Nasıl kalkar.** Sağlayıcı hesabına kredi yüklemek kilidi **kendiliğinden kaldırmaz**; kilit süreyle de açılmaz. Yüklemeden sonra bu nedenle durmuş bir işi yeniden dene (Yönetim → İşler → iş → "İşi tekrar dene"). Yalnız `provider-credits` ile durup yeniden denenen iş kilidin içinden geçirilir: ilk ücretli isteği sağlayıcıya sorulur. Sağlayıcı kabul ederse kilit o anda kalkar ve öbür işler de (yeniden denenince) ve yeni işler de açılır. Yine 402 verirse kilit yenilenir, iş yeniden durur; 402 ücretsizdir. Durmuş iş kalmadıysa (müşteri kapattıysa) yeni bir iş başlat: kilide takılıp hemen `provider-credits` ile durur, onu yeniden dene. Satırı elle silme.

**Nereden görülür.**

- Site: Yönetim → Ayarlar'da sağlayıcı satırı "Bağlı" der ve altında kredi uyarısı çıkar ("Ayarlı değil" anahtar ya da tavan eksikliğidir, kredi değil); Genel bakış'ın üstünde aynı uyarı bandı; İşler'de durma nedeni "Sağlayıcı kredisi bitti".
- `ops/health.sh`: `warn  provider credits: the provider has no credits left (refused run <iş> at <an>) …`. Kilit `health` kaydının `note` alanında değil, kendi alanındadır (`noCredits`; kilit yokken `null`).
- `worker.err.log`: kurulurken `provider-credits: run <iş> <istek> was refused, no new paid request is sent`, kalkarken `provider-credits: run <iş> <istek> was accepted, the hold is lifted`.
- Veritabanı (satır varsa kilit duruyor, yoksa yok):

```
sqlite3 -readonly "$VC_DATA_DIR/db.sqlite" "SELECT at, run_id, key FROM provider_hold"
sqlite3 -readonly "$VC_DATA_DIR/db.sqlite" "SELECT id, ref, updated_at FROM runs WHERE state = 'stopped' AND detail = 'provider-credits' ORDER BY updated_at DESC LIMIT 20"
```

## 21. Kişi değiştirme (videodaki insanı fotoğraftakiyle değiştir)

**Açma / kapama.** Yönetim → Ayarlar → "Kişi değiştirme". İki ayrı anahtar var, ikisi de "Kaydet"le geçerli olur, yeniden başlatma gerekmez:

- **"Müşterilere kişi değiştirme"** (bayrak): açıkken müşteriler kişi değiştirme sayfalarını görür ve iş başlatabilir.
- **"Üretimden önce fotoğraflara bak"** (ön onay): açıkken her iş, bir yönetici fotoğraflarına bakıp onaylayana kadar bekler. İlk açılışta AÇIK başlat.

**Bayrağı kapatınca ne olur.** Yeni iş başlatılamaz, sayfalar gizlenir. Ama zaten içeride olan işler **kendiliğinden iade olmaz**:

- Ön onayda bekleyen iş beklemeye devam eder: yönetici cevaplar (onay / ret) ya da 48 saat dolar (aşağıda).
- Ücreti kesilmiş, sırada bekleyen iş sırası gelince başlar ve üretilir.
- Çalışan iş biter.

Hepsini hemen kapatmak istiyorsan ön onay kuyruğundakileri tek tek reddet (kredisi döner); sıradakileri Yönetim → İşler'den izle.

**Ön onay kuyruğu.** Yönetim → İşler → "Fotoğraf ön onayı (N)". En uzun bekleyen en üstte. Her işte müşterinin fotoğrafları görünür:

- **Onayla:** iş sıraya girer; fotoğraf o andan sonra yöneticiye gösterilmez.
- **Reddet:** iş kapanır, hiçbir şey üretilmez, kesilen kredinin tamamı döner, fotoğraflar hemen silinir, müşteriye e-posta gider. Geri alınamaz.
- **48 saat cevap yoksa** iş kendiliğinden reddedilmiş sayılır: kapanır (`expired`), kredi döner, fotoğraflar silinir. Müşteri beklerken kendisi de iptal edip kredisini geri alabilir.
- Ön onayı kapatmak bekleyen işleri serbest bırakmaz: onlar cevabını beklemeye devam eder; yalnız kapattıktan sonra başlayan işler bakılmadan üretilir.
- Ön onay KAPALIYKEN de yönetici bir işin fotoğrafını açabilir (silinene kadar: iş bittikten 24 saat sonra). Gizlilik metni bunu söylemeli (yasal taslak: `swap.tr.md`).

**"Bu ben değilim" bildirimi.** Müşteri, biten kişi değiştirme videosunda 7 gün içinde "Videodaki kişi ben değilim / izin vermedim" diye bildirebilir. Bildirim Destek kutusuna düşer (konu: sorun bildirimi, `not-me`). **Kendiliğinden hiçbir şey silinmez:** videoyu ve işi sen elle değerlendirirsin (Yönetim → İşler → iş). Öncelikli say: başkasının yüzü olabilir.

**Saklama süreleri** (kod: `web/src/data/ports.ts` `RULES`): kişi fotoğrafları iş bitince 24 saat sonra, reddedilince / iş kapanınca / hesap silinince hemen, duran işte en geç 7 gün sonra silinir; biten video 30 gün saklanır (ürün videolarındaki süre değil); müşteri "sil" derse hemen.

**Sağlayıcı sağlığı.** Kişi değiştirmenin sağlayıcısı ürün videolarınınkinden AYRIDIR (`VC_SWAP_PROVIDER`). Yönetim → Ayarlar'da "Kişi değiştirme sağlayıcısı" satırı: "Test modu" (sahte: hiçbir şey gönderilmez), "Bağlı" ya da "Ayarlı değil". Bu satır ürün sağlayıcısının satırını etkilemez. Nedenini `health` kaydı söyler:

```
sqlite3 -readonly "$VC_DATA_DIR/db.sqlite" "SELECT json_extract(value, '$.swap'), json_extract(value, '$.swapNote') FROM health WHERE id = 1"
```

- `swap`: `fake` | `ready` | `not-configured`. `swapNote`: `not-configured` iken neden (ör. `VC_SWAP_PROVIDER is not set: a worker that pays has no person-swap provider`); söyleyecek bir şey yoksa alan hiç yoktur.
- Ücretli worker (`VC_PROVIDER=magnific`) sahte kişi sağlayıcısını ASLA kurmaz: `VC_SWAP_PROVIDER` boşsa, `fake` ise ya da kuramadığı bir adsa her kişi işi `engine-error` / `provider-setup` ile durur, hiçbir istek gitmez, kesilen kredi döner. Yani **gerçek sağlayıcı bağlanmadan canlıda bayrağı açma**: her iş durur.
- `ops/health.sh` bu iki alanı henüz yazdırmaz; yukarıdaki sorguyla bak.

**Yayındaki kişi videosunu düzenleme.**

- Kişi SAYISINI değiştirirsen (1 ↔ 2), ön onayda ya da sırada bekleyen eski işlerin fotoğraf sayısı şablona uymaz: o işler başlarken `engine-error` ile durur (hiçbir istek gitmez, kredi döner). Yasak değil; değiştirmeden önce kuyruğun boş olmasına bak.
- Gerçek motorda "Kaydet"ten sonra sayfa "hazırlanıyor" gösterir ve "Yayınla" kapalı kalır: değişikliği worker yazar (boşta bekleme süresi kadar, ≈ 2 sn). Canlı yoklama yok: worker yazınca **sayfayı yenile**. Worker kapalıysa `pending` kalır ve yayınlanamaz.
- Nadir pencere: `swap.json` yerine kondu ama kayıt tutmadı (düzenleme işi `engine-error` ile durur; dosya yeni, kart eski). Kişi sayısı ayrıştıysa işler yukarıdaki gibi ücretsiz durur; aynıysa işler dosyadaki (son yazdığın) tarifle üretilir, kart eskisini gösterir. Kendiliğinden toparlanmaz: kişileri yeniden kaydet.

**İşçi bir parçanın ortasında ölürse.** Devralan işçi sağlayıcıya yeni istek GÖNDERMEZ. Bileti kayıtlı parçayı biletiyle sorar (ücretsiz). Bileti olmayan parça için iş `submission-unknown` ile durur ve log'a `produce-unknown: run <iş> <parça> worker-stopped no-ticket` yazılır: 9. bölümdeki gibi sağlayıcının görev listesine bakıp elle çözülür (istek sağlayıcıya ulaşmamışsa `settleUnknown`; ulaşmışsa DOKUNMA). Sağlayıcı bileti tanımıyorsa da iş `submission-unknown` ile durur; bilet silinmez, elle "ulaşmadı" denemez, her yeniden denemede biletle yeniden sorulur.

**Bilinen sınırlar.**

- iPhone'un HEIC dosyası reddedilir (`upload-type`); JPEG, PNG, WebP kabul edilir. Tarayıcının HEIC'i JPEG'e çevirip çevirmediği gerçek telefonda denenmedi.
- EXIF yön bilgisi taşıyan WebP / PNG sunucuda çevrilmeden ölçülür: dik çekilmiş fotoğraf nadiren "yatık" diye reddedilebilir.
- Sağlayıcının bozuk ya da reddettiği fotoğrafı faturalayıp faturalamadığı bilinmiyor (gerçek deneme gerekir).
- Gerçek sağlayıcı (fal) kodda henüz yok; bugün yalnız sahte sağlayıcı çalışır.
- Kişi videosunun yalnız başlık / kategori düzenlemesi boşa bir `edit` koşusu açar (`template-missing` ile biter, satır doğru kalır).
