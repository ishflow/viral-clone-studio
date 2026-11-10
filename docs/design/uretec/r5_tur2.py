"""Düzeltme turu 2, grup 5: A-Is-Durumlar, A-Uretimlerim-Durumlar ve E-Durdu gövdelerini yeniden yazar (baş ve betik kısmı dosyadan korunur).
Yeniden çalıştırılabilir. Ardından boy.py + variants.py."""
import os, re

P = './docs/design/tuval/project'


def rewrite(name, body):
    path = os.path.join(P, name + '.dc.html')
    s = open(path, encoding='utf-8').read()
    m = re.search(r'<div class="ay"[^>]*>\n', s)
    end = s.index('</x-dc>')
    s = s[:m.end()] + body.strip() + '\n</div>\n' + s[end:]
    open(path, 'w', encoding='utf-8').write(s)
    print('yazıldı:', name)


# ---- ortak parçalar -------------------------------------------------------------------------------------------------
WRAP = '<div style="max-width: 1320px; margin: 0 auto; padding-top: clamp(24px, 4vw, 48px); display: flex; flex-direction: column; gap: 32px">'
H1 = '<h1 style="margin: 0; font-family: var(--display); font-weight: 800; font-size: 32px; line-height: 1.1; letter-spacing: -0.02em">%s</h1>'
CELL = '<div style="flex: 1 1 400px; min-width: 0; max-width: 520px; display: flex; flex-direction: column; gap: 12px">'
WCELL = '<div style="flex: 1 1 560px; min-width: 0; max-width: 640px; display: flex; flex-direction: column; gap: 12px">'
LABEL = '<p style="margin: 0; font-size: 13px; line-height: 1.4; color: var(--text-3)">%s</p>'


def group(title, cells, first=False):
    top = '' if first else 'margin-top: 16px; '
    return (f'<section style="{top}display: flex; flex-direction: column; gap: 16px">\n'
            f'<h2 style="margin: 0; font-size: 20px; font-weight: 600; line-height: 1.25; color: var(--text)">{title}</h2>\n'
            '<div style="display: flex; flex-wrap: wrap; gap: 32px">\n' + '\n'.join(cells) + '\n</div>\n</section>')


def cell(label, inner, window=False):
    return f'{WCELL if window else CELL}\n{LABEL % label}\n{inner}\n</div>'


def svg(d, size=20, sw=2, style=''):
    st = f' style="{style}"' if style else ''
    return (f'<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="{sw}" '
            f'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"{st}><path d="{d}"></path></svg>')


I_INFO = 'M3.5 12a8.5 8.5 0 1 0 17 0a8.5 8.5 0 1 0 -17 0M12 11v5M12 7.8v.1'
I_WARN = 'M3.5 12a8.5 8.5 0 1 0 17 0a8.5 8.5 0 1 0 -17 0M12 8v5M12 16.2v.1'
I_CLOCK = 'M3.5 12a8.5 8.5 0 1 0 17 0a8.5 8.5 0 1 0 -17 0M12 7.5V12l3 2'
I_SPIN = 'M12 3.5a8.5 8.5 0 1 0 8.5 8.5'
I_DONE = 'M5 12.5l4.5 4.5L19 7.5'
I_RETRY = 'M19 12a7 7 0 1 1-2.05-4.95M17 3.5v3.6h-3.6'


def box(text, icon=I_INFO, bg='surface'):
    """Bilgi kutusu (vurgusuz)."""
    return (f'<p role="status" style="margin: 0; display: flex; align-items: flex-start; gap: 12px; padding: 12px 16px; border-radius: 12px; background: var(--{bg}); '
            'border: 1px solid var(--edge); font-size: 15px; line-height: 1.5; color: var(--text)">'
            + svg(icon, style='flex: 0 0 auto; color: var(--text-2)') + f'<span style="min-width: 0; overflow-wrap: anywhere">{text}</span></p>')


