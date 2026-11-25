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
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { StaticDataTable } from '@/components/data-table'
import { EmptyState } from '@/components/empty-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TitledCard } from '@/components/ui/titled-card'
import { toIntlLocale } from '@/i18n/languages'

import { formatBp, formatCny } from '../lib/pricing'
import type { ModelPricing, PriceLine, PriceProposal } from '../types'
import { ModelPricingDialog } from './model-pricing-dialog'
import { SalePriceSheet } from './sale-price-sheet'

export function ModelPricingTable(props: {
  models: ModelPricing[]
  proposals: PriceProposal[]
  groupRatio: number
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const pending = new Set(
    props.proposals.map((proposal) => proposal.model_name)
  )
  // Input and output at standard context, or the per-request price.
  const priceSummary = (
    lines: PriceLine[],
    field: 'sale_cny' | 'cost_cny'
  ): string => {
    const at = (kind: string) =>
      lines.find((line) => line.kind === kind && line.context <= 1000)
    const request = at('request')
    if (request) {
      return t('{{price}} per request', {
        price: formatCny(request[field], locale),
      })
    }
    const input = at('input')
    const output = at('output')
    if (!input || !output) return '—'
    return `${formatCny(input[field], locale)} / ${formatCny(output[field], locale)}`
  }
  const statusText: Record<ModelPricing['status'], string> = {
    ok: t('Cost and sale compared'),
    legacy_pricing: t(
      'Ratio pricing: convert it to a billing expression first'
    ),
    no_cost: t('No supplier cost yet'),
    free_sale: t('Some usage is free to customers but charged upstream'),
    unsupported_expr: t('Expression shape cannot be adjusted automatically'),
  }
  return (
    <TitledCard
      title={<h2>{t('Models: cost and sale')}</h2>}
      description={t(
        'Prices in CNY at the top-up price. Markup is the lowest across usage types, against the most expensive enabled supplier. A direct price edit below the rule’s target markup brings a raise suggestion.'
      )}
      disableHoverEffect
    >
      {props.models.length === 0 ? (
        <EmptyState
          title={t('No models')}
          description={t('Models offered by enabled channels appear here.')}
        />
      ) : (
        <StaticDataTable
          className='overflow-x-auto'
          tableProps={{ withContainer: false }}
          data={props.models}
          getRowKey={(model) => model.model_name}
          containerProps={{
            role: 'region',
            'aria-label': t('Models: cost and sale'),
            tabIndex: 0,
          }}
          tableClassName='min-w-[920px]'
          columns={[
            {
              id: 'model',
              header: t('Model'),
              cell: (model) => (
                <div className='flex flex-col'>
                  <span className='font-medium break-all'>
                    {model.model_name}
                  </span>
                  <span className='text-muted-foreground text-xs'>
                    {model.rule_overridden ? t('Own rule') : t('Default rule')}
                    {model.rule.mode === 'fixed' &&
                      ` · ${t('Fixed sale price')}`}
                  </span>
                </div>
              ),
            },
            {
              id: 'sale',
              header: t('Sale per 1M tokens (input / output)'),
              cell: (model) => (
                <span className='tabular-nums'>
                  {priceSummary(model.sale, 'sale_cny')}
                </span>
              ),
            },
            {
              id: 'cost',
              header: t('Cost per 1M tokens (input / output)'),
              cell: (model) => {
                const basis = model.channels.find(
                  (channel) => channel.channel_id === model.basis_channel_id
                )
                if (!basis) return '—'
                return (
                  <div className='flex flex-col'>
                    <span className='tabular-nums'>
                      {priceSummary(basis.lines, 'cost_cny')}
                    </span>
                    <span className='text-muted-foreground text-xs break-all'>
                      #{basis.channel_id} {basis.channel_name} · ×
                      {basis.group_ratio}
                    </span>
                  </div>
                )
              },
            },
            {
              id: 'markup',
              header: t('Lowest markup'),
              cell: (model) => {
                // An enabled channel without a cost is left out of the
                // comparison, so the markup through it may be lower.
                const uncosted = model.channels.filter(
                  (channel) => channel.status !== 'ok'
                )
                return (
                  <div className='flex flex-col gap-1'>
                    <div className='flex flex-wrap items-center gap-2'>
                      <span className='tabular-nums'>
                        {formatBp(model.current_markup_bp, locale)}
                      </span>
                      {model.below_minimum && (
                        <Badge variant='destructive'>
                          {t('Below minimum')}
                        </Badge>
                      )}
                    </div>
                    {uncosted.length > 0 && (
                      <span className='text-warning text-xs break-all'>
                        {t('Not counted, no cost yet: {{channels}}', {
                          channels: uncosted
                            .map(
                              (channel) =>
                                `#${channel.channel_id} ${channel.channel_name}`
                            )
                            .join(', '),
                        })}
                      </span>
                    )}
                  </div>
                )
              },
            },
            {
              id: 'status',
              header: t('Status'),
              cell: (model) => (
                <div className='flex flex-col gap-1 text-sm'>
                  <span>{statusText[model.status]}</span>
                  {pending.has(model.model_name) && (
                    <Badge variant='warning'>{t('Price change pending')}</Badge>
                  )}
                </div>
              ),
            },
            {
              id: 'actions',
              header: t('Actions'),
              cell: (model) => (
                <div className='flex flex-wrap gap-2'>
                  <Button
                    className='min-h-11'
                    variant='outline'
                    onClick={() => setEditing(model.model_name)}
                  >
                    {t('Edit sale price')}
                  </Button>
                  <Button
                    className='min-h-11'
                    variant='outline'
                    onClick={() => setSelected(model.model_name)}
                  >
                    {t('Details and rule')}
                  </Button>
                </div>
              ),
            },
          ]}
        />
      )}
      <SalePriceSheet
        modelName={editing}
        groupRatio={props.groupRatio}
        onOpenChange={(open) => {
          if (open) return
          setEditing(null)
          void queryClient.invalidateQueries({ queryKey: ['beacon-ledger'] })
        }}
      />
      <ModelPricingDialog
        model={
          props.models.find((model) => model.model_name === selected) ?? null
        }
        onOpenChange={(open) => {
          if (!open) setSelected(null)
        }}
      />
    </TitledCard>
  )
}
