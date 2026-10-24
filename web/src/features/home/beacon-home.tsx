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
*/
import { Link } from '@tanstack/react-router'
import { ArrowRight, Layers3, Menu, Route, ShieldCheck, X } from 'lucide-react'
import { useState } from 'react'

import { Footer } from '@/components/layout/components/footer'
import { useTheme } from '@/context/theme-provider'

import './beacon.css'

type ThemeChoice = 'light' | 'dark' | 'system'

function BeaconMark() {
  return (
    <svg className='beacon-mark' viewBox='0 0 40 44' aria-hidden='true'>
      <path
        d='M3 39h34M7 36h26M12 33h16'
        fill='none'
        stroke='currentColor'
        strokeWidth='2'
      />
      <path
        d='m15 33 2-19h6l2 19Z'
        fill='var(--beacon-tower)'
        stroke='currentColor'
        strokeWidth='2'
      />
      <path d='M12 13h16v3H12zM16 7h8v6h-8zM19 3h2v4h-2z' fill='currentColor' />
      <path d='M18 18h4v5h-4z' fill='var(--beacon-glow)' />
    </svg>
  )
}

export function BeaconScene() {
  const waterLines = [
    [72, 404, 118],
    [206, 404, 80],
    [304, 404, 326],
    [646, 404, 38],
    [104, 416, 96],
    [224, 416, 64],
    [326, 416, 276],
    [622, 416, 42],
    [140, 430, 66],
    [250, 430, 52],
    [342, 430, 224],
    [594, 430, 48],
    [178, 444, 52],
    [298, 444, 44],
    [354, 444, 170],
    [544, 444, 42],
    [322, 458, 50],
    [380, 458, 96],
    [490, 458, 46],
    [350, 472, 32],
    [392, 472, 64],
    [370, 486, 24],
    [406, 486, 38],
  ]
  const beamDots = [
    [194, 176],
    [226, 182],
    [258, 188],
    [290, 194],
    [316, 199],
    [194, 190],
    [230, 194],
    [266, 198],
    [298, 201],
    [200, 204],
    [238, 206],
    [274, 207],
    [414, 198],
    [446, 190],
    [478, 182],
    [510, 174],
    [542, 166],
    [422, 206],
    [458, 199],
    [494, 192],
    [530, 185],
    [432, 214],
    [470, 209],
    [508, 204],
  ]
  return (
    <svg
      className='beacon-scene'
      viewBox='0 0 720 500'
      role='img'
      aria-label='像素风灯塔矗立在海岛上，暖色灯光照向海面'
      shapeRendering='crispEdges'
    >
      <g className='scene-sun'>
        <path d='M570 72h32v6h12v10h8v28h-8v10h-12v6h-32v-6h-12v-10h-8V88h8V78h12z' />
        <path
          className='scene-sun-shade'
          d='M602 78h12v10h8v28h-8v10h-12v6h-16v-6h16v-10h8V88h-8z'
        />
      </g>
      <g className='scene-moon'>
        <path d='M574 76h30v6h12v12h6v22h-6v10h-12v6h-30v-6h-12v-10h-6V94h6V82h12z' />
        <path
          className='scene-moon-shadow'
          d='M604 76h12v12h-8v10h-12v8h-18v-8h-8V88h8V76z'
        />
      </g>
      <g className='scene-stars'>
        <path d='M500 62h4v4h-4zM498 66h8v4h-8zM500 70h4v4h-4zM646 44h4v4h-4zM644 48h8v4h-8zM646 52h4v4h-4zM670 152h6v6h-6z' />
      </g>
      <g className='scene-beam'>
        {beamDots.map(([x, y]) => (
          <rect key={`${x}-${y}`} x={x} y={y} width='4' height='4' />
        ))}
      </g>
      <path
        className='scene-bird'
        d='M104 250h6v4h6v4h6v-4h6v-4h6m504-13h6v4h6v4h6v-4h6v-4h6M530 292h6v4h6v4h6v-4h6v-4h6'
      />
      <path
        className='scene-hill-far'
        d='M28 370h26v-8h12v-8h12v-6h20v6h14v8h22v-8h12v-8h18v8h14v8h18v8h-168zm570-8h20v-8h12v-8h22v8h12v8h24v8h-90z'
      />
      <path
        className='scene-island'
        d='M92 388v-8h22v-8h22v-12h20v-10h18v-12h18v-8h18v-14h18v-10h18v-10h24v10h14v-14h20v-16h20v-10h18v12h18v-10h18v12h16v12h20v-8h20v12h16v12h20v10h20v8h18v10h22v12h24v12h22v8h36v10H92z'
      />
      <path
        className='scene-rock'
        d='M116 388v-10h20v-12h24v-10h18v-10h22v-10h18v12h20v-16h18v-10h18v8h16v20h20v-16h20v10h18v-18h16v-10h18v12h20v-10h18v8h18v12h22v-6h18v8h18v12h22v8h24v18H116z'
      />
      <path
        className='scene-rock-highlight'
        d='M156 360h18v-8h18v-8h12v8h-14v10h-16v8h-18zm86-36h14v-10h16v10h-10v12h-20zm226 22h18v-8h18v8h-10v10h-26zM548 370h16v-8h14v8h-10v8h-20z'
      />
      <path
        className='scene-tower-outline'
        d='M342 380v-24h6v-42h6v-54h6v-54h-12v-8h-6v-40h6v-8h12v-8h8v-12h6v-8h4v-14h6v14h4v8h6v12h8v8h12v8h6v40h-6v8h-12v54h6v54h6v42h6v24z'
      />
      <path
        className='scene-tower'
        d='M350 372v-16h6v-42h6v-54h6v-54h30v54h6v54h6v42h6v16z'
      />
      <path
        className='scene-tower-side'
        d='M390 206h8v54h6v54h6v42h6v16h-26z'
      />
      <path
        className='scene-roof'
        d='M352 158v-8h10v-8h8v-8h8v-8h8v8h8v8h8v8h10v8z'
      />
      <path
        className='scene-cap'
        d='M376 112h6v22h-6zM368 146h22v4h-22zM344 194h72v8h-72z'
      />
      <path className='scene-lantern' d='M350 160h64v34h-64z' />
      <path className='scene-light' d='M364 166h36v22h-36z' />
      <path
        className='scene-lantern-frame'
        d='M350 160h64v6h-64zM350 188h64v6h-64zM356 166h6v22h-6zM376 166h6v22h-6zM402 166h6v22h-6z'
      />
      <path
        className='scene-window'
        d='M378 232h8v18h-8zM376 282h8v20h-8zM372 336h8v18h-8z'
      />
      <path
        className='scene-tower-shade'
        d='M368 208h4v24h-4zM360 262h4v18h-4zM400 318h4v20h-4z'
      />
      <path
        className='scene-house-roof'
        d='M412 336v-8h8v-8h8v-8h8v-8h12v8h8v8h8v8h8v8z'
      />
      <path className='scene-house' d='M418 336h50v40h-50z' />
      <path className='scene-door' d='M426 350h10v26h-10zM450 346h8v12h-8z' />
      <path
        className='scene-house-trim'
        d='M416 334h54v6h-54zM442 340h4v36h-4z'
      />
      <path
        className='scene-foreground'
        d='M88 388h540v6H88zM142 382h76v6h-76zM276 380h64v8h-64zM466 380h96v8h-96z'
      />
      <g className='scene-shore'>
        {waterLines.map(([x, y, width]) => (
          <rect key={`${x}-${y}`} x={x} y={y} width={width} height='3' />
        ))}
      </g>
      <path
        className='scene-reflection'
        d='M362 398h40v4h-40zM370 412h30v4h-30zM378 426h22v4h-22zM384 440h20v4h-20zM388 454h16v4h-16zM394 468h12v4h-12z'
      />
    </svg>
  )
}