def warn(first, rest='', bg='surface'):
    """Uyarı kutusu: A-Onay-Yetersiz kalıbı (ilk cümle 600 ve --warn, kalan yazı --text)."""
    return (f'<p role="alert" style="margin: 0; display: flex; align-items: flex-start; gap: 12px; padding: 12px 16px; border-radius: 12px; background: var(--{bg}); '
            'border: 1px solid var(--warn-edge); font-size: 15px; line-height: 1.5; color: var(--text)">'
            + svg(I_WARN, style='flex: 0 0 auto; color: var(--warn)')
            + f'<span style="min-width: 0; overflow-wrap: anywhere"><strong style="font-weight: 600; color: var(--warn)">{first}</strong>{" " + rest if rest else ""}</span></p>')


ST = '<span style="display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 600; color: %s">%s%s</span>'
S_RUN = ST % ('var(--accent-text)', '<span style="width: 8px; height: 8px; border-radius: 50%; background: var(--accent-text)"></span>', 'Running')
S_STOP = ST % ('var(--warn)', '<span style="width: 8px; height: 8px; border-radius: 2px; background: var(--warn)"></span>', 'Stopped')
S_DONE = ST % ('var(--accent-text)', svg(I_DONE, 18, 2.6), 'Done')
S_QUEUE = ST % ('var(--text-2)', '<span style="width: 8px; height: 8px; box-sizing: border-box; border-radius: 50%; border: 2px solid var(--text-2)"></span>', 'In queue')
S_CLOSED = ST % ('var(--text-2)', '<span style="width: 8px; height: 8px; box-sizing: border-box; border-radius: 2px; border: 2px solid var(--text-2)"></span>', 'Closed')
S_GONE = ST % ('var(--text-2)', svg(I_CLOCK, 18, 2), 'No longer stored')

SECONDARY = ('display: flex; align-items: center; justify-content: center; box-sizing: border-box; border-radius: 12px; font: inherit; font-weight: 600; text-decoration: none; '
             'cursor: pointer; min-height: 52px; padding: 0 24px; border: 1px solid var(--edge-strong); background: transparent; color: var(--text); font-size: 15px')


# ---- A-Is-Durumlar --------------------------------------------------------------------------------------------------
def top(status):
    return ('<div style="display: flex; flex-direction: column; gap: 12px">\n' + status + '\n'
            '<h3 style="margin: 0; font-family: var(--display); font-weight: 800; font-size: 32px; line-height: 1.1; letter-spacing: -0.02em">Fragrance layering recipe</h3>\n'
            '<p style="margin: 0; font-size: 15px; color: var(--text-2)">4 products · Fast · 1 variant</p>\n</div>')


def strip(*parts):
    return '<div style="display: flex; flex-direction: column; gap: 24px">\n' + '\n'.join(parts) + '\n</div>'


def card(edge, label, title, text, *rest, until=False):
    u = '\n<p style="margin: 0; font-size: 15px; line-height: 1.5; font-weight: 600; color: var(--text)">You can continue until [DATE].</p>' if until else ''
    return (f'<section aria-label="{label}" style="box-sizing: border-box; padding: 24px; border-radius: 16px; background: var(--surface); border: 1px solid var(--{edge}); '
            'display: flex; flex-direction: column; gap: 24px">\n<div style="display: flex; flex-direction: column; gap: 8px">\n'
            f'<h4 style="margin: 0; font-family: var(--display); font-weight: 700; font-size: 24px; letter-spacing: -0.01em">{title}</h4>\n'
            f'<p style="margin: 0; font-size: 15px; line-height: 1.5; color: var(--text-2)">{text}</p>{u}\n</div>\n' + '\n'.join(rest) + '\n</section>')


def kv(k, v):  # A-Is-Durdu kartındaki özet satırı
    return ('<div style="display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 16px; padding: 12px 0; border-top: 1px solid var(--edge); font-size: 15px">'
            f'<dt style="color: var(--text-2)">{k}</dt><dd style="margin: 0 0 0 auto; min-width: 0; font-weight: 600; text-align: right; overflow-wrap: anywhere">{v}</dd></div>')


OPT = ('min-height: 72px; box-sizing: border-box; padding: 12px 16px; border-radius: 12px; border: %s; background: %s; color: %s; font: inherit; text-align: left; '
       'text-decoration: none; cursor: pointer; display: flex; flex-direction: column; justify-content: center; gap: 4px')


