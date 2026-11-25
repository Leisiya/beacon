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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { StaticDataTable } from '@/components/data-table'
import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { toIntlLocale } from '@/i18n/languages'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { formatNumber } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'

import { postExpense, postUpstreamPayment } from '../api'
import { formatCredit } from '../lib/cost'
import { entryKindLabels, ledgerMoney, newRequestKey } from '../lib/form'
import type { BookEntry, LedgerEntry } from '../types'

type EntryView = {
  key: string
  id: number
  label: string
  party: string
  cash: string
  credited: string
  occurredAt: number
  correctsId: number | null
  details: [string, string][]
}

// How one row of the books reads in the table and its detail dialog.
function describeEntry(
  entry: BookEntry,
  t: TFunction,
  locale: Intl.LocalesArgument
): EntryView {
  const time = (seconds: number): string =>
    new Date(seconds * 1000).toLocaleString(locale, {
      timeZone: 'Asia/Shanghai',
      hour12: false,
    })
  const note = (text: string): [string, string][] =>
    text ? [[t('Note'), text]] : []
  if (entry.source === 'customer') {
    const row = entry.customer
    return {
      key: `customer-${row.id}`,
      id: row.id,
      label: t(entryKindLabels[row.kind]),
      party: `${t('Customer')} #${row.user_id}`,
      cash: ledgerMoney(row.cny_amount_minor, 'CNY'),
      credited: formatQuotaWithCurrency(row.quota_delta, {
        abbreviate: false,
        locale,
      }),
      occurredAt: row.occurred_at,
      correctsId: row.corrects_id,
      details: [
        [t('Entry type'), t(entryKindLabels[row.kind])],
        [t('Customer ID'), String(row.user_id)],
        [t('Operator ID'), String(row.operator_id)],
        [
          t('Original currency amount'),
          ledgerMoney(row.original_amount_minor, row.currency || 'CNY'),
        ],
        [t('Cash amount (CNY)'), ledgerMoney(row.cny_amount_minor, 'CNY')],
        [t('Quota change (units)'), formatNumber(row.quota_delta, locale)],
        [t('CNY per original currency unit'), row.cny_per_unit || '—'],
        ...(row.fx_source
          ? [[t('Exchange rate source'), row.fx_source] as [string, string]]
          : []),
        [t('Payment method'), row.payment_method || '—'],
        [t('External payment reference'), row.payment_reference || '—'],
        [t('Occurred at (Asia/Shanghai)'), time(row.occurred_at)],
        [t('Recorded at (Asia/Shanghai)'), time(row.recorded_at)],
        ...note(row.note),
        [t('Request key'), row.idempotency_key],
      ],
    }
  }
  if (entry.source === 'upstream') {
    const row = entry.upstream
    const label = t(
      row.kind === 'payment' ? entryKindLabels.upstream : 'Reverse entry'
    )
    const upstream = `${entry.channel_name || '—'} #${row.channel_id}`
    return {
      key: `upstream-${row.id}`,
      id: row.id,
      label,
      party: upstream,
      cash: ledgerMoney(row.cny_amount_minor, 'CNY'),
      credited: formatCredit(row.credit_micro),
      occurredAt: row.occurred_at,
      correctsId: row.corrects_id,
      details: [
        [t('Entry type'), label],
        [t('Upstream'), upstream],
        [t('Operator ID'), String(row.operator_id)],
        [t('CNY paid'), ledgerMoney(row.cny_amount_minor, 'CNY')],
        [t('Credit received (upstream $)'), formatCredit(row.credit_micro)],
        [t('Occurred at (Asia/Shanghai)'), time(row.occurred_at)],
        [t('Recorded at (Asia/Shanghai)'), time(row.recorded_at)],
        ...note(row.note),
      ],
    }
  }
  const row = entry.expense
  const category = t(entryKindLabels[row.category])
  const label = row.kind === 'expense' ? category : t('Reverse entry')
  return {
    key: `expense-${row.id}`,
    id: row.id,
    label,
    party: '—',
    cash: ledgerMoney(row.cny_amount_minor, 'CNY'),
    credited: '—',
    occurredAt: row.occurred_at,
    correctsId: row.corrects_id,
    details: [
      [t('Entry type'), label],
      [t('Category'), category],
      [t('Operator ID'), String(row.operator_id)],
      [t('Amount (CNY)'), ledgerMoney(row.cny_amount_minor, 'CNY')],
      [t('Occurred at (Asia/Shanghai)'), time(row.occurred_at)],
      [t('Recorded at (Asia/Shanghai)'), time(row.recorded_at)],
      ...note(row.note),
    ],
  }
}

