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

import { getLedger } from './api'
import { LedgerEntryDialog } from './components/ledger-entry-dialog'
import { LedgerTable } from './components/ledger-table'
import type { LedgerEntry, LedgerKind } from './types'

export function BeaconLedger() {
  const { t } = useTranslation()
  const [filter, setFilter] = useState('')
  const [userId, setUserId] = useState(0)
  const [before, setBefore] = useState(0)
  const [cursors, setCursors] = useState<number[]>([])
  const [draft, setDraft] = useState<{
    kind: LedgerKind
    source?: LedgerEntry
  } | null>(null)
  const [open, setOpen] = useState(false)
  const ledger = useQuery({
    queryKey: ['beacon-ledger', userId, before],
    queryFn: () => getLedger(userId, before),
    retry: false,
  })
  const postingAvailable = ledger.data?.posting_available === true
  const startEntry = (kind: LedgerKind, source?: LedgerEntry): void => {
    if (!draft) setDraft({ kind, source })
    setOpen(true)
  }
  return (
    <>
      <SectionPageLayout stackActionsOnMobile>
        <SectionPageLayout.Title>{t('Manual ledger')}</SectionPageLayout.Title>
        <SectionPageLayout.Actions>
          <Button
            className='min-h-11'
            disabled={!postingAvailable}
            onClick={() => startEntry('receipt')}
          >
            {draft ? t('Continue draft') : t('Record ledger entry')}
          </Button>
        </SectionPageLayout.Actions>
        <SectionPageLayout.Content>
          <div className='flex min-w-0 flex-col gap-4'>
            <p className='text-muted-foreground text-sm'>
              {t(
                'CNY reporting · Asia/Shanghai. Cash and quota are separate. This ledger includes only entries recorded here, not historical top-ups or usage revenue.'
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
                setUserId(Number(filter))
                setBefore(0)
                setCursors([])
              }}
            >
              <Field className='max-w-64'>
                <FieldLabel htmlFor='ledger-customer-filter'>
                  {t('Customer ID (blank for all)')}
                </FieldLabel>
                <Input
                  id='ledger-customer-filter'
                  className='min-h-11'
                  value={filter}
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
                  !Number.isSafeInteger(Number(filter)) || Number(filter) < 0
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
                onCorrect={(entry, kind) => startEntry(kind, entry)}
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
                  setBefore(cursors.at(-1) ?? 0)
                  setCursors(cursors.slice(0, -1))
                }}
              >
                {t('Previous')}
              </Button>
              <Button
                className='min-h-11'
                variant='outline'
                disabled={
                  !ledger.data?.next_before ||
                  ledger.isFetching ||
                  ledger.isError
                }
                onClick={() => {
                  setCursors([...cursors, before])
                  setBefore(ledger.data?.next_before ?? 0)
                }}
              >
                {t('Next')}
              </Button>
            </nav>
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>
      {draft && (
        <LedgerEntryDialog
          open={open}
          kind={draft.kind}
          source={draft.source}
          onOpenChange={(nextOpen) => {
            setOpen(nextOpen)
            if (!nextOpen) setDraft(null)
          }}
          onComplete={() => {
            setOpen(false)
            setDraft(null)
            setBefore(0)
            setCursors([])
          }}
        />
      )}
    </>
  )
}
