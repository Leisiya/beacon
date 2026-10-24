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

import { BeaconArtwork } from '@/components/beacon-artwork'
import { BeaconMark } from '@/components/beacon-mark'

type AuthLayoutProps = {
  children: React.ReactNode
}

export function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div className='beacon-auth-layout relative grid lg:grid-cols-[minmax(0,1fr)_minmax(440px,0.9fr)]'>
      <Link
        to='/'
        className='absolute top-5 left-5 z-10 flex items-center gap-2.5 text-xl font-bold tracking-tight transition-opacity hover:opacity-80 sm:top-8 sm:left-8'
      >
        <BeaconMark className='size-9' />
        <span>Beacon</span>
      </Link>
      <aside className='beacon-auth-art hidden min-h-svh items-center justify-center px-8 pt-24 pb-14 lg:flex'>
        <div className='flex w-full max-w-[630px] flex-col items-center text-center'>
          <BeaconArtwork alt='海岛上的灯塔' />
          <p className='text-muted-foreground mt-2 font-mono text-[11px] tracking-[0.28em]'>
            A BRIGHTER WAY TO AI
          </p>
          <p className='mt-4 text-2xl font-semibold tracking-tight'>
            让强大的模型，更简单地抵达你。
          </p>
        </div>
      </aside>
      <div className='flex min-w-0 items-center justify-center px-4 pt-24 pb-10 sm:px-8 lg:px-12 lg:py-16'>
        <div className='beacon-auth-panel flex w-full max-w-[490px] flex-col justify-center space-y-2 px-5 py-7 sm:px-9 sm:py-10'>
          {children}
        </div>
      </div>
    </div>
  )
}
