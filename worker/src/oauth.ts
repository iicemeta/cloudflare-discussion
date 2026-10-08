import type { Env } from './types'
import { first, run, queryCount } from './db'
import { DAY_MS, base64urlDecode, base64urlEncode, normalizeEmail, nowIso, randomId, sha256Hex } from './utils'
import { buildCookie, createToken, getTokenKey, hashPassword, signHmac } from './auth'

export type OAuthProviderType = 'github' | 'google' | 'gitee' | 'generic'

export interface OAuthProviderConfig {
  key: string
  type: OAuthProviderType
  name: string
  enabled: boolean
  clientId: string
  clientSecret: string
  authorizeUrl: string
  tokenUrl: string
  userInfoUrl: string
  scope: string
  idField: string
  emailField: string
  nameField: string
  avatarField: string
  autoRegister: boolean
}

export interface OAuthConfig {
  providers: OAuthProviderConfig[]
}

const OAUTH_PROVIDER_TYPES: OAuthProviderType[] = ['github', 'google', 'gitee', 'generic']

interface OAuthPreset {
  name: string
  authorizeUrl: string
  tokenUrl: string
  userInfoUrl: string
  scope: string
  idField: string
  emailField: string
  nameField: string
  avatarField: string
}

/** 常见服务商预设，前端「系统设置」也依赖这套默认值 */
export const OAUTH_PRESETS: Record<Exclude<OAuthProviderType, 'generic'>, OAuthPreset> = {
  github: {
    name: 'GitHub',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userInfoUrl: 'https://api.github.com/user',
    scope: 'read:user user:email',
    idField: 'id',
    emailField: 'email',
    nameField: 'name',
    avatarField: 'avatar_url',
  },
  google: {
    name: 'Google',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    scope: 'openid email profile',
    idField: 'sub',
    emailField: 'email',
    nameField: 'name',
    avatarField: 'picture',
  },
  gitee: {
    name: 'Gitee',
    authorizeUrl: 'https://gitee.com/oauth/authorize',
    tokenUrl: 'https://gitee.com/oauth/token',
    userInfoUrl: 'https://gitee.com/api/v5/user',
    scope: 'user_info',
    idField: 'id',
    emailField: 'email',
    nameField: 'name',
    avatarField: 'avatar_url',
  },
}

function pickPreset(type: OAuthProviderType): OAuthPreset | null {
  return type === 'generic' ? null : OAUTH_PRESETS[type]
}

function sanitizeProviderKey(value: any, fallback: string) {
  const key = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
  return key || fallback
}

/** 把持久化里的任意结构收敛成稳定的 oauth2 配置 */
export function normalizeOAuthConfig(value: any): OAuthConfig {
  const providers = Array.isArray(value?.providers) ? value.providers : []
  const usedKeys = new Set<string>()

  const normalized = providers.map((item: any, index: number) => {
    const raw = item && typeof item === 'object' ? item : {}
    const type: OAuthProviderType = OAUTH_PROVIDER_TYPES.includes(raw.type) ? raw.type : 'generic'
    const preset = pickPreset(type)

    let key = sanitizeProviderKey(raw.key, `provider${index + 1}`)
    while (usedKeys.has(key)) {
      key = `${key}_${index + 1}`
    }
    usedKeys.add(key)

    return {
      key,
      type,
      name: String(raw.name || preset?.name || key).trim(),
      enabled: Boolean(raw.enabled),
      clientId: String(raw.clientId || '').trim(),
      clientSecret: String(raw.clientSecret || '').trim(),
      authorizeUrl: String(raw.authorizeUrl || preset?.authorizeUrl || '').trim(),
      tokenUrl: String(raw.tokenUrl || preset?.tokenUrl || '').trim(),
      userInfoUrl: String(raw.userInfoUrl || preset?.userInfoUrl || '').trim(),
      scope: String(raw.scope ?? preset?.scope ?? '').trim(),
      idField: String(raw.idField || preset?.idField || 'id').trim(),
      emailField: String(raw.emailField || preset?.emailField || 'email').trim(),
      nameField: String(raw.nameField || preset?.nameField || 'name').trim(),
      avatarField: String(raw.avatarField || preset?.avatarField || 'avatar_url').trim(),
      autoRegister: raw.autoRegister === undefined ? true : Boolean(raw.autoRegister),
    } satisfies OAuthProviderConfig
  })

  return { providers: normalized }
}

