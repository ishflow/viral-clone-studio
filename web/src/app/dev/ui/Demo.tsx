'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useT } from '@/core/i18n/I18nProvider';
import {
  Button, Card, ChartSlot, DataTable, Dialog, EmptyState, Field, Footer, HeaderCustomer, HeaderPanel, HeaderVisitor, Icon, Input,
  LanguageMenu, LinkButton, Logo, MobileMenu, PageHead, Pager, Segmented, Select, Skeleton, StatusLine, SubNav, Tag, Textarea, Tile,
  TileGrid, VideoCard, VideoGrid, ICONS, type IconName,
} from '@/shared/ui';
import { formatDuration } from '@/shared/lib/format';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="m-0 heading-5">{title}</h2>
      {children}
    </section>
  );
}

function Spec({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      {children}
      <span className="text-13 text-text-3">{label}</span>
    </div>
  );
}

const cols = [
  { key: 'started', header: 'Started' },
  { key: 'user', header: 'User' },
  { key: 'template', header: 'Template' },
  { key: 'credits', header: 'Credits', numeric: true },
  { key: 'status', header: 'Status' },
  { key: 'actions', header: 'Actions', srOnlyHeader: true },
];

export function Demo() {
  const t = useT();
  const [period, setPeriod] = useState('30');
  const [open, setOpen] = useState(false);
  return (
    <main className="mx-auto flex max-w-[1320px] flex-col gap-12 px-4 py-12 nav:px-12">
      <h1 className="heading-3 m-0">UI kit</h1>

      <Section title="Logo">
        <Logo href="/dev/ui" />
      </Section>

      <Section title="Button">
        <div className="flex flex-wrap items-start gap-6">
          <Spec label="primary, large"><Button size="l">Clone it</Button></Spec>
          <Spec label="primary, medium"><Button>Confirm and generate</Button></Spec>
          <Spec label="secondary, large"><Button variant="secondary" size="l">Cancel</Button></Spec>
          <Spec label="secondary, medium"><Button variant="secondary">Cancel</Button></Spec>
          <Spec label="quiet"><Button variant="quiet">Forgot password</Button></Spec>
          <Spec label="warn"><Button variant="warn">Delete account</Button></Spec>
          <Spec label="disabled"><Button size="l" disabled>Generate</Button></Spec>
          <Spec label="pending"><Button pending>Saving</Button></Spec>
          <Spec label="link button"><LinkButton href="/dev/ui" variant="secondary">Browse the gallery</LinkButton></Spec>
        </div>
        <div className="max-w-sm"><Button fullWidth>Full width</Button></div>
      </Section>

      <Section title="Field">
        <div className="grid gap-6 nav:grid-cols-2">
          <Field label="Product name"><Input defaultValue="Aurora Body Oil" /></Field>
          <Field label="Short description" hint="What it does, its key feature"><Input placeholder="What it does, its key feature" /></Field>
          <Field label="Email (error)" error="The address is missing its ending. It should look like name@example.com.">
            <Input type="email" defaultValue="name@example" />
          </Field>
          <Field label="Language"><Select defaultValue="en"><option value="en">English</option><option value="tr">Türkçe</option></Select></Field>
          <Field label="Message" className="nav:col-span-2"><Textarea rows={4} placeholder="What happened, and what did you expect?" /></Field>
        </div>
      </Section>

      <Section title="Card, Tag, Status">
        <div className="grid gap-4 nav:grid-cols-3">
          <Card as="section"><p className="m-0 text-15 text-text-2">Card with 24 padding, radius 16.</p></Card>
          <Card className="flex flex-col gap-3">
            <StatusLine kind="done">Ready</StatusLine>
            <StatusLine kind="running">Generating</StatusLine>
            <StatusLine kind="stopped">Stopped</StatusLine>
            <StatusLine kind="waiting">Waiting</StatusLine>
          </Card>
          <div className="relative flex h-40 items-start gap-2 rounded-16 bg-raised p-3"><Tag>No talking</Tag><Tag>{formatDuration(75, t)}</Tag></div>
        </div>
      </Section>

      <Section title="Segmented">
        <div className="flex flex-wrap gap-6">
          <Segmented label="Period" value={period} onChange={setPeriod} options={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }]} />
          <Segmented label="Links" value="b" hrefFor={() => '/dev/ui'} options={[{ value: 'a', label: 'All' }, { value: 'b', label: 'No talking' }, { value: 'c', label: 'Talking' }]} />
        </div>
      </Section>

      <Section title="Skeleton">
        <div className="flex max-w-[210px] flex-col gap-3" aria-hidden="true">
          <Skeleton className="aspect-[9/16] rounded-16" />
          <div className="flex flex-col gap-2"><Skeleton className="h-3 w-4/5 rounded-full" /><Skeleton className="h-3 w-1/2 rounded-full" /></div>
        </div>
      </Section>

      <Section title="Empty state">
        <EmptyState title="Seen it? Clone it." text="Your videos will show up here. Pick a template, upload your product, and your first video is free." action={<LinkButton href="/dev/ui" size="l">Browse the gallery</LinkButton>} />
      </Section>

      <Section title="Dialog">
        <div><Button variant="secondary" onClick={() => setOpen(true)}>Open dialog</Button></div>
        <Dialog open={open} onClose={() => setOpen(false)} title="Confirm generation">
          <p className="m-0 text-15 text-text-2">Fragrance layering recipe · Fast · 1 variant</p>
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" fullWidth onClick={() => setOpen(false)}>Cancel</Button>
            <Button fullWidth onClick={() => setOpen(false)}>Confirm and generate</Button>
          </div>
        </Dialog>
      </Section>

      <Section title="Headers (switch to the phone bar below 900 px)">
        <div className="flex flex-col gap-6">
          <Spec label="HeaderVisitor current=pricing"><HeaderVisitor current="pricing" /></Spec>
          <Spec label="HeaderVisitor phoneCta={false} (auth pages)"><HeaderVisitor phoneCta={false} /></Spec>
          <Spec label="HeaderCustomer current=videos"><HeaderCustomer current="videos" balanceLabel="12 credits" /></Spec>
          <Spec label="HeaderCustomer current=account, free video"><HeaderCustomer current="account" balanceLabel="1 free video" /></Spec>
          <Spec label="HeaderPanel current=revenue"><HeaderPanel current="revenue" /></Spec>
        </div>
      </Section>

      <Section title="Language menu, phone menu button">
        <div className="flex flex-wrap items-start gap-6">
          <Spec label="LanguageMenu chip (click to open)"><LanguageMenu /></Spec>
          <Spec label="LanguageMenu row (opens upward)"><div className="w-72 pt-28"><LanguageMenu variant="row" /></div></Spec>
          <Spec label="MobileMenu visitor"><MobileMenu kind="visitor" /></Spec>
          <Spec label="MobileMenu customer"><MobileMenu kind="customer" current="gallery" balanceLabel="12 credits" /></Spec>
          <Spec label="MobileMenu admin"><MobileMenu kind="admin" current="overview" /></Spec>
        </div>
      </Section>

      <Section title="Footer">
        <Footer />
      </Section>

      <Section title="Cookie notice">
        <p className="m-0 text-15 text-text-2">Fixed to the bottom of the window; see <Link href="/dev/shells/visitor">/dev/shells/visitor</Link>.</p>
      </Section>

      <Section title="VideoCard (first card plays its clip on hover or focus)">
        <VideoGrid>
          <VideoCard href="/dev/ui" title="Fragrance layering recipe" meta="Fragrance · reference 1.9M views" image="/samples/f20a7ed7a7bc172a7da483415800077f.jpg" video="/samples/layering.mp4" formatLabel="No talking" durationLabel="8 sec" />
          <VideoCard href="/dev/ui" title="Eye close-up with a day counter" meta="Lashes · reference 19.8M views" image="/samples/1377349dbc87784232ac59cf9cf04986.jpg" video="/samples/lashly.mp4" formatLabel="No talking" durationLabel="13 sec" />
          <VideoCard href="/dev/ui" title={'"I tried it for 4 weeks" presenter story'} meta="Lashes · reference 8.9M views" image="/samples/874b55ddf9761a230dda46e2aa4afa85.jpg" formatLabel="Talking" durationLabel="30 sec" />
          <VideoCard href="/dev/ui" title="Dupe comparison" meta="Fragrance · reference 1.9M views" image="/samples/586c7628c6d07d797378740fedc4c97f.jpg" formatLabel="No talking" durationLabel="17 sec" />
        </VideoGrid>
      </Section>

      <Section title="Panel: PageHead, SubNav, Tile, ChartSlot">
        <div className="flex flex-col gap-8">
          <PageHead title="Revenue" lead="Payments and credits." actions={<><Segmented label="Period" value={period} onChange={setPeriod} options={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }]} /><Button>Export</Button></>} />
          <SubNav label="Revenue" currentHref="/dev/ui#credits" items={[{ href: '/dev/ui#purchases', label: 'Purchases' }, { href: '/dev/ui#credits', label: 'Credits' }]} />
          <TileGrid lead>
            <Tile label="Users" value="[COUNT]" sub="All accounts" />
            <Tile label="Revenue" value="[AMOUNT]" sub="Last 30 days" />
            <Tile label="Credits sold" value="[COUNT]" />
          </TileGrid>
          <ChartSlot label="Revenue and generation cost" />
        </div>
      </Section>

      <Section title="DataTable: rows, empty, loading">
        <div className="flex flex-col gap-6">
          <DataTable
            caption="Jobs"
            columns={cols}
            rows={[
              { id: '1', cells: { started: '[DATE]', user: 'ada@example.com', template: 'Fragrance layering recipe', credits: '120', status: <StatusLine kind="done">Done</StatusLine> } },
              { id: '2', cells: { started: '[DATE]', user: 'bo@example.com', template: 'Dupe comparison', credits: '40', status: <StatusLine kind="stopped">Stopped</StatusLine> } },
            ]}
          />
          <Pager shown={2} total={60} nextHref="/dev/ui" />
          <Pager shown={60} total={60} prevHref="/dev/ui" />
          <Pager shown={0} total={0} />
          <DataTable caption="Jobs: no rows" columns={cols} rows={[]} minWidth={520} empty={{ text: 'No jobs match this filter.', action: <Button variant="secondary">Clear filter</Button> }} />
          <DataTable caption="Jobs: loading" columns={cols} rows={[]} minWidth={520} loading />
        </div>
      </Section>

      <Section title="New icons">
        <div className="flex gap-4">
          {(['arrow up', 'arrow down', 'link', 'clock', 'sound off'] as IconName[]).map((n) => <Icon key={n} name={n} size={24} />)}
        </div>
      </Section>

      <Section title="Icons">
        <div className="flex flex-wrap gap-4 text-text">
          {(Object.keys(ICONS) as IconName[]).map((n) => (
            <div key={n} className="flex w-20 flex-col items-center gap-1 text-13 text-text-3"><Icon name={n} size={24} />{n}</div>
          ))}
        </div>
      </Section>
    </main>
  );
}