export function LedgerTable(props: {
  entries: BookEntry[]
  postingAvailable: boolean
  // Opens a reversal of a customer entry, which needs a security proof.
  onCorrect: (entry: LedgerEntry) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const queryClient = useQueryClient()
  const [detail, setDetail] = useState<EntryView | null>(null)
  // Money paid out is reversed without a proof; the key makes a retry safe.
  const [reversing, setReversing] = useState<{
    entry: BookEntry
    key: string
  } | null>(null)
  const reverse = useMutation({
    mutationFn: (request: {
      entry: BookEntry
      key: string
    }): Promise<unknown> => {
      const occurredAt = Math.floor(Date.now() / 1000)
      if (request.entry.source === 'upstream') {
        return postUpstreamPayment({
          request_key: request.key,
          channel_id: 0,
          amount: '',
          credit: '',
          corrects_id: request.entry.upstream.id,
          occurred_at: occurredAt,
          note: '',
        })
      }
      if (request.entry.source === 'expense') {
        return postExpense({
          request_key: request.key,
          category: '',
          amount: '',
          corrects_id: request.entry.expense.id,
          occurred_at: occurredAt,
          note: '',
        })
      }
      return Promise.reject(new Error('Customer entries need a proof'))
    },
    onSuccess: () => {
      toast.success(t('Entry reversed'))
      setReversing(null)
      void queryClient.invalidateQueries({ queryKey: ['beacon-ledger'] })
    },
    onError: (error) => handleServerError(error),
  })
  const rows = props.entries.map((entry) => ({
    entry,
    view: describeEntry(entry, t, locale),
  }))
  return (
    <>
      <StaticDataTable
        className='overflow-x-auto'
        tableProps={{ withContainer: false }}
        data={rows}
        getRowKey={(row) => row.view.key}
        containerProps={{
          role: 'region',
          'aria-label': t('Ledger entries'),
          tabIndex: 0,
        }}
        tableClassName='min-w-[760px]'
        columns={[
          {
            id: 'id',
            header: t('Entry'),
            cell: (row) => (
              <Button
                className='min-h-11'
                variant='outline'
                onClick={() => setDetail(row.view)}
              >
                #{row.view.id} · {row.view.label}
              </Button>
            ),
          },
          {
            id: 'party',
            header: t('Customer or upstream'),
            cell: (row) => <span className='break-all'>{row.view.party}</span>,
          },
          {
            id: 'cash',
            header: t('Cash amount (CNY)'),
            cell: (row) => row.view.cash,
          },
          {
            id: 'credited',
            header: t('Credited'),
            cell: (row) => row.view.credited,
          },
          {
            id: 'occurred',
            header: t('Occurred at (Asia/Shanghai)'),
            cell: (row) =>
              new Date(row.view.occurredAt * 1000).toLocaleString(locale, {
                timeZone: 'Asia/Shanghai',
                hour12: false,
              }),
          },
          {
            id: 'actions',
            header: t('Actions'),
            cell: (row) => {
              const entry = row.entry
              if (entry.correction_id) {
                return t('Corrected by #{{id}}', { id: entry.correction_id })
              }
              if (row.view.correctsId) {
                return t('Corrects #{{id}}', { id: row.view.correctsId })
              }
              if (entry.source !== 'customer') {
                return (
                  <Button
                    className='min-h-11'
                    variant='outline'
                    onClick={() =>
                      setReversing({ entry, key: newRequestKey() })
                    }
                  >
                    {t('Reverse entry')}
                  </Button>
                )
              }
              return (
                <Button
                  className='min-h-11'
                  variant='outline'
                  disabled={!props.postingAvailable}
                  onClick={() => props.onCorrect(entry.customer)}
                >
                  {t('Reverse entry')}
                </Button>
              )
            },
          },
        ]}
      />
      <Dialog
        open={!!detail}
        onOpenChange={(open) => {
          if (!open) setDetail(null)
        }}
        title={t('Ledger entry #{{id}}', { id: detail?.id })}
      >
        {detail && (
          <dl className='grid gap-3 text-sm break-words'>
            {detail.details.map(([label, value]) => (
              <div key={label}>
                <dt className='text-muted-foreground'>{label}</dt>
                <dd className='break-all whitespace-pre-wrap'>{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </Dialog>
      <ConfirmDialog
        open={!!reversing}
        onOpenChange={(open) => {
          if (!open && !reverse.isPending) setReversing(null)
        }}
        title={t('Reverse this entry?')}
        desc={t(
          'The entry stays in the books and a reversal with the opposite amount is added.'
        )}
        confirmText={t('Reverse entry')}
        destructive
        isLoading={reverse.isPending}
        handleConfirm={() => {
          if (reversing) reverse.mutate(reversing)
        }}
      />
    </>
  )
}
