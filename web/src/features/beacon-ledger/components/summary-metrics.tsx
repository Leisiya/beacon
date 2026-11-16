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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export interface SummaryMetric {
  label: string
  value: string
}

export function SummaryMetrics(props: { metrics: SummaryMetric[] }) {
  return (
    <div className='grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4'>
      {props.metrics.map((metric) => (
        <Card key={metric.label} data-card-hover='false'>
          <CardHeader>
            <CardTitle>{metric.label}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className='text-xl font-semibold break-all tabular-nums'>
              {metric.value}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