/** 对外（前端 /api/config）暴露的 OAuth 信息：只保留渲染按钮所需字段，绝不带出 clientSecret */
export function getPublicOAuthConfig(value: any) {
  const config = normalizeOAuthConfig(value)
  return {
    providers: config.providers
      .filter(provider => provider.enabled
        && provider.clientId
        && provider.clientSecret
        && provider.authorizeUrl
        && provider.tokenUrl
        && provider.userInfoUrl)
      .map(provider => ({ key: provider.key, name: provider.name, type: provider.type })),
  }
}

function isProviderReady(provider: OAuthProviderConfig) {
  return Boolean(
    provider.enabled
    && provider.clientId
    && provider.clientSecret
    && provider.authorizeUrl
    && provider.tokenUrl
    && provider.userInfoUrl,
  )
}

function findReadyProvider(config: any, key: string) {
  const oauth = normalizeOAuthConfig(config?.oauth2)
  return oauth.providers.find(provider => provider.key === key && isProviderReady(provider)) || null
}

function safeRedirectPath(value: any) {
  const target = String(value || '').trim()
  if (!target.startsWith('/') || target.startsWith('//')) {
    return '/'
  }
  return target
}

function oauthStateSecret(env: Env) {
  return `${env.JWT_SECRET_KEY || 'replace-this-secret'}:oauth-state`
}

async function createOAuthState(payload: { provider: string, redirect: string }, env: Env) {
  const data = base64urlEncode(JSON.stringify({
    ...payload,
    nonce: randomId(''),
    exp: Math.floor(Date.now() / 1000) + 10 * 60,
  }))
  const signature = await signHmac(data, oauthStateSecret(env))
  return `${data}.${signature}`
}

export async function verifyOAuthState(raw: string | null, env: Env) {
  if (!raw) {
    return null
  }
  const [data, signature] = raw.split('.')
  if (!data || !signature) {
    return null
  }
  const expected = await signHmac(data, oauthStateSecret(env))
  if (expected !== signature) {
    return null
  }
  try {
    const payload = JSON.parse(base64urlDecode(data)) as { provider?: string, redirect?: string, exp?: number }
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
      return null
    }
    return payload
  }
  catch {
    return null
  }
}

function buildCallbackUrl(request: Request, providerKey: string) {
  const origin = new URL(request.url).origin
  return {
    origin,
    callbackUrl: `${origin}/api/oauth/callback?provider=${encodeURIComponent(providerKey)}`,
  }
}

function redirectTo(request: Request, path: string, headers?: Headers) {
  const origin = new URL(request.url).origin
  const target = path.startsWith('/') ? `${origin}${path}` : path
  const responseHeaders = headers || new Headers()
  responseHeaders.set('Location', target)
  responseHeaders.set('Cache-Control', 'no-store')
  return new Response(null, { status: 302, headers: responseHeaders })
}

function redirectWithError(request: Request, path: string, message: string) {
  const separator = path.includes('?') ? '&' : '?'
  return redirectTo(request, `${path}${separator}oauth_error=${encodeURIComponent(message)}`)
}

/** 发起授权：/api/oauth/start?provider=xxx&redirect=/foo */
export async function handleOAuthStart(request: Request, env: Env, url: URL) {
  const { getSysConfig } = await import('./config')
  const config = await getSysConfig(env)
  const providerKey = String(url.searchParams.get('provider') || '').trim()
  const provider = findReadyProvider(config, providerKey)
  if (!provider) {
    return redirectWithError(request, '/member/login', '该登录方式不可用')
  }

  const redirectPath = safeRedirectPath(url.searchParams.get('redirect'))
  const { callbackUrl } = buildCallbackUrl(request, provider.key)
  const state = await createOAuthState({ provider: provider.key, redirect: redirectPath }, env)

  let authorize: URL
  try {
    authorize = new URL(provider.authorizeUrl)
  }
  catch {
    return redirectWithError(request, '/member/login', '授权地址配置有误')
  }
  authorize.searchParams.set('client_id', provider.clientId)
  authorize.searchParams.set('redirect_uri', callbackUrl)
  authorize.searchParams.set('response_type', 'code')
  authorize.searchParams.set('state', state)
  if (provider.scope) {
    authorize.searchParams.set('scope', provider.scope)
  }

  const headers = new Headers()
  headers.set('Location', authorize.toString())
  headers.set('Cache-Control', 'no-store')
  return new Response(null, { status: 302, headers })
}

