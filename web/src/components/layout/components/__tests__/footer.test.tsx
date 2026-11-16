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
import { render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { Footer } from '../footer'

const config = vi.hoisted(() => ({ systemName: '' }))

vi.mock('@/hooks/use-system-config', () => ({
  useSystemConfig: () => ({
    systemName: config.systemName,
    footerHtml: '',
    demoSiteEnabled: false,
  }),
}))
vi.mock('@/hooks/use-status', () => ({ useStatus: () => ({ status: {} }) }))
vi.mock('@tanstack/react-router', () => ({
  Link: (props: { to: string; children?: React.ReactNode }) => (
    <a href={props.to}>{props.children}</a>
  ),
}))

afterEach(() => {
  config.systemName = ''
})

it('brands the footer as Beacon and keeps the New API attribution', () => {
  render(<Footer />)

  expect(screen.getByRole('link', { name: 'Beacon' })).toHaveAttribute(
    'href',
    '/'
  )
  expect(screen.getByText('Guide your AI journey.')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'New API' })).toHaveAttribute(
    'href',
    'https://github.com/QuantumNous/new-api'
  )
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
})

it('keeps the Beacon brand when the site name setting is still the upstream default', () => {
  config.systemName = 'New API'

  render(<Footer />)

  expect(screen.getByRole('link', { name: 'Beacon' })).toBeInTheDocument()
  expect(screen.getByText(/© \d{4} Beacon\./)).toBeInTheDocument()
})

it('links the public Beacon pages from the footer navigation', () => {
  render(<Footer />)

  const nav = screen.getByRole('navigation', { name: 'Footer' })
  const hrefs = [...nav.querySelectorAll('a')].map((a) =>
    a.getAttribute('href')
  )
  expect(hrefs).toEqual(['/pricing', '/docs', '/about'])
})
