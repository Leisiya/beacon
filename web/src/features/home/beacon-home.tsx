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

function BeaconScene() {
  return (
    <svg
      className='beacon-scene'
      viewBox='0 0 720 500'
      role='img'
      aria-label='灯塔矗立在海岛上，为旅程照亮方向'
    >
      <circle className='scene-sun' cx='594' cy='106' r='34' />
      <circle className='scene-moon' cx='594' cy='106' r='26' />
      <g className='scene-stars'>
        <circle cx='518' cy='64' r='2' />
        <circle cx='635' cy='58' r='1.8' />
        <circle cx='663' cy='143' r='1.5' />
      </g>
      <path
        className='scene-beam'
        d='M360 173 142 130v86l218-31ZM386 173l217-49v83l-217-22Z'
      />
      <path
        className='scene-bird'
        d='m120 248 8 5 8-5m17-16 6 4 6-4m445 20 8 5 8-5'
        fill='none'
        strokeWidth='2.5'
        strokeLinecap='round'
      />
      <path
        className='scene-hill-far'
        d='M45 370q30-19 59-3 23-31 55-16 17-15 40-6 33-29 67-7 28-22 51-4 41-13 72 11 33-18 66 0 24-12 47 9 27-19 59 8 37-12 76 8v25H45Z'
      />
      <path
        className='scene-island'
        d='M88 382q31-4 54-33l22 6 23-27 24 9 31-38 26 13 30-30 23 13 20-32 25 31 27-16 28 25 27-11 30 28 20-13 23 28 28-3 20 38 48 14v11H88Z'
      />
      <path
        className='scene-rock'
        d='m133 382 27-28 20 9 28-28 24 13 25-29 19 18 35-20 21 31 29-20 30 22 36-18 34 36 22-10 18 24Z'
      />
      <path className='scene-tower' d='m316 356 13-166h62l13 166Z' />
      <path className='scene-tower-side' d='m364 190 27 0 13 166h-39Z' />
      <path className='scene-lantern' d='M322 156h76v35h-76Z' />
      <path className='scene-roof' d='m317 156 43-30 43 30Z' />
      <path className='scene-cap' d='M333 124h54v6h-54zM357 111h6v13h-6z' />
      <path className='scene-light' d='M349 164h22v20h-22z' />
      <path className='scene-window' d='M351 218h13v20h-13zm-2 53h13v21h-13z' />
      <path className='scene-house' d='M404 355v-48l30-24 30 24v48Z' />
      <path className='scene-house-roof' d='m397 309 37-32 37 32Z' />
      <path className='scene-door' d='M427 355v-24h14v24zm-2-45h8v10h-8z' />
      <path
        className='scene-shore'
        d='M65 389h593m-551 12h495m-430 11h360m-302 12h264m-211 13h156m-120 12h84m-65 13h45'
        fill='none'
        strokeWidth='3'
      />
      <path
        className='scene-reflection'
        d='M360 390v72m-34-47h71m-55 18h39'
        fill='none'
        strokeWidth='4'
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
