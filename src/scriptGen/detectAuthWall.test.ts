import { describe, it, expect } from 'vitest'
import { detectAuthWall } from './detectAuthWall.js'
import type { SelectorInventoryItem } from './domPreflight.js'

const login: SelectorInventoryItem[] = [
  { tag: 'input', selector: 'input[name="username"]', name: 'username' },
  { tag: 'input', selector: 'input[name="password"]', name: 'password' },
  { tag: 'button', selector: 'button:has-text("Sign in")', visibleText: 'Sign in' },
]

describe('detectAuthWall', () => {
  it('flags a redirect to a login page with a password field (mode form)', () => {
    const c = detectAuthWall('http://x/dashboard/1', 'http://x/auth/login', login)
    expect(c?.mode).toBe('form')
    expect(c?.fields.find((f) => f.type === 'password')?.selector).toBe('input[name="password"]')
    expect(c?.fields.find((f) => f.type === 'text')?.selector).toBe('input[name="username"]')
    expect(c?.submit_selector).toContain('Sign in')
  })
  it('returns null when the final URL matches the target (no wall)', () => {
    expect(detectAuthWall('http://x/dashboard/1', 'http://x/dashboard/1', login)).toBeNull()
  })
  it('returns mode unsupported when redirected but no password field (SSO)', () => {
    const sso: SelectorInventoryItem[] = [{ tag: 'a', selector: 'a:has-text("Continue with SSO")', visibleText: 'Continue with SSO' }]
    const c = detectAuthWall('http://x/dashboard/1', 'http://x/auth/sso', sso)
    expect(c?.mode).toBe('unsupported')
  })
})
