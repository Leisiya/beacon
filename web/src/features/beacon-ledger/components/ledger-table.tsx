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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { StaticDataTable } from '@/components/data-table'
import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import { ledgerMoney } from '../lib/form'
import type { LedgerEntry, LedgerKind } from '../types'

export function LedgerTable(props: {
  entries: LedgerEntry[]
  postingAvailable: boolean
  onCorrect: (entry: LedgerEntry, kind: LedgerKind) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [detail, setDetail] = useState<LedgerEntry | null>(null)
  const kinds = {
    receipt: t('Manual receipt'),
    gift: t('Gift quota'),
    refund: t('Full refund'),
    reversal: t('Reverse entry'),
  }
  return (
    <>
      <StaticDataTable
        className='overflow-x-auto'
        tableProps={{ withContainer: false }}
        data={props.entries}
        getRowKey={(entry) => entry.id}
        containerProps={{
          role: 'region',
          'aria-label': t('Ledger entries'),
          tabIndex: 0,
        }}
        tableClassName='min-w-[680px]'
        columns={[
          {
            id: 'id',
            header: t('Entry'),
            cell: (row) => (
              <Button
                className='min-h-11'
                variant='outline'
                onClick={() => setDetail(row)}
              >
                #{row.id} · {kinds[row.kind]}
              </Button>
            ),
          },
          {
            id: 'user',
            header: t('Customer ID'),
            cell: (row) => formatNumber(row.user_id, locale),
          },
          {
            id: 'cash',
            header: t('Cash amount (CNY)'),
            cell: (row) => ledgerMoney(row.cny_amount_minor, 'CNY'),
          },
          {
            id: 'quota',
            header: t('Quota change (units)'),
            cell: (row) => formatNumber(row.quota_delta, locale),
          },
          {
            id: 'actions',
            header: t('Actions'),
            cell: (row) => (
              <div className='flex flex-wrap gap-2'>
                {row.correction_id && (
                  <span>
                    {t('Corrected by #{{id}}', { id: row.correction_id })}
                  </span>
                )}
                {row.corrects_id && (
                  <span>{t('Corrects #{{id}}', { id: row.corrects_id })}</span>
                )}
                {!row.correction_id && !row.corrects_id && (
                  <>
                    {row.kind === 'receipt' && (
                      <Button
                        className='min-h-11'
                        variant='outline'
                        disabled={!props.postingAvailable}
                        onClick={() => props.onCorrect(row, 'refund')}
                      >
                        {t('Full refund')}
                      </Button>
                    )}
                    <Button
                      className='min-h-11'
                      variant='outline'
                      disabled={!props.postingAvailable}
                      onClick={() => props.onCorrect(row, 'reversal')}
                    >
                      {t('Reverse entry')}
                    </Button>
                  </>
                )}
              </div>
            ),
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
            {[
              [t('Entry type'), kinds[detail.kind]],
              [t('Customer ID'), String(detail.user_id)],
              [t('Operator ID'), String(detail.operator_id)],
              [
                t('Original currency amount'),
                ledgerMoney(
                  detail.original_amount_minor,
                  detail.currency || 'CNY'
                ),
              ],
              [
                t('Cash amount (CNY)'),
                ledgerMoney(detail.cny_amount_minor, 'CNY'),
              ],
              [
                t('Quota change (units)'),
                formatNumber(detail.quota_delta, locale),
              ],
              [t('CNY per original currency unit'), detail.cny_per_unit || '—'],
              [t('Exchange rate source'), detail.fx_source || '—'],
              [t('Payment method'), detail.payment_method || '—'],
              [
                t('External payment reference'),
                detail.payment_reference || '—',
              ],
              [
                t('Occurred at (Asia/Shanghai)'),
                new Date(detail.occurred_at * 1000).toLocaleString(locale, {
                  timeZone: 'Asia/Shanghai',
                }),
              ],
              [
                t('Recorded at (Asia/Shanghai)'),
                new Date(detail.recorded_at * 1000).toLocaleString(locale, {
                  timeZone: 'Asia/Shanghai',
                }),
              ],
              [t('Reason / evidence'), detail.note],
              [t('Request key'), detail.idempotency_key],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className='text-muted-foreground'>{label}</dt>
                <dd className='break-all whitespace-pre-wrap'>{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </Dialog>
    </>
  )
}