def option(href, kind, name, sub):
    st = {'main': OPT % ('0', 'var(--accent)', 'var(--on-accent)'), 'second': OPT % ('1px solid var(--edge-strong)', 'transparent', 'var(--text)'),
          'quiet': OPT % ('0', 'transparent', 'var(--text-2)')}[kind]
    sub_st = 'font-size: 13px' if kind == 'main' else 'font-size: 13px; color: var(--text-3)'
    return f'<a href="{href}" style="{st}"><span style="font-size: 15px; font-weight: 600">{name}</span><span style="{sub_st}">{sub}</span></a>'


# pencere (A-Is-Durdu-Onay kabı ve satırları; hücrede gerçek genişlik 592)
def dialog(did, rows, middle, buttons, note='', before=''):
    n = f'\n<p style="margin: 0; font-size: 13px; line-height: 1.4; color: var(--text-3)">{note}</p>' if note else ''
    b = before + '\n' if before else ''
    return (f'<div role="dialog" aria-labelledby="{did}" style="width: 100%; max-width: 592px; box-sizing: border-box; padding: 24px; border-radius: 24px; background: var(--surface); '
            'border: 1px solid var(--edge); display: flex; flex-direction: column; gap: 24px">\n<div style="display: flex; flex-direction: column; gap: 8px">\n'
            f'<h3 id="{did}" style="margin: 0; font-family: var(--display); font-weight: 800; font-size: 32px; line-height: 1.1; letter-spacing: -0.02em">Try again</h3>\n'
            '<p style="margin: 0; font-size: 15px; color: var(--text-2)">Fragrance layering recipe · Fast · 1 variant</p>\n</div>\n' + b
            + '<dl style="margin: 0; display: flex; flex-direction: column; border-bottom: 1px solid var(--edge)">\n' + '\n'.join(rows) + '\n</dl>\n'
            + (middle + '\n' if middle else '')
            + '<div style="display: flex; flex-wrap: wrap-reverse; gap: 12px">\n' + '\n'.join(buttons) + '\n</div>' + n + '\n</div>')


def drow(k, v, color=''):
    c = f'; color: var(--{color})' if color else ''
    return ('<div style="display: flex; justify-content: space-between; gap: 16px; padding: 12px 0; border-top: 1px solid var(--edge); font-size: 15px">'
            f'<dt style="color: var(--text-2)">{k}</dt><dd style="margin: 0; min-width: 0; font-weight: 600; text-align: right; overflow-wrap: anywhere{c}">{v}</dd></div>')


def dmain(k, v, color=''):
    c = f'; color: var(--{color})' if color else ''
    return ('<div style="display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 16px; padding: 16px 0; border-top: 1px solid var(--edge); font-size: 17px">'
            f'<dt style="font-weight: 600">{k}</dt><dd style="margin: 0 0 0 auto; min-width: 0; font-weight: 600; text-align: right; overflow-wrap: anywhere{c}">{v}</dd></div>')


def b_cancel(href):
    return (f'<a href="{href}" style="flex: 1 1 160px; display: flex; align-items: center; justify-content: center; min-height: 52px; border-radius: 12px; '
            'border: 1px solid var(--edge-strong); color: var(--text); font-weight: 600; font-size: 15px; text-decoration: none">Cancel</a>')


def b_main(href, text):
    return (f'<a href="{href}" style="flex: 2 1 240px; display: flex; align-items: center; justify-content: center; min-height: 52px; border-radius: 12px; '
            f'background: var(--accent); color: var(--on-accent); font-weight: 600; font-size: 15px; text-decoration: none">{text}</a>')


