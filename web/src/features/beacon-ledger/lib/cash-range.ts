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
import { z } from 'zod'

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00+08:00`)
    return (
      Number.isFinite(parsed.getTime()) &&
      new Date(parsed.getTime() + 8 * 3600000).toISOString().slice(0, 10) ===
        value &&
      value >= '2000-01-01'
    )
  })

export const cashRangeSchema = z
  .object({
    period: z.enum(['today', 'month', 'all', 'custom']),
    start: z.string(),
    end: z.string(),
  })
  .superRefine((values, ctx) => {
    if (values.period !== 'custom') return
    const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
    for (const key of ['start', 'end'] as const) {
      if (!date.safeParse(values[key]).success || values[key] > today) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: 'Invalid date range',
        })
      }
    }
    if (values.end < values.start) {
      ctx.addIssue({
        code: 'custom',
        path: ['end'],
        message: 'Invalid date range',
      })
    }
  })
export type CashRangeValues = z.infer<typeof cashRangeSchema>
