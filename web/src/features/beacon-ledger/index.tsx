/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { getBook } from './api'
import { CustomerFinance } from './components/customer-finance'
import { FinanceOverview } from './components/finance-overview'
import { LedgerEntryDialog } from './components/ledger-entry-dialog'
import { LedgerTable } from './components/ledger-table'
import { ProfitSummary } from './components/profit-summary'
import { QuotaReconciliation } from './components/quota-reconciliation'
import { UpstreamFinance } from './components/upstream-finance'
import type { BookSource, EntryKind, FinanceTab, LedgerEntry } from './types'

export function BeaconLedger(props: {
  tab: FinanceTab
  onTabChange: (tab: FinanceTab) => void
}) {
  const { t } = useTranslation()
  const [filter, setFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState<BookSource | ''>('')
  const [query, setQuery] = useState<{
    source: BookSource | ''
    userId: number
  }>({ source: '', userId: 0 })
  const [cursor, setCursor] = useState('')
  const [cursors, setCursors] = useState<string[]>([])
  const [draft, setDraft] = useState<{
    kind: EntryKind
    source?: LedgerEntry
    channelId?: number
    userId?: number
    amount?: string
  } | null>(null)
  const [open, setOpen] = useState(false)
  const ledger = useQuery({
    queryKey: ['beacon-ledger', 'book', query, cursor],
    queryFn: () => getBook(query.source, query.userId, cursor),
    retry: false,
  })
  const postingAvailable = ledger.data?.posting_available === true
  const startEntry = (
    kind: EntryKind,
    preset: Omit<NonNullable<typeof draft>, 'kind'> = {}
  ): void => {
    if (!draft) setDraft({ kind, ...preset })
    setOpen(true)
  }
  // Only customer entries can be filtered by customer.
  const customerFilter = sourceFilter === '' || sourceFilter === 'customer'
  return (
    <>
      <SectionPageLayout stackActionsOnMobile>
        <SectionPageLayout.Title>{t('Finance books')}</SectionPageLayout.Title>
        <SectionPageLayout.Actions>
          <Button
            className='min-h-11'
            disabled={!postingAvailable}
            onClick={() => startEntry('receipt')}
          >
            {draft ? t('Continue draft') : t('New entry')}
          </Button>
        </SectionPageLayout.Actions>
        <SectionPageLayout.Content>
          <Tabs
            value={props.tab}
            onValueChange={(value) => props.onTabChange(value as FinanceTab)}
          >
            {/* Six tabs do not fit a phone; the list scrolls instead of the page. */}
            <div className='mb-4 max-w-full overflow-x-auto'>
              <TabsList className='min-h-12'>
                <TabsTrigger className='min-h-11 px-4' value='overview'>
                  {t('Overview')}
                </TabsTrigger>
                <TabsTrigger className='min-h-11 px-4' value='profit'>
                  {t('Profit')}
                </TabsTrigger>
                <TabsTrigger className='min-h-11 px-4' value='customers'>
                  {t('Customers')}
                </TabsTrigger>
                <TabsTrigger className='min-h-11 px-4' value='upstreams'>
                  {t('Upstreams')}
                </TabsTrigger>
                <TabsTrigger className='min-h-11 px-4' value='entries'>
                  {t('Ledger entries')}
                </TabsTrigger>
                <TabsTrigger className='min-h-11 px-4' value='reconciliation'>
                  {t('Balance reconciliation')}
                </TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value='overview'>
              <FinanceOverview onOpen={props.onTabChange} />
            </TabsContent>
            <TabsContent value='profit'>
              <ProfitSummary />
            </TabsContent>
            <TabsContent value='customers'>
              <CustomerFinance
                onRefund={(userId, amount) =>
                  startEntry('refund', { userId, amount })
                }
              />
            </TabsContent>
            <TabsContent value='upstreams'>
              <UpstreamFinance
                onTopUp={(channelId) => startEntry('upstream', { channelId })}
              />
            </TabsContent>
            <TabsContent value='reconciliation'>
              <QuotaReconciliation />
            </TabsContent>
            <TabsContent value='entries'>
              <div className='flex min-w-0 flex-col gap-4'>
                <p className='text-muted-foreground text-sm'>
                  {t(
                    'CNY reporting · Asia/Shanghai. Customer money, top-ups paid to upstreams and other costs recorded here, newest first. Historical top-ups and usage revenue are not included.'
                  )}
                </p>
                {ledger.data && !postingAvailable && (
                  <Alert>
                    <AlertDescription>
                      {t(
                        'Manual ledger is unavailable while Redis or batch quota updates are enabled.'
                      )}
                    </AlertDescription>
                  </Alert>
                )}
                <form
                  className='flex flex-wrap items-end gap-2'
                  onSubmit={(event) => {
                    event.preventDefault()
                    setQuery({
                      source: sourceFilter,
                      userId: customerFilter ? Number(filter) : 0,
                    })
                    setCursor('')
                    setCursors([])
                  }}
                >
                  <Field className='w-full sm:w-44'>
                    <FieldLabel htmlFor='ledger-source-filter'>
                      {t('Category')}
                    </FieldLabel>
                    <NativeSelect
                      id='ledger-source-filter'
                      className='w-full [&_select]:min-h-11'
                      value={sourceFilter}
                      onChange={(event) =>
                        setSourceFilter(event.target.value as BookSource | '')
                      }
                    >
                      <NativeSelectOption value=''>
                        {t('All')}
                      </NativeSelectOption>
                      <NativeSelectOption value='customer'>
                        {t('Customer money')}
                      </NativeSelectOption>
                      <NativeSelectOption value='upstream'>
                        {t('Upstream top-up')}
                      </NativeSelectOption>
                      <NativeSelectOption value='expense'>
                        {t('Other costs')}
                      </NativeSelectOption>
                    </NativeSelect>
                  </Field>
                  <Field className='max-w-64'>
                    <FieldLabel htmlFor='ledger-customer-filter'>
                      {t('Customer ID (blank for all)')}
                    </FieldLabel>
                    <Input
                      id='ledger-customer-filter'
                      className='min-h-11'
                      value={customerFilter ? filter : ''}
                      disabled={!customerFilter}
                      inputMode='numeric'
                      pattern='[0-9]*'
                      onChange={(event) => setFilter(event.target.value)}
                    />
                  </Field>
                  <Button
                    className='min-h-11'
                    variant='outline'
                    type='submit'
                    disabled={
                      customerFilter &&
                      (!Number.isSafeInteger(Number(filter)) ||
                        Number(filter) < 0)
                    }
                  >
                    {t('Filter')}
                  </Button>
                  <Button
                    className='min-h-11'
                    variant='outline'
                    type='button'
                    disabled={ledger.isFetching}
                    onClick={() => {
                      void ledger.refetch()
                    }}
                  >
                    {t('Refresh')}
                  </Button>
                </form>
                {ledger.isPending && <LoadingState />}
                {ledger.isError && (
                  <ErrorState
                    onRetry={() => {
                      void ledger.refetch()
                    }}
                  />
                )}
                {ledger.isSuccess && ledger.data.items.length === 0 && (
                  <EmptyState
                    title={t('No ledger entries')}
                    description={t(
                      'Confirmed entries will appear here. No sample amounts are included.'
                    )}
                  />
                )}
                {ledger.isSuccess && ledger.data.items.length > 0 && (
                  <LedgerTable
                    entries={ledger.data.items}
                    postingAvailable={postingAvailable && !draft}
                    onCorrect={(entry) =>
                      startEntry('reversal', { source: entry })
                    }
                  />
                )}
                <nav
                  className='flex flex-wrap gap-2'
                  aria-label={t('Ledger pagination')}
                >
                  <Button
                    className='min-h-11'
                    variant='outline'
                    disabled={cursors.length === 0 || ledger.isFetching}
                    onClick={() => {
                      setCursor(cursors.at(-1) ?? '')
                      setCursors(cursors.slice(0, -1))
                    }}
                  >
                    {t('Previous page')}
                  </Button>
                  <Button
                    className='min-h-11'
                    variant='outline'
                    disabled={
                      !ledger.data?.next || ledger.isFetching || ledger.isError
                    }
                    onClick={() => {
                      setCursors([...cursors, cursor])
                      setCursor(ledger.data?.next ?? '')
                    }}
                  >
                    {t('Next page')}
                  </Button>
                </nav>
              </div>
            </TabsContent>
          </Tabs>
        </SectionPageLayout.Content>
      </SectionPageLayout>
      {draft && (
        <LedgerEntryDialog
          open={open}
          kind={draft.kind}
          source={draft.source}
          channelId={draft.channelId}
          userId={draft.userId}
          amount={draft.amount}
          onOpenChange={(nextOpen) => {
            setOpen(nextOpen)
            if (!nextOpen) setDraft(null)
          }}
          onComplete={() => {
            setOpen(false)
            setDraft(null)
            setCursor('')
            setCursors([])
          }}
        />
      )}
    </>
  )
}