SELF = 'A-Is-Durumlar.dc.html'
running = [
    cell('Taking longer than usual', strip(
        '<div style="display: flex; flex-direction: column; gap: 16px">\n' + top(S_RUN) + '\n'
        '<div style="display: flex; flex-direction: column; gap: 4px">\n<span style="font-size: 13px; color: var(--text-3)">Estimated time</span>\n'
        '<p style="margin: 0; font-size: 15px; color: var(--text-2)"><strong style="font-family: var(--display); font-weight: 700; font-size: 32px; line-height: 1.1; color: var(--text)">Taking longer than usual</strong></p>\n'
        '</div>\n</div>',
        box('This is taking longer than usual. Your job is still running; you do not need to start it again.', I_CLOCK))),
    cell('Reconnecting', strip(top(S_RUN), box('Reconnecting… Your job keeps running while this page reconnects.', I_SPIN))),
    cell('Generation paused', strip(top(S_RUN), warn('Generation is paused for a short time.', 'Your job continues when it is back. Nothing extra is charged.'))),
]
stopped = [
    cell('Stopped · content rule', strip(top(S_STOP), card(
        'warn-edge', 'What happened', 'This job was stopped because the images or text break our content rules',
        'Your 2 credits are back in your balance. This job cannot be continued.',
        f'<a href="A-Iletisim.dc.html" style="{SECONDARY}; align-self: flex-start">Contact support</a>'))),
    cell('Stopped · free video', strip(top(S_STOP), card(
        'warn-edge', 'What happened and your options', 'Two clips could not be generated',
        'Your free video is back. The finished parts are saved.',
        '<dl style="margin: 0; display: flex; flex-direction: column; border-bottom: 1px solid var(--edge)">\n'
        + '\n'.join([kv('Charged when you confirmed', 'Free video · 0 credits'), kv('Returned when it stopped', 'Your free video'), kv('To continue', 'Free video · 0 credits')])
        + '\n</dl>',
        '<div style="display: flex; flex-direction: column; gap: 12px">\n'
        + option(SELF, 'main', 'Continue with the backup model', 'Free. The look may differ slightly.') + '\n'
        + option(SELF, 'second', 'Try again', 'Free. The same model generates the 2 missing clips again.') + '\n'
        + option('A-Is-Kapat-Onay.dc.html', 'quiet', 'Stop the job here', 'Nothing is charged. Your free video stays with you and the saved parts are deleted.')
        + '\n</div>', until=True))),
]
cont = [
    cell('Continue · free video', dialog(
        'devam-1', [drow('Missing', '2 clips'), drow('Returned when it stopped', 'Your free video'), dmain('Continuing costs', 'Free video · 0 credits', 'accent-text')],
        box('This uses your one free video.', bg='bg'),
        [b_cancel(SELF), b_main('A-Is-Takibi.dc.html', 'Confirm and continue')]), window=True),
    cell('Continue · free video used on another job', dialog(
        'devam-2', [drow('Missing', '2 clips'), dmain('Continuing costs', '2 credits', 'accent-text'), drow('Balance after', '[BALANCE AFTER] credits')],
        '', [b_cancel(SELF), b_main('A-Is-Takibi.dc.html', 'Confirm and continue')],
        before=warn('Your free video was used on another job.', 'Continuing this one costs 2 credits.', bg='bg')), window=True),
    cell('Continue · not enough credits', dialog(
        'devam-3', [drow('Missing', '2 clips'), dmain('Continuing costs', '2 credits'), drow('Balance now', '[BALANCE] credits', 'warn')],
        warn('You need 2 credits to continue and have [BALANCE].', bg='bg'),
        [b_cancel('A-Is-Durdu.dc.html'), b_main('A-Fiyatlar.dc.html', 'Buy credits')],
        note='The saved parts wait for you until [DATE].'), window=True),
]
closed = [
    cell('Closed · after 30 days', strip(top(S_CLOSED), card(
        'line', 'Job closed', 'This job was closed after 30 days',
        'Your 2 credits were returned when it stopped. Nothing else was charged.',
        '<p style="margin: 0; font-size: 13px; line-height: 1.4; color: var(--text-3)">The saved parts of this video were deleted.</p>',
        f'<a href="Main.dc.html" style="{SECONDARY}; align-self: flex-start">Pick another template</a>'))),
]
rewrite('A-Is-Durumlar', WRAP + '\n' + H1 % 'Job progress · states' + '\n' + group('Running', running, True) + '\n' + group('Stopped', stopped) + '\n'
        + group('Continue', cont) + '\n' + group('Closed', closed) + '\n</div>')


# ---- A-Uretimlerim-Durumlar -----------------------------------------------------------------------------------------
ACT = ('flex: 1 1 160px; box-sizing: border-box; display: flex; align-items: center; justify-content: center; min-height: 52px; padding: 0 24px; border-radius: 12px; '
       'font-weight: 600; font-size: 15px; white-space: nowrap; text-decoration: none; border: 1px solid var(--edge-strong); background: transparent; color: var(--text)')
