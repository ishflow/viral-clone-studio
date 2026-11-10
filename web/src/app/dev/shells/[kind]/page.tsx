import { notFound } from 'next/navigation';
import {
  AuthFrame, Button, Card, ChartSlot, CookieNotice, DataTable, Field, Footer, HeaderCustomer, HeaderPanel, HeaderVisitor, Input, LinkButton,
  PageFrame, PageHead, Pager, SubNav, Tile, TileGrid, VideoCard, VideoGrid,
} from '@/shared/ui';
import { devOnly } from '../../dev-only';

export const metadata = { title: 'Shells' };

const KINDS = ['visitor', 'customer', 'admin', 'auth'] as const;
type Kind = (typeof KINDS)[number];

function Filler({ children }: { children?: React.ReactNode }) {
  return <div className="flex flex-col gap-12">{children}</div>;
}

function Cards() {
  return (
    <VideoGrid>
      {[1, 2, 3, 4].map((n) => (
        <VideoCard
          key={n}
          href="/dev/shells/customer"
          title="Fragrance layering recipe"
          meta="Fragrance · reference 1.9M views"
          image="/samples/f20a7ed7a7bc172a7da483415800077f.jpg"
          video={n === 1 ? '/samples/layering.mp4' : null}
          formatLabel="No talking"
          durationLabel="8 sec"
        />
      ))}
    </VideoGrid>
  );
}

export default async function ShellPage({ params }: { params: Promise<{ kind: string }> }) {
  devOnly();
  const { kind } = await params;
  if (!KINDS.includes(kind as Kind)) notFound();

  if (kind === 'auth') {
    return (
      <AuthFrame>
        <h1 className="m-0 heading-4">Log in</h1>
        <Field label="Email">
          <Input type="email" placeholder="name@example.com" />
        </Field>
        <Button size="l">Log in</Button>
      </AuthFrame>
    );
  }

  if (kind === 'admin') {
    return (
      <PageFrame header={<HeaderPanel current="revenue" />}>
        <div className="flex flex-col gap-8">
          <PageHead title="Revenue" lead="Payments and credits." actions={<Button variant="secondary">Export</Button>} />
          <SubNav
            label="Revenue"
            currentHref="/admin/revenue"
            items={[
              { href: '/admin/revenue', label: 'Purchases' },
              { href: '/admin/revenue/credits', label: 'Credits' },
            ]}
          />
          <TileGrid>
            <Tile label="Users" value="[COUNT]" sub="All accounts" />
            <Tile label="Revenue" value="[AMOUNT]" sub="Last 30 days" />
          </TileGrid>
          <ChartSlot label="Revenue and generation cost" />
          <DataTable
            caption="Purchases"
            columns={[
              { key: 'when', header: 'Date' },
              { key: 'user', header: 'User' },
              { key: 'credits', header: 'Credits', numeric: true },
            ]}
            rows={[
              { id: '1', cells: { when: '[DATE]', user: 'ada@example.com', credits: '120' } },
              { id: '2', cells: { when: '[DATE]', user: 'bo@example.com', credits: '40' } },
            ]}
          />
          <Pager shown="2" total="2" />
        </div>
      </PageFrame>
    );
  }

  if (kind === 'customer') {
    return (
      <PageFrame header={<HeaderCustomer current="account" balanceLabel="12 credits" />}>
        <Filler>
          <Card>Customer shell: header with the balance chip, no footer.</Card>
          <Cards />
        </Filler>
      </PageFrame>
    );
  }

  return (
    <>
      <PageFrame header={<HeaderVisitor current="pricing" />} footer={<Footer />}>
        <Filler>
          <Card>Visitor shell: header, footer and the cookie notice.</Card>
          <Cards />
          <LinkButton href="/dev/ui">UI kit</LinkButton>
        </Filler>
      </PageFrame>
      <CookieNotice />
    </>
  );
}
