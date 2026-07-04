import type { SelectorInventoryItem } from './domPreflight.js'

export interface AuthField {
  name: string
  type: 'text' | 'password'
  label: string
  selector: string
}

export interface AuthChallenge {
  login_url: string
  mode: 'form' | 'unsupported'
  fields: AuthField[]
  submit_selector?: string
}

const AUTH_URL_RE = /\/(login|auth|signin|sign-in|sso)(\/|$|\?)/i

function pathOf(u: string): string {
  try { return new URL(u).pathname } catch { return u }
}

/** Null unless the explored page is an auth wall the requested target diverged into. */
export function detectAuthWall(
  targetUrl: string,
  finalUrl: string,
  inventory: SelectorInventoryItem[],
): AuthChallenge | null {
  const diverged = pathOf(finalUrl) !== pathOf(targetUrl)
  const passwordItem = inventory.find(
    (i) => i.tag === 'input' && (/pass/i.test(i.name ?? '') || /pass/i.test(i.selector)),
  )
  const looksAuthy = AUTH_URL_RE.test(finalUrl) || !!passwordItem
  if (!diverged || !looksAuthy) return null

  if (!passwordItem) {
    return { login_url: finalUrl, mode: 'unsupported', fields: [] }
  }
  // username = the first non-password text/email input (usually precedes password)
  const userItem = inventory.find(
    (i) => i.tag === 'input' && i !== passwordItem && !/pass/i.test(i.selector),
  )
  const submit = inventory.find(
    (i) => i.tag === 'button' || i.role === 'button' || /submit|sign\s?in|log\s?in/i.test(i.visibleText ?? ''),
  )
  const fields: AuthField[] = []
  if (userItem) fields.push({ name: userItem.name ?? 'username', type: 'text', label: userItem.placeholder ?? userItem.ariaLabel ?? 'Username', selector: userItem.selector })
  fields.push({ name: passwordItem.name ?? 'password', type: 'password', label: passwordItem.placeholder ?? passwordItem.ariaLabel ?? 'Password', selector: passwordItem.selector })
  return { login_url: finalUrl, mode: 'form', fields, submit_selector: submit?.selector }
}