/** 授权回调：/api/oauth/callback?provider=xxx&code=...&state=... */
export async function handleOAuthCallback(request: Request, env: Env, url: URL) {
  const { getSysConfig } = await import('./config')
  const config = await getSysConfig(env)
  const providerKey = String(url.searchParams.get('provider') || '').trim()

  const state = await verifyOAuthState(url.searchParams.get('state'), env)
  if (!state || state.provider !== providerKey) {
    return redirectWithError(request, '/member/login', '登录状态校验失败，请重试')
  }

  const redirectPath = safeRedirectPath(state.redirect)
  const provider = findReadyProvider(config, providerKey)
  if (!provider) {
    return redirectWithError(request, redirectPath, '该登录方式不可用')
  }

  const providerError = url.searchParams.get('error')
  if (providerError) {
    const description = url.searchParams.get('error_description')
      || url.searchParams.get('error_message')
      || providerError
    return redirectWithError(request, redirectPath, `授权失败：${description}`)
  }

  const code = String(url.searchParams.get('code') || '').trim()
  if (!code) {
    return redirectWithError(request, redirectPath, '未获取到授权码，请重试')
  }

  try {
    const { callbackUrl } = buildCallbackUrl(request, provider.key)
    const accessToken = await exchangeCodeForToken(provider, code, callbackUrl)
    const profile = await fetchOAuthProfile(provider, accessToken)
    const resolved = await resolveOAuthUser(env, provider, profile)

    if (resolved.user.status === 'BANNED') {
      return redirectWithError(request, redirectPath, '该账号已被封禁')
    }

    const now = nowIso()
    await run(env, 'UPDATE users SET last_login = ?, updated_at = ? WHERE id = ?', [now, now, resolved.user.id])

    const token = await createToken({
      uid: resolved.user.uid,
      userId: resolved.user.id,
      username: resolved.user.username,
      exp: Math.floor(Date.now() / 1000) + 10 * 24 * 60 * 60,
    }, env)

    const headers = new Headers()
    headers.append('Set-Cookie', buildCookie(getTokenKey(env), token, 10 * DAY_MS, env))
    return redirectTo(request, redirectPath, headers)
  }
  catch (error) {
    const message = error instanceof OAuthFlowError ? error.userMessage : '登录失败，请稍后重试'
    if (!(error instanceof OAuthFlowError)) {
      console.error('OAuth callback failed', error)
    }
    return redirectWithError(request, redirectPath, message)
  }
}

class OAuthFlowError extends Error {
  userMessage: string

  constructor(userMessage: string, detail?: string) {
    super(detail || userMessage)
    this.name = 'OAuthFlowError'
    this.userMessage = userMessage
  }
}

async function exchangeCodeForToken(provider: OAuthProviderConfig, code: string, redirectUri: string) {
  const form = new URLSearchParams({
    client_id: provider.clientId,
    client_secret: provider.clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  })

  let response: Response
  try {
    response = await fetch(provider.tokenUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'accept': 'application/json',
        'user-agent': 'discussion-workers',
      },
      body: form.toString(),
    })
  }
  catch {
    throw new OAuthFlowError('无法连接第三方登录服务')
  }

  const text = await response.text()
  const payload = parseTokenPayload(text)

  if (!response.ok || payload.error) {
    const detail = payload.error_description || payload.error || response.statusText
    throw new OAuthFlowError('第三方登录换取令牌失败', String(detail))
  }

  const accessToken = String(payload.access_token || '').trim()
  if (!accessToken) {
    throw new OAuthFlowError('第三方登录未返回访问令牌')
  }
  return accessToken
}

function parseTokenPayload(text: string): Record<string, any> {
  const trimmed = (text || '').trim()
  if (!trimmed) {
    return {}
  }
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed)
    }
    catch {
      return {}
    }
  }
  return Object.fromEntries(new URLSearchParams(trimmed))
}

