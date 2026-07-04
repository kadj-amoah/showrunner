import { describe, it, expect } from 'vitest'
import { detectAuthWall } from './detectAuthWall.js'
import type { SelectorInventoryItem } from './domPreflight.js'

// A Metabase-shaped login (type=password, name=username, a real <button>Sign in</button>).
const metabase: SelectorInventoryItem[] = [
  { tag: 'main', selector: '[data-testid="login-page"]', visibleText: 'Sign in to Metabase Sign in' },
  { tag: 'input', selector: 'input[name="username"]', name: 'username', inputType: 'text' },
  { tag: 'input', selector: 'input[name="password"]', name: 'password', inputType: 'password' },
  { tag: 'button', selector: 'button:has-text("Sign in")', visibleText: 'Sign in', inputType: 'submit' },
]

describe('detectAuthWall — core', () => {
  it('flags a redirect to a login page with a password field (mode form)', () => {
    const c = detectAuthWall('http://x/dashboard/1', 'http://x/auth/login', metabase)
    expect(c?.mode).toBe('form')
    expect(c?.fields.find((f) => f.type === 'password')?.selector).toBe('input[name="password"]')
    expect(c?.fields.find((f) => f.type === 'text')?.selector).toBe('input[name="username"]')
  })
  it('returns null when the final URL matches the target (no wall)', () => {
    expect(detectAuthWall('http://x/dashboard/1', 'http://x/dashboard/1', metabase)).toBeNull()
  })
  it('returns null when diverged but the page is not auth-looking (no password, no auth URL)', () => {
    const notLogin: SelectorInventoryItem[] = [
      { tag: 'input', selector: 'input[name="q"]', name: 'q', inputType: 'search' },
      { tag: 'button', selector: 'button.go', visibleText: 'Go' },
    ]
    expect(detectAuthWall('http://x/dashboard/1', 'http://x/some/other/page', notLogin)).toBeNull()
  })
  it('returns mode unsupported when redirected but no password field (SSO)', () => {
    const sso: SelectorInventoryItem[] = [{ tag: 'a', selector: 'a:has-text("Continue with SSO")', visibleText: 'Continue with SSO' }]
    const c = detectAuthWall('http://x/dashboard/1', 'http://x/auth/sso', sso)
    expect(c?.mode).toBe('unsupported')
  })
})

// Generality: the heuristics must not be tuned to Metabase's specific DOM. Each of these is
// a differently-shaped real-world login and must resolve the right password/username/submit.
describe('detectAuthWall — generality across login shapes', () => {
  it('the real submit is the BUTTON, never a container whose text includes "Sign in"', () => {
    const c = detectAuthWall('http://x/dashboard/1', 'http://x/auth/login', metabase)
    expect(c?.submit_selector).toBe('button:has-text("Sign in")')
    expect(c?.submit_selector).not.toContain('login-page')
  })

  it('plain HTML form: <input type=submit> is the submit control', () => {
    const plain: SelectorInventoryItem[] = [
      { tag: 'input', selector: '#user', name: 'user', inputType: 'text' },
      { tag: 'input', selector: '#pw', name: 'pwd', inputType: 'password' },
      { tag: 'input', selector: 'input[type="submit"]', inputType: 'submit', visibleText: '' },
    ]
    const c = detectAuthWall('http://x/app', 'http://x/login', plain)
    expect(c?.submit_selector).toBe('input[type="submit"]')
    expect(c?.fields.find((f) => f.type === 'password')?.selector).toBe('#pw')
    expect(c?.fields.find((f) => f.type === 'text')?.selector).toBe('#user')
  })

  it('password found by type even when the name has no "pass"/"pwd" (obfuscated/localized)', () => {
    const localized: SelectorInventoryItem[] = [
      { tag: 'input', selector: '#identifiant', name: 'identifiant', inputType: 'text' },
      { tag: 'input', selector: '#secret', name: 'secret', inputType: 'password' },   // no pass/pwd in name
      { tag: 'button', selector: 'button#go', visibleText: 'Se connecter', inputType: 'submit' },
    ]
    const c = detectAuthWall('http://x/tableau', 'http://x/connexion', localized)
    expect(c?.mode).toBe('form')
    expect(c?.fields.find((f) => f.type === 'password')?.selector).toBe('#secret')
    expect(c?.submit_selector).toBe('button#go')   // "Se connecter" matched
  })

  it('username picked by semantic hint, not merely position (a search box precedes it)', () => {
    const withSearch: SelectorInventoryItem[] = [
      { tag: 'input', selector: '#site-search', name: 'search', placeholder: 'Search', inputType: 'search' },
      { tag: 'input', selector: '#email', placeholder: 'Email address', inputType: 'email' },
      { tag: 'input', selector: '#password', inputType: 'password' },
      { tag: 'button', selector: 'button.login', visibleText: 'Log in' },
    ]
    const c = detectAuthWall('http://x/home', 'http://x/login', withSearch)
    // the email field, not the leading search input, is the username
    expect(c?.fields.find((f) => f.type === 'text')?.selector).toBe('#email')
  })

  it('falls back to any button when none has submit-like text and no submit input exists', () => {
    const inv: SelectorInventoryItem[] = [
      { tag: 'input', selector: 'input[name="password"]', name: 'password', inputType: 'password' },
      { tag: 'button', selector: 'button.arrow', visibleText: '→' },
    ]
    const c = detectAuthWall('http://x/dashboard/1', 'http://x/login', inv)
    expect(c?.submit_selector).toBe('button.arrow')
  })
})