DELETE = ('<a href="A-Video-Sil-Onay.dc.html" style="flex: 0 0 auto; display: flex; align-items: center; justify-content: center; min-height: 44px; padding: 0 8px; '
          'color: var(--warn); font-size: 15px; font-weight: 500; text-decoration: none">Delete</a>')


def row(status, details, href, action, opacity='', extra=''):
    op = f'; opacity: {opacity}' if opacity else ''
    det = '\n'.join(f'<span style="font-size: 13px; line-height: 1.4; color: var(--text-3)">{d}</span>' for d in details)
    return ('<article style="display: flex; flex-wrap: wrap; align-items: center; gap: 16px 24px; padding: 16px 0; border-top: 1px solid var(--line)">\n'
            '<img src="/_blob/619ee0e5a13e318118b291c1451be9b8" alt="" style="flex: 0 0 72px; width: 72px; height: 128px; object-fit: cover; border-radius: 12px; display: block; '
            f'box-shadow: 0 0 0 1px var(--media-edge){op}">\n'
            '<div style="flex: 9999 1 160px; min-width: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 12px 24px">\n'
            '<div style="flex: 9999 1 280px; min-width: 0; display: flex; flex-direction: column; gap: 4px">\n'
            '<h3 style="margin: 0; font-size: 20px; font-weight: 600; line-height: 1.25; text-wrap: pretty">Fragrance layering recipe</h3>\n'
            '<p style="margin: 0; font-size: 13px; line-height: 1.4; color: var(--text-3)">4 products: Aurora Body Oil, Body Mist, Hair Mist, Solace Perfume</p>\n'
            '<p style="margin: 0; font-size: 13px; line-height: 1.4; color: var(--text-3)">Fast · 1 variant</p>\n</div>\n'
            '<div style="flex: 1 1 320px; min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: 16px">\n'
            f'<div style="min-width: 0; display: flex; flex-direction: column; gap: 4px">\n{status}\n{det}\n</div>\n' + (extra + '\n' if extra else '') + '</div>\n</div>\n'
            f'<a href="{href}" style="{ACT}">{action}</a>\n</article>')


R_RUN = row(S_RUN, ['Clips 3 / 5 · about 3 min left'], 'A-Is-Takibi.dc.html', 'Watch')
R_DONE = row(S_DONE, ['mp4 · 720p'], 'A-Sonuc.dc.html', 'Open', extra=DELETE)
rows = [
    cell('In queue', row(S_QUEUE, ['Position 2'], 'A-Is-Kuyrukta.dc.html', 'Open'), window=True),
    cell('Running', R_RUN, window=True),
    cell('Stopped, credits returned', row(S_STOP, ['Credits returned · 3 of 5 clips saved'], 'A-Is-Durdu.dc.html', 'See options'), window=True),
    cell('Closed', row(S_CLOSED, ['2 credits were returned. Nothing else was charged.'], 'A-Is-Kapatildi.dc.html', 'Open'), window=True),
    cell('No longer stored', row(S_GONE, ['Videos are kept for 12 months.', 'This starts a new job: you add the product images again and confirm the price.'],
                                 'A-Form.dc.html', 'Generate it again', opacity='0.6'), window=True),
]
note = lambda *parts: '<div style="display: flex; flex-direction: column; gap: 16px">\n' + '\n'.join(parts) + '\n</div>'
DLG_BTN = ('display: flex; align-items: center; justify-content: center; box-sizing: border-box; border-radius: 12px; font: inherit; font-weight: 600; text-decoration: none; '
           'cursor: pointer; min-height: 52px; padding: 0 24px; border: 1px solid var(--%s); background: transparent; color: var(--%s); font-size: 15px')