async function fetchOAuthProfile(provider: OAuthProviderConfig, accessToken: string) {
  const profile = await requestJson(provider.userInfoUrl, accessToken)
  if (!profile || typeof profile !== 'object') {
    throw new OAuthFlowError('无法获取第三方用户信息')
  }
  const record = profile as Record<string, any>

  // GitHub 默认不返回邮箱，需要额外请求 /user/emails
  if (provider.type === 'github' && !getFieldValue(record, provider.emailField)) {
    const email = await fetchGitHubPrimaryEmail(accessToken)
    if (email) {
      record.__oauth_email = email
    }
  }

  return record
}

async function requestJson(target: string, accessToken: string) {
  let response: Response
  try {
    response = await fetch(target, {
      headers: {
        'authorization': `Bearer ${accessToken}`,
        'accept': 'application/json',
        'user-agent': 'discussion-workers',
      },
    })
  }
  catch {
    throw new OAuthFlowError('无法连接第三方用户信息接口')
  }

  if (!response.ok) {
    throw new OAuthFlowError('获取第三方用户信息失败', `${target} ${response.status}`)
  }

  try {
    return await response.json()
  }
  catch {
    throw new OAuthFlowError('第三方用户信息格式错误')
  }
}

async function fetchGitHubPrimaryEmail(accessToken: string) {
  try {
    const response = await fetch('https://api.github.com/user/emails', {
      headers: {
        'authorization': `Bearer ${accessToken}`,
        'accept': 'application/json',
        'user-agent': 'discussion-workers',
      },
    })
    if (!response.ok) {
      return ''
    }
    const emails = await response.json() as Array<{ email?: string, primary?: boolean, verified?: boolean }>
    if (!Array.isArray(emails)) {
      return ''
    }
    const primary = emails.find(item => item.primary && item.verified)
      || emails.find(item => item.verified)
      || emails.find(item => item.primary)
      || emails[0]
    return String(primary?.email || '').trim()
  }
  catch {
    return ''
  }
}

function getFieldValue(source: Record<string, any>, path: string): any {
  if (!path) {
    return undefined
  }
  return path.split('.').reduce<any>((acc, segment) => {
    if (acc && typeof acc === 'object') {
      return acc[segment]
    }
    return undefined
  }, source)
}

function resolveProviderEmail(provider: OAuthProviderConfig, profile: Record<string, any>) {
  const direct = getFieldValue(profile, provider.emailField)
  const fallback = profile.__oauth_email
  return normalizeEmail(String(direct || fallback || ''))
}

function resolveProviderUserId(provider: OAuthProviderConfig, profile: Record<string, any>) {
  const value = getFieldValue(profile, provider.idField)
  return value === undefined || value === null ? '' : String(value).trim()
}

/** 服务商返回的显示名，仅用于记录在 oauth_accounts.username，不直接当本站用户名 */
function resolveProviderName(provider: OAuthProviderConfig, profile: Record<string, any>) {
  return String(getFieldValue(profile, provider.nameField) || '').trim()
}

function resolveProviderAvatar(provider: OAuthProviderConfig, profile: Record<string, any>) {
  const value = getFieldValue(profile, provider.avatarField)
  const avatar = String(value || '').trim()
  return /^https?:\/\//i.test(avatar) ? avatar : ''
}

