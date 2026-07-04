import { describe, it, expect } from 'vitest'
import { scrapeSelectorInventory } from './domPreflight.js'
import type { RecordingConfig } from '../config/schema.js'

const recording = { browser: 'chromium', viewport: { width: 1024, height: 768 } } as unknown as RecordingConfig

describe('scrapeSelectorInventory finalUrl + auth', () => {
  it('returns items and the final (post-redirect) URL', async () => {
    // data: URL that has one button; final URL equals the requested one (no redirect)
    const html = '<!doctype html><button data-testid="go">Go</button>'
    const url = 'data:text/html,' + encodeURIComponent(html)
    const res = await scrapeSelectorInventory({ targetUrl: url, recording })
    expect(Array.isArray(res.items)).toBe(true)
    expect(res.items.some((i) => i.dataTestid === 'go')).toBe(true)
    expect(typeof res.finalUrl).toBe('string')
  }, 30000)

  it('runs auth.postLaunch before scraping the target', async () => {
    const html = '<!doctype html><a data-testid="dash">Dashboard</a>'
    const url = 'data:text/html,' + encodeURIComponent(html)
    let ran = false
    const res = await scrapeSelectorInventory({
      targetUrl: url, recording,
      auth: { postLaunch: async () => { ran = true } },
    })
    expect(ran).toBe(true)
    expect(res.items.some((i) => i.dataTestid === 'dash')).toBe(true)
  }, 30000)
})