delete = [
    cell('Video deleted', note(box('Video deleted.'), R_RUN), window=True),
    cell('Could not delete', note(warn('Could not delete the video.', 'Try again.'), R_DONE), window=True),
    cell('Confirm · job with 3 variants',
         '<div role="dialog" aria-labelledby="sil-3" style="width: 100%; max-width: 592px; box-sizing: border-box; padding: 24px; border-radius: 24px; background: var(--surface); '
         'border: 1px solid var(--edge); display: flex; flex-direction: column; gap: 24px">\n<div style="display: flex; flex-direction: column; gap: 8px">\n'
         '<h3 id="sil-3" style="margin: 0; font-family: var(--display); font-weight: 800; font-size: 32px; line-height: 1.1; letter-spacing: -0.02em">Delete these 3 videos?</h3>\n'
         '<p style="margin: 0; font-size: 15px; line-height: 1.5; color: var(--text-2)">They are removed from My videos and cannot be brought back. Credits are not returned.</p>\n</div>\n'
         '<div style="display: flex; flex-wrap: wrap; gap: 12px">\n'
         f'<a href="A-Uretimlerim.dc.html" style="flex: 2 1 240px; {DLG_BTN % ("edge-strong", "text")}">Keep it</a>\n'
         f'<a href="A-Uretimlerim-Durumlar.dc.html" style="flex: 1 1 160px; {DLG_BTN % ("warn", "warn")}">Delete videos</a>\n</div>\n</div>', window=True),
]
lst = [
    cell('List could not load',
         '<div role="alert" style="box-sizing: border-box; border-radius: 16px; background: var(--surface); border: 1px solid var(--line); padding: clamp(48px, 5vw, 72px) clamp(16px, 4vw, 24px); '
         'display: flex; flex-direction: column; align-items: center; gap: 24px; text-align: center">\n'
         '<span aria-hidden="true" style="width: 48px; height: 48px; border-radius: 50%; background: var(--raised); color: var(--warn); display: flex; align-items: center; justify-content: center">'
         + svg(I_WARN, 24) + '</span>\n<div style="display: flex; flex-direction: column; align-items: center; gap: 8px">\n'
         '<h3 style="margin: 0; font-family: var(--display); font-weight: 700; font-size: 20px; line-height: 1.25; letter-spacing: -0.01em">Could not load your videos.</h3>\n'
         '<p style="margin: 0; max-width: 520px; font-size: 15px; line-height: 1.5; color: var(--text-2); text-wrap: pretty">Check your connection and try again. Your videos and credits are not affected.</p>\n</div>\n'
         f'<button type="button" style="{SECONDARY}; gap: 8px">' + svg(I_RETRY, 18) + 'Try again</button>\n</div>'),
    cell('Empty, free video already used',
         '<div style="box-sizing: border-box; border-radius: 16px; border: 1.5px dashed var(--edge-strong); padding: clamp(48px, 5vw, 72px) clamp(16px, 4vw, 24px); display: flex; flex-direction: column; '
         'align-items: center; gap: 24px; text-align: center">\n<div style="display: flex; flex-direction: column; align-items: center; gap: 8px">\n'
         '<h3 style="margin: 0; font-family: var(--display); font-weight: 800; font-size: 32px; line-height: 1.1; letter-spacing: -0.02em">No videos yet.</h3>\n'
         '<p style="margin: 0; max-width: 520px; font-size: 15px; line-height: 1.5; color: var(--text-2); text-wrap: pretty">Your videos will show up here.</p>\n</div>\n'
         '<a href="Main.dc.html" style="display: flex; align-items: center; justify-content: center; box-sizing: border-box; border-radius: 12px; font: inherit; font-weight: 600; text-decoration: none; '
         'cursor: pointer; min-height: 60px; padding: 0 32px; border: 0; background: var(--accent); color: var(--on-accent); font-size: 17px">Pick a template</a>\n</div>'),
]
rewrite('A-Uretimlerim-Durumlar', WRAP + '\n' + H1 % 'My videos · states' + '\n' + group('Rows', rows, True) + '\n' + group('Delete', delete) + '\n' + group('List', lst) + '\n</div>')


# ---- E-Durdu: iki gövde (kredili iş, ücretsiz iş) -------------------------------------------------------------------
PAD = 'clamp(24px, 8vw - 16px, 32px)'
LOGO = ('<a href="A-Ana-Sayfa.dc.html" style="padding: 12px 0; margin: -12px 0; display: flex; align-items: baseline; gap: 0.34em; font-family: var(--display); font-weight: 800; font-size: 24px; '
        'line-height: 1; letter-spacing: -0.04em; color: var(--text); text-decoration: none"><svg viewBox="0 0 42 32" fill="none" aria-hidden="true" style="width: 0.97em; height: 0.74em; flex: 0 0 auto; display: block">'
        '<rect x="1.5" y="1.5" width="15" height="29" rx="3" stroke="currentColor" stroke-width="3"></rect><rect x="25.5" y="1.5" width="15" height="29" rx="3" fill="#C8F03C" stroke-width="3" '
        'style="stroke: var(--mark-edge)"></rect></svg><span>viral clone</span></a>')