async function resolveOAuthUser(
  env: Env,
  provider: OAuthProviderConfig,
  profile: Record<string, any>,
): Promise<{ user: Record<string, any>, created: boolean }> {
  const providerUserId = resolveProviderUserId(provider, profile)
  if (!providerUserId) {
    throw new OAuthFlowError('无法识别第三方账号，请检查字段配置')
  }

  const email = resolveProviderEmail(provider, profile)
  const displayName = resolveProviderName(provider, profile)
  const avatar = resolveProviderAvatar(provider, profile)

  // 1) 已绑定过：直接登录
  const binding = await first(env, 'SELECT * FROM oauth_accounts WHERE provider = ? AND provider_user_id = ?', [provider.key, providerUserId])
  if (binding) {
    const bound = await first(env, 'SELECT * FROM users WHERE uid = ?', [binding.uid])
    if (bound) {
      return { user: bound, created: false }
    }
  }

  // 2) 邮箱命中已有账号：自动绑定后登录
  if (email) {
    const existing = await first(env, 'SELECT * FROM users WHERE email = ?', [email])
    if (existing) {
      await linkOAuthAccount(env, provider, providerUserId, existing.uid, email, displayName, avatar)
      return { user: existing, created: false }
    }
  }

  // 3) 新账号
  if (!provider.autoRegister) {
    throw new OAuthFlowError('该第三方账号尚未注册，请先使用邮箱注册或联系管理员')
  }
  if (!email) {
    throw new OAuthFlowError('未获取到邮箱，无法自动创建账号，请在服务商处开放邮箱权限')
  }

  const now = nowIso()
  const userCount = await queryCount(env, 'SELECT COUNT(*) AS count FROM users', [])
  const uid = randomId('u')
  const username = await buildUniqueUsername(env, buildUsernameCandidates(provider, profile, email, providerUserId))
  const passwordHash = await hashPassword(randomId('oauth-')) // 随机口令，使该账号无法用密码登录
  const avatarHash = await sha256Hex(email)
  const secretKey = randomId('')
  const role = userCount === 0 ? 'ADMIN' : 'USER'
  // 用户名默认不公开（校园网里往往就是学号），把服务商返回的真实姓名放进昵称作为显示名
  const nickname = displayName ? displayName.slice(0, 24) : null

  await run(env, `
    INSERT INTO users (
      uid, created_at, updated_at, username, password_hash, email, avatar_url, head_img, nickname,
      point, post_count, comment_count, role, level, status, secret_key
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 100, 0, 0, ?, 1, 'NORMAL', ?)
  `, [uid, now, now, username, passwordHash, email, avatarHash, avatar || null, nickname, role, secretKey])

  await linkOAuthAccount(env, provider, providerUserId, uid, email, displayName, avatar)

  const created = await first(env, 'SELECT * FROM users WHERE uid = ?', [uid])
  return { user: created, created: true }
}

async function linkOAuthAccount(
  env: Env,
  provider: OAuthProviderConfig,
  providerUserId: string,
  uid: string,
  email: string,
  username: string,
  avatar: string,
) {
  const now = nowIso()
  await run(env, `
    INSERT INTO oauth_accounts (
      created_at, updated_at, provider, provider_user_id, uid, email, username, avatar_url
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider, provider_user_id) DO UPDATE SET
      uid = excluded.uid,
      email = excluded.email,
      username = excluded.username,
      avatar_url = excluded.avatar_url,
      updated_at = excluded.updated_at
  `, [now, now, provider.key, providerUserId, uid, email || null, username || null, avatar || null])
}

/** 昵称字段取不到时，依次尝试这些常见用户名 claim（点号路径） */
const USERNAME_CLAIM_FALLBACKS = ['preferred_username', 'username', 'login', 'nickname', 'global_name', 'given_name', 'common_name']

/**
 * 生成用户名候选，按优先级排序：
 * 配置的昵称字段 → 常见用户名 claim → 邮箱前缀 → 服务商标识_第三方ID。
 * 注意：绝不使用服务商「显示名称」（会得到 Cloudflare_Zero_Trus 这种垃圾用户名）。
 */
function buildUsernameCandidates(
  provider: OAuthProviderConfig,
  profile: Record<string, any>,
  email: string,
  providerUserId: string,
) {
  const candidates: string[] = []
  const push = (value: any) => {
    const text = String(value ?? '').trim()
    if (text && !candidates.includes(text)) {
      candidates.push(text)
    }
  }

  push(getFieldValue(profile, provider.nameField))
  for (const claim of USERNAME_CLAIM_FALLBACKS) {
    if (claim !== provider.nameField) {
      push(getFieldValue(profile, claim))
    }
  }
  if (email.includes('@')) {
    push(email.split('@')[0])
  }
  push(`${provider.key}_${providerUserId}`)

  return candidates
}

function sanitizeUsername(raw: string) {
  const cleaned = String(raw || '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^\p{L}\p{N}_.-]/gu, '')
  return cleaned.slice(0, 24)
}

async function buildUniqueUsername(env: Env, candidates: string[]) {
  const bases = candidates
    .map(sanitizeUsername)
    .filter(name => name.length >= 3)

  if (bases.length === 0) {
    bases.push(`user${randomId('').slice(0, 6)}`)
  }

  for (const base of bases) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const name = attempt === 0 ? base : `${base}${attempt}`
      const exists = await queryCount(env, 'SELECT COUNT(*) AS count FROM users WHERE username = ?', [name])
      if (exists === 0) {
        return name
      }
    }
  }

  return `user${Date.now().toString(36)}`
}
