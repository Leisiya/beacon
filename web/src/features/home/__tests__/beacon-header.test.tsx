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
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { BeaconHeader } from '../beacon-home'

const theme = vi.hoisted(() => ({ value: 'system', setTheme: vi.fn() }))

vi.mock('@/context/theme-provider', () => ({
  useTheme: () => ({ theme: theme.value, setTheme: theme.setTheme }),
}))
vi.mock('@tanstack/react-router', () => ({
  Link: (props: {
    to: string
    className?: string
    children?: React.ReactNode
  }) => (
    <a href={props.to} className={props.className}>
      {props.children}
    </a>
  ),
}))

afterEach(() => {
  theme.setTheme.mockReset()
})

it('offers sign-in and sign-up when signed out', () => {
  render(<BeaconHeader />)

  expect(screen.getByRole('link', { name: '登录' })).toHaveAttribute(
    'href',
    '/sign-in'
  )
  expect(screen.getByRole('link', { name: '开始使用' })).toHaveAttribute(
    'href',
    '/sign-up'
  )
})

it('shows a single console entry instead of two links to the same page when signed in', () => {
  render(<BeaconHeader isAuthenticated />)

  const consoleLinks = screen
    .getAllByRole('link')
    .filter((link) => link.getAttribute('href') === '/dashboard')

  expect(consoleLinks).toHaveLength(1)
  expect(consoleLinks[0]).toHaveTextContent('进入控制台')
  expect(screen.queryByRole('link', { name: '登录' })).not.toBeInTheDocument()
})

it('switches the theme from the labelled select with the full option text', async () => {
  const user = userEvent.setup()
  render(<BeaconHeader />)

  const select = screen.getByRole('combobox', { name: '主题' })
  expect(select).toHaveDisplayValue('跟随系统')
  await user.selectOptions(select, 'dark')

  expect(theme.setTheme).toHaveBeenCalledWith('dark')
})
