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
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TitledCard } from '@/components/ui/titled-card'

import { PricingRules } from './components/pricing-rules'
import { ProfitSummary } from './components/profit-summary'
import { UpstreamSources } from './components/upstream-sources'

export type ProfitPricingTab = 'profit' | 'costs' | 'pricing'

export function BeaconProfitPricing(props: {
  tab: ProfitPricingTab
  onTabChange: (tab: ProfitPricingTab) => void
}) {
  const { t } = useTranslation()
  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        {t('Profit and pricing')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <Tabs
          value={props.tab}
          onValueChange={(value) =>
            props.onTabChange(value as ProfitPricingTab)
          }
        >
          <TabsList className='mb-4 min-h-12'>
            <TabsTrigger className='min-h-11 px-4' value='profit'>
              {t('Profit')}
            </TabsTrigger>
            <TabsTrigger className='min-h-11 px-4' value='costs'>
              {t('Purchase prices')}
            </TabsTrigger>
            <TabsTrigger className='min-h-11 px-4' value='pricing'>
              {t('Sale prices')}
            </TabsTrigger>
          </TabsList>
          <TabsContent value='profit'>
            <ProfitSummary />
          </TabsContent>
          <TabsContent value='costs'>
            <div className='flex min-w-0 flex-col gap-4'>
              <TitledCard
                title={<h2>{t('Add a new upstream')}</h2>}
                disableHoverEffect
              >
                <ol className='flex list-decimal flex-col gap-2 ps-5 text-sm'>
                  <li>
                    {t(
                      'Create the channel and pass its test. Choose the New API type when the upstream is built on New API.'
                    )}{' '}
                    <Link
                      to='/channels'
                      className='text-primary inline-flex min-h-11 items-center underline underline-offset-4 sm:min-h-0'
                    >
                      {t('Open channels')}
                    </Link>
                  </li>
                  <li>
                    {t(
                      'Set its purchase price below: the CNY you pay for $1 of the upstream’s credit. Start it before the first request on that key.'
                    )}
                  </li>
                  <li>
                    {t(
                      'Sync now, then check each model’s markup under Sale prices.'
                    )}{' '}
                    <Button
                      variant='link'
                      className='h-auto min-h-11 p-0 font-normal underline underline-offset-4 sm:min-h-0'
                      onClick={() => props.onTabChange('pricing')}
                    >
                      {t('Open sale prices')}
                    </Button>
                  </li>
                </ol>
              </TitledCard>
              <UpstreamSources />
            </div>
          </TabsContent>
          <TabsContent value='pricing'>
            <PricingRules />
          </TabsContent>
        </Tabs>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
