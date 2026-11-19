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
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { StaticDataTable } from '@/components/data-table'
import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { toIntlLocale } from '@/i18n/languages'
import { handleServerError } from '@/lib/handle-server-error'

import { deletePricingRule, postPricingRule } from '../api'
import { formatBp, formatCny, usePriceLineLabel } from '../lib/pricing'
import type { ChannelCost, ModelPricing, PricingRuleInput } from '../types'
import { PriceRuleForm } from './price-rule-form'

// Cost against sale for every supplier of one model, plus its rule override.
export function ModelPricingDialog(props: {
  model: ModelPricing | null
  onOpenChange: (open: boolean) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const lineLabel = usePriceLineLabel()
  const queryClient = useQueryClient()
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['beacon-ledger'] })
  }
  const saveRule = useMutation({
    mutationFn: (rule: PricingRuleInput) => postPricingRule(rule),
    onSuccess: () => {
      toast.success(t('Price rule saved'))
      refresh()
      props.onOpenChange(false)
    },
    onError: (error) => handleServerError(error),
  })
  const resetRule = useMutation({
    mutationFn: (name: string) => deletePricingRule(name),
    onSuccess: () => {
      toast.success(t('The model now follows the default rule'))
      refresh()
      props.onOpenChange(false)
    },
    onError: (error) => handleServerError(error),
  })
  const model = props.model
  const channelStatus: Record<ChannelCost['status'], string> = {
    ok: t('Cost and sale compared'),
    no_rate: t('No CNY rate on this channel'),
    no_observation: t('No synced charge for this model yet'),
    unsupported: t('Supplier pricing cannot be compared'),
  }
  const time = (seconds: number) =>
    new Date(seconds * 1000).toLocaleString(locale, {
      timeZone: 'Asia/Shanghai',
      hour12: false,
    })
  return (
    <Dialog
      open={!!model}
      onOpenChange={props.onOpenChange}
      title={model?.model_name ?? ''}
      description={t(
        'Cost and sale in CNY per 1M tokens. Sale uses the top-up price and the default group ratio.'
      )}
      contentClassName='sm:max-w-3xl'
    >
      {model && (
        <div className='flex min-w-0 flex-col gap-6'>
          {model.channels.map((channel) => (
            <section
              key={channel.channel_id}
              className='flex min-w-0 flex-col gap-2'
            >
              <h3 className='font-medium break-all'>
                #{channel.channel_id} {channel.channel_name}
                {channel.channel_id === model.basis_channel_id &&
                  ` · ${t('cost basis')}`}
              </h3>
              <p className='text-muted-foreground text-sm break-words'>
                {channelStatus[channel.status]}
                {channel.group_ratio &&
                  ` · ${t(
                    'Upstream model {{model}}, group {{group}} ratio {{ratio}}, seen {{time}}',
                    {
                      model: channel.upstream_model,
                      group: channel.upstream_group || '—',
                      ratio: channel.group_ratio,
                      time: time(channel.observed_at),
                    }
                  )}`}
                {channel.verified_count + channel.mismatch_count > 0 &&
                  ` · ${t(
                    '{{verified}} charges reproduced, {{mismatch}} differed',
                    {
                      verified: channel.verified_count,
                      mismatch: channel.mismatch_count,
                    }
                  )}`}
              </p>
              {channel.lines.length > 0 && (
                <StaticDataTable
                  className='overflow-x-auto'
                  tableProps={{ withContainer: false }}
                  data={channel.lines}
                  getRowKey={(line) => `${line.kind}-${line.context}`}
                  containerProps={{
                    role: 'region',
                    'aria-label': channel.channel_name,
                    tabIndex: 0,
                  }}
                  tableClassName='min-w-[520px]'
                  columns={[
                    {
                      id: 'kind',
                      header: t('Usage'),
                      cell: (line) => lineLabel(line),
                    },
                    {
                      id: 'cost',
                      header: t('Cost (CNY)'),
                      cell: (line) => formatCny(line.cost_cny, locale),
                    },
                    {
                      id: 'sale',
                      header: t('Sale price'),
                      cell: (line) => formatCny(line.sale_cny, locale),
                    },
                    {
                      id: 'markup',
                      header: t('Markup'),
                      cell: (line) => formatBp(line.markup_bp, locale),
                    },
                  ]}
                />
              )}
            </section>
          ))}
          <section className='flex flex-col gap-3 border-t pt-4'>
            <h3 className='font-medium'>
              {model.rule_overridden
                ? t('This model’s own rule')
                : t('Give this model its own rule')}
            </h3>
            <PriceRuleForm
              idPrefix='model-rule'
              rule={model.rule}
              modelName={model.model_name}
              submitLabel={t('Save model rule')}
              pending={saveRule.isPending}
              onSubmit={(rule) => saveRule.mutate(rule)}
            />
            {model.rule_overridden && (
              <Button
                className='min-h-11 self-start'
                variant='outline'
                disabled={resetRule.isPending}
                onClick={() => resetRule.mutate(model.model_name)}
              >
                {t('Use the default rule')}
              </Button>
            )}
          </section>
        </div>
      )}
    </Dialog>
  )
}