export function BeaconHeader({
  isAuthenticated = false,
}: {
  isAuthenticated?: boolean
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const { theme, setTheme } = useTheme()
  const closeMenu = () => setMenuOpen(false)
  return (
    <header className='beacon-header'>
      <div className='beacon-container beacon-header-inner'>
        <Link
          to='/'
          className='beacon-brand'
          aria-label='Beacon 首页'
          onClick={closeMenu}
        >
          <BeaconMark />
          <span>Beacon</span>
        </Link>
        <button
          className='beacon-mobile-toggle'
          type='button'
          aria-label={menuOpen ? '关闭菜单' : '打开菜单'}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {menuOpen ? <X size={21} /> : <Menu size={21} />}
        </button>
        <nav
          className={`beacon-nav${menuOpen ? ' is-open' : ''}`}
          aria-label='主要导航'
        >
          <Link to='/pricing' onClick={closeMenu}>
            模型与价格
          </Link>
          <Link to='/beacon-preview/dashboard' onClick={closeMenu}>
            控制台样板
          </Link>
          <a
            href='https://docs.newapi.ai'
            target='_blank'
            rel='noopener noreferrer'
            onClick={closeMenu}
          >
            API 文档 ↗
          </a>
          <Link to='/about' onClick={closeMenu}>
            关于
          </Link>
          <div className='beacon-nav-actions'>
            <label className='beacon-theme-label'>
              主题
              <select
                aria-label='主题'
                value={theme}
                onChange={(event) =>
                  setTheme(event.target.value as ThemeChoice)
                }
              >
                <option value='system'>跟随系统</option>
                <option value='light'>浅色</option>
                <option value='dark'>深色</option>
              </select>
            </label>
            <Link
              className='beacon-nav-login'
              to={isAuthenticated ? '/dashboard' : '/sign-in'}
              onClick={closeMenu}
            >
              {isAuthenticated ? '控制台' : '登录'}
            </Link>
            <Link
              className='beacon-button beacon-button-primary beacon-nav-start'
              to={isAuthenticated ? '/dashboard' : '/sign-up'}
              onClick={closeMenu}
            >
              {isAuthenticated ? '进入控制台' : '开始使用'}
            </Link>
          </div>
        </nav>
      </div>
    </header>
  )
}

export function BeaconHome({ isAuthenticated }: { isAuthenticated: boolean }) {
  return (
    <div className='beacon-page'>
      <BeaconHeader isAuthenticated={isAuthenticated} />
      <main>
        <section className='beacon-hero beacon-container'>
          <div className='beacon-hero-copy'>
            <p className='beacon-eyebrow'>A BRIGHTER WAY TO AI</p>
            <h1>
              让强大的模型，
              <br />
              更简单地抵达你。
            </h1>
            <p className='beacon-hero-description'>
              一个接口，连接已配置的 AI 模型。
              <br />
              统一管理密钥、渠道和用量，让接入更从容。
            </p>
            <div className='beacon-hero-actions'>
              <Link
                className='beacon-button beacon-button-primary'
                to={isAuthenticated ? '/dashboard' : '/sign-up'}
              >
                {isAuthenticated ? '进入控制台' : '开始使用'}{' '}
                <ArrowRight size={17} />
              </Link>
              <Link
                className='beacon-button beacon-button-secondary'
                to='/pricing'
              >
                查看模型
              </Link>
            </div>
            <p className='beacon-local-note'>
              当前为本地开发版本 · 模型及价格以后台实际配置为准
            </p>
          </div>
          <div className='beacon-hero-art'>
            <BeaconScene />
            <span className='beacon-art-caption'>
              Beacon
              <br />
              Guide your AI journey.
            </span>
          </div>
        </section>
        <section
          className='beacon-benefits beacon-container'
          aria-label='服务能力'
        >
          <div>
            <Layers3 size={26} strokeWidth={1.8} />
            <strong>多模型接入</strong>
            <span>在一个入口管理已配置的模型</span>
          </div>
          <div>
            <Route size={26} strokeWidth={1.8} />
            <strong>渠道配置</strong>
            <span>通过后台维护上游渠道</span>
          </div>
          <div>
            <ShieldCheck size={26} strokeWidth={1.8} />
            <strong>用量可查</strong>
            <span>查看密钥、调用日志与余额</span>
          </div>
        </section>
        <section className='beacon-next beacon-container'>
          <div>
            <p className='beacon-eyebrow'>START WITH BEACON</p>
            <h2>从一个清晰的入口开始。</h2>
            <p>
              创建账户、配置 API
              Key，再按实际可用模型接入应用。本站仍在本地建设中，功能以控制台状态为准。
            </p>
          </div>
          <Link
            className='beacon-text-link'
            to={isAuthenticated ? '/dashboard' : '/sign-up'}
          >
            前往控制台 <ArrowRight size={18} />
          </Link>
        </section>
      </main>
      <Footer />
    </div>
  )
}
