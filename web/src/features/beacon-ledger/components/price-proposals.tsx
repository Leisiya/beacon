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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { StaticDataTable } from '@/components/data-table'
import { EmptyState } from '@/components/empty-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TitledCard } from '@/components/ui/titled-card'
import { toIntlLocale } from '@/i18n/languages'
import { handleServerError } from '@/lib/handle-server-error'

import { postPriceProposal } from '../api'
import { formatBp, formatCny, usePriceLineLabel } from '../lib/pricing'
import type { ChannelCost, PriceProposal } from '../types'

interface ProposalDetail {
  basis?: ChannelCost
}

function proposalDetail(proposal: PriceProposal): ProposalDetail {
  try {
    return JSON.parse(proposal.detail) as ProposalDetail
  } catch {
    return {}
  }
}

export function PriceProposals(props: { proposals: PriceProposal[] }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const lineLabel = usePriceLineLabel()
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState<PriceProposal | null>(null)
  const decide = useMutation({
    mutationFn: (input: { id: number; action: 'apply' | 'dismiss' }) =>
      postPriceProposal(input.id, input.action),
    onSuccess: (_, input) => {
      toast.success(
        input.action === 'apply'
          ? t('New price applied')
          : t('Suggestion dismissed')
      )
      setConfirming(null)
    },
    onError: (error) => handleServerError(error),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['beacon-ledger'] })
    },
  })
  return (
    <TitledCard
      title={<h2>{t('Price changes awaiting confirmation')}</h2>}
      description={t(
        'Applying a change prices every customer’s next request at the new rate, including prepaid balances.'
      )}
      disableHoverEffect
    >
      {props.proposals.length === 0 && (
        <EmptyState
          title={t('No pending price changes')}
          description={t(
            'Suggestions appear here when a supplier’s price moves the markup away from the rule.'
          )}
        />
      )}
      <div className='flex min-w-0 flex-col gap-6'>
        {props.proposals.map((proposal) => {
          const factor = Number(proposal.factor)
          const basis = proposalDetail(proposal).basis
          return (
            <section
              key={proposal.id}
              className='flex min-w-0 flex-col gap-3 border-b pb-6 last:border-b-0 last:pb-0'
            >
              <div className='flex flex-wrap items-center gap-2'>
                <h3 className='font-medium break-all'>{proposal.model_name}</h3>
                <Badge variant={factor >= 1 ? 'warning' : 'secondary'}>
                  {factor >= 1
                    ? t('Raise {{percent}}', {
                        percent: formatBp(
                          Math.round((factor - 1) * 10000),
                          locale
                        ),
                      })
                    : t('Lower {{percent}}', {
                        percent: formatBp(
                          Math.round((1 - factor) * 10000),
                          locale
                        ),
                      })}
                </Badge>
              </div>
              <p className='text-muted-foreground text-sm'>
                {t('Lowest markup {{current}} → target {{target}}', {
                  current: formatBp(proposal.current_markup_bp, locale),
                  target: formatBp(proposal.target_markup_bp, locale),
                })}
                {basis &&
                  ` · ${t(
                    'Basis: #{{id}} {{name}}, upstream group {{group}} ratio {{ratio}}, ¥{{rate}} per upstream $1',
                    {
                      id: basis.channel_id,
                      name: basis.channel_name,
                      group: basis.upstream_group || '—',
                      ratio: basis.group_ratio,
                      rate: basis.cny_per_unit,
                    }
                  )}`}
              </p>
              {basis && basis.lines.length > 0 && (
                <StaticDataTable
                  className='overflow-x-auto'
                  tableProps={{ withContainer: false }}
                  data={basis.lines}
                  getRowKey={(line) => `${line.kind}-${line.context}`}
                  containerProps={{
                    role: 'region',
                    'aria-label': proposal.model_name,
                    tabIndex: 0,
                  }}
                  tableClassName='min-w-[560px]'
                  columns={[
                    {
                      id: 'kind',
                      header: t('Usage (per 1M tokens)'),
                      cell: (line) => lineLabel(line),
                    },
                    {
                      id: 'cost',
                      header: t('Cost (CNY)'),
                      cell: (line) => formatCny(line.cost_cny, locale),
                    },
                    {
                      id: 'sale',
                      header: t('Current sale price'),
                      cell: (line) => formatCny(line.sale_cny, locale),
                    },
                    {
                      id: 'next',
                      header: t('After the change (about)'),
                      cell: (line) => formatCny(line.sale_cny * factor, locale),
                    },
                  ]}
                />
              )}
              <details className='text-sm'>
                <summary className='min-h-11 cursor-pointer py-2'>
                  {t('Billing expressions')}
                </summary>
                <p className='text-muted-foreground'>{t('Current')}</p>
                <code className='block break-all'>{proposal.old_expr}</code>
                <p className='text-muted-foreground mt-2'>{t('New')}</p>
                <code className='block break-all'>{proposal.new_expr}</code>
              </details>
              <div className='flex flex-wrap gap-2'>
                <Button
                  className='min-h-11'
                  disabled={decide.isPending}
                  onClick={() => setConfirming(proposal)}
                >
                  {t('Apply new price')}
                </Button>
                <Button
                  className='min-h-11'
                  variant='outline'
                  disabled={decide.isPending}
                  onClick={() =>
                    decide.mutate({ id: proposal.id, action: 'dismiss' })
                  }
                >
                  {t('Dismiss')}
                </Button>
              </div>
            </section>
          )
        })}
      </div>
      <ConfirmDialog
        open={!!confirming}
        onOpenChange={(open) => {
          if (!open) setConfirming(null)
        }}
        title={t('Apply the new price for {{model}}?', {
          model: confirming?.model_name,
        })}
        desc={t(
          'All customers, including prepaid balances, are charged the new price from their next request. Requests already billed do not change.'
        )}
        confirmText={t('Apply new price')}
        isLoading={decide.isPending}
        handleConfirm={() => {
          if (confirming) decide.mutate({ id: confirming.id, action: 'apply' })
        }}
      />
    </TitledCard>
  )
}
