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
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { AuthLayout } from '../auth-layout'

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it('keeps the registration form accessible and the Beacon brand link returns home', async () => {
  const root = createRootRoute({ component: Outlet })
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({
        getParentRoute: () => root,
        path: '/',
        component: () => <h1>首页</h1>,
      }),
      createRoute({
        getParentRoute: () => root,
        path: '/sign-up',
        component: () => (
          <AuthLayout>
            <form aria-label='注册表单'>
              <label htmlFor='username'>用户名</label>
              <input id='username' />
            </form>
          </AuthLayout>
        ),
      }),
    ]),
    history: createMemoryHistory({ initialEntries: ['/sign-up'] }),
  })

  render(<RouterProvider router={router} />)

  expect(await screen.findByRole('form', { name: '注册表单' })).toBeVisible()
  expect(screen.getByRole('textbox', { name: '用户名' })).toBeVisible()

  await userEvent.click(screen.getByRole('link', { name: 'Beacon' }))
  await waitFor(() =>
    expect(screen.getByRole('heading', { name: '首页' })).toBeVisible()
  )
})
