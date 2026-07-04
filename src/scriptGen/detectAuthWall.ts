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
  // Password field: the canonical signal is type="password". Fall back to a name/selector
  // hint (pass/pwd) for the rare form that omits the type. Keyed off type first so a
  // non-English or obfuscated field name (name="secret", name="mdp", …) is still found.
  const isInput = (i: SelectorInventoryItem) => i.tag === 'input'
  const PW_HINT = /pass|pwd|mot.?de.?passe|contrase/i
  const passwordItem = inventory.find(
    (i) => isInput(i) && (i.inputType === 'password' || PW_HINT.test(i.name ?? '') || PW_HINT.test(i.selector)),
  )
  const looksAuthy = AUTH_URL_RE.test(finalUrl) || !!passwordItem
  if (!diverged || !looksAuthy) return null

  if (!passwordItem) {
    return { login_url: finalUrl, mode: 'unsupported', fields: [] }
  }
  // Username: prefer a text-ish input whose name/placeholder/aria semantically hints an
  // identity field (user/email/login/account/phone), else the first text-ish non-password
  // input. Restricting to text-ish types keeps a checkbox/hidden/search field from winning
  // just because it happens to precede the password.
  const TEXTISH = new Set(['text', 'email', 'tel', 'username', undefined as unknown as string])
  const isTextish = (i: SelectorInventoryItem) =>
    isInput(i) && i !== passwordItem && (i.inputType == null || TEXTISH.has(i.inputType))
  const USER_HINT = /user|e-?mail|login|account|phone|mobile|identifier/i
  const userItem =
    inventory.find((i) => isTextish(i) &&
      (USER_HINT.test(i.name ?? '') || USER_HINT.test(i.placeholder ?? '') ||
       USER_HINT.test(i.ariaLabel ?? '') || USER_HINT.test(i.selector))) ??
    inventory.find(isTextish)
  // Submit control: prefer a button/submit-input whose text reads like a submit verb; then
  // any type="submit" control (covers <input type=submit> forms with no visible text); then
  // any button. NEVER match a non-control on visibleText alone — a login-page CONTAINER's
  // textContent includes its child button's "Sign in", so a bare text-regex over all
  // elements matches the container (observed against real Metabase: `[data-testid=
  // "login-page"]` won over the real `button:has-text("Sign in")` and the form never
  // submitted).
  const isButton = (i: SelectorInventoryItem) => i.tag === 'button' || i.role === 'button'
  const isSubmit = (i: SelectorInventoryItem) => i.inputType === 'submit' || (isButton(i) && i.inputType !== 'button')
  const submitRe = /submit|sign.?in|log.?in|continue|next|proceed|se.connecter|anmelden/i
  const submit =
    inventory.find((i) => (isButton(i) || isSubmit(i)) && submitRe.test(i.visibleText ?? '')) ??
    inventory.find(isSubmit) ??
    inventory.find(isButton)
  const fields: AuthField[] = []
  if (userItem) fields.push({ name: userItem.name ?? 'username', type: 'text', label: userItem.placeholder ?? userItem.ariaLabel ?? 'Username', selector: userItem.selector })
  fields.push({ name: passwordItem.name ?? 'password', type: 'password', label: passwordItem.placeholder ?? passwordItem.ariaLabel ?? 'Password', selector: passwordItem.selector })
  return { login_url: finalUrl, mode: 'form', fields, submit_selector: submit?.selector }
}
