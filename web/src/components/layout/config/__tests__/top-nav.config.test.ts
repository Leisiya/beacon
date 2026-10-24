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
import { describe, expect, it } from 'vitest'

import { resolveBeaconTopNavLinks } from '../top-nav.config'

describe('Beacon public navigation', () => {
  it('opens the local documentation when the backend points to upstream New API docs', () => {
    const links = resolveBeaconTopNavLinks([
      { title: '文档', href: 'https://docs.newapi.pro/', external: true },
    ])

    expect(links).toEqual([{ title: '文档', href: '/docs', external: false }])
  })

  it('preserves a custom documentation destination configured by the operator', () => {
    const custom = {
      title: '文档',
      href: 'https://example.com/docs',
      external: true,
    }

    expect(resolveBeaconTopNavLinks([custom])).toEqual([custom])
  })
})