def erow(k, v):
    return ('<div style="display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 16px; padding: 12px 0; border-top: 1px solid var(--line); font-size: 15px">'
            f'<dt style="color: var(--text-2)">{k}</dt><dd style="margin: 0 0 0 auto; font-weight: 600; text-align: right; overflow-wrap: anywhere">{v}</dd></div>')


def mail(label, h, intro, back, href, foot, first=False):
    top_m = '' if first else 'margin: 32px 0 0'
    return (f'<p style="{top_m or "margin: 0"}; font-size: 13px; line-height: 1.4; font-weight: 600; color: var(--text-2)">{label}</p>\n'
            '<p style="margin: 0; font-size: 13px; line-height: 1.4; color: var(--text-3)">From: Viral Clone · Subject: Your video stopped halfway</p>\n'
            f'<div style="box-sizing: border-box; padding: {PAD}; border-radius: 16px; background: var(--surface); border: 1px solid var(--line); display: flex; flex-direction: column; gap: 24px">\n'
            + LOGO + '\n<div style="display: flex; flex-direction: column; gap: 12px">\n' + S_STOP + '\n'
            f'<{h} style="margin: 0; font-family: var(--display); font-weight: 800; font-size: 32px; line-height: 1.1; letter-spacing: -0.02em">Your video stopped halfway.</{h}>\n'
            f'<p style="margin: 0; font-size: 17px; line-height: 1.5; color: var(--text-2); text-wrap: pretty">{intro}</p>\n</div>\n'
            '<dl style="margin: 0; display: flex; flex-direction: column; border-bottom: 1px solid var(--line)">\n'
            + '\n'.join([erow('Template', 'Fragrance layering recipe'), erow('Saved so far', '5 images, 3 of 5 clips, music'), erow('Missing', '2 clips'), erow(*back)]) + '\n</dl>\n'
            f'<a href="{href}" style="display: flex; align-items: center; justify-content: center; box-sizing: border-box; border-radius: 12px; font: inherit; font-weight: 600; text-decoration: none; '
            'cursor: pointer; min-height: 52px; padding: 0 24px; border: 0; background: var(--accent); color: var(--on-accent); font-size: 15px; align-self: flex-start">Open the job</a>\n'
            f'<p style="margin: 0; font-size: 13px; line-height: 1.4; color: var(--text-3)">{foot}</p>\n</div>\n'
            f'<p style="margin: 0; padding: 0 {PAD}; font-size: 13px; line-height: 1.4; color: var(--text-3)">You get this email because you have a Viral Clone account. Questions? '
            '<a href="A-Iletisim.dc.html" style="display: inline-block; padding: 16px 0; margin: -16px 0; font-weight: 600; text-decoration: none">Contact support</a>.<br>© [COMPANY NAME] · [ADDRESS]</p>')


body = (mail('Job paid with credits', 'h1', 'One step failed, so we stopped. Your 2 credits are back in your balance. Open the job to continue or close it.',
             ('Credits returned', '2'), 'A-Is-Durdu.dc.html',
             'Continuing costs 2 credits. You never pay more than the price you first confirmed. The saved parts are kept for 30 days.', first=True) + '\n'
        + mail('Job started with the free video', 'h2', 'One step failed, so we stopped. Your free video is back. Open the job to continue or close it.',
               ('Returned', 'Your free video'), 'A-Is-Durumlar.dc.html',
               'Continuing is free: it uses your free video again. The saved parts are kept for 30 days.'))
path = os.path.join(P, 'E-Durdu.dc.html')
s = open(path, encoding='utf-8').read()
m = re.search(r'<div class="ay"[^>]*>\n', s)
s = s[:m.end()] + body + '\n</div>\n' + s[s.index('</x-dc>'):]
open(path, 'w', encoding='utf-8').write(s)
print('yazıldı: E-Durdu')
