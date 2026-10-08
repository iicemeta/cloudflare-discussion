<script lang="ts" setup>
import { toast } from 'vue-sonner'
import type { OAuth2ConfigDTO, OAuthProviderDTO, OAuthProviderType } from '~/types'

useHead({
  title: '系统设置',
})
definePageMeta({
  layout: 'backend',
})

const OAUTH_PROVIDER_TYPES: OAuthProviderType[] = ['github', 'google', 'gitee', 'generic']

const oauthTypeOptions = [
  { value: 'github', label: 'GitHub' },
  { value: 'google', label: 'Google' },
  { value: 'gitee', label: 'Gitee' },
  { value: 'generic', label: '自定义 OAuth2' },
]

/** 与服务端 worker/src/oauth.ts 的预设保持一致，用于新增服务商时自动填充 */
const oauthProviderPresets: Record<OAuthProviderType, Omit<OAuthProviderDTO, 'key' | 'type' | 'enabled' | 'clientId' | 'clientSecret' | 'autoRegister'>> = {
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
  generic: {
    name: '自定义登录',
    authorizeUrl: '',
    tokenUrl: '',
    userInfoUrl: '',
    scope: '',
    idField: 'id',
    emailField: 'email',
    nameField: 'name',
    avatarField: 'avatar_url',
  },
}

function sanitizeProviderKey(key: string, fallback: string) {
  const cleaned = String(key || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '')
  return cleaned || fallback
}

function defaultProviderKey(type: OAuthProviderType) {
  return type === 'generic' ? 'oauth' : type
}

function createOAuthProvider(type: OAuthProviderType = 'github', index = 0): OAuthProviderDTO {
  const preset = oauthProviderPresets[type] ?? oauthProviderPresets.generic
  const baseKey = defaultProviderKey(type)
  return {
    key: index === 0 ? baseKey : `${baseKey}${index + 1}`,
    type,
    enabled: false,
    clientId: '',
    clientSecret: '',
    autoRegister: true,
    ...preset,
  }
}

function normalizeProviderList(raw: any): OAuthProviderDTO[] {
  if (!Array.isArray(raw)) {
    return []
  }
  return raw.map((item, index) => {
    const source = item && typeof item === 'object' ? item : {}
    const type: OAuthProviderType = OAUTH_PROVIDER_TYPES.includes(source.type) ? source.type : 'generic'
    const base = createOAuthProvider(type, index)
    return {
      ...base,
      ...source,
      type,
      key: sanitizeProviderKey(source.key, base.key),
      autoRegister: source.autoRegister === undefined ? true : Boolean(source.autoRegister),
    }
  })
}

function addOAuthProvider(type: OAuthProviderType) {
  state.oauth2.providers.push(createOAuthProvider(type, state.oauth2.providers.length))
}

function removeOAuthProvider(index: number) {
  state.oauth2.providers.splice(index, 1)
}

function applyOAuthTypeChange(provider: OAuthProviderDTO) {
  const preset = oauthProviderPresets[provider.type] ?? oauthProviderPresets.generic
  const previousNames = Object.values(oauthProviderPresets).map(item => item.name)
  provider.authorizeUrl = preset.authorizeUrl
  provider.tokenUrl = preset.tokenUrl
  provider.userInfoUrl = preset.userInfoUrl
  provider.scope = preset.scope
  provider.idField = preset.idField
  provider.emailField = preset.emailField
  provider.nameField = preset.nameField
  provider.avatarField = preset.avatarField
  if (!provider.name || previousNames.includes(provider.name)) {
    provider.name = preset.name
  }
}

const currentOrigin = ref('')

onMounted(() => {
  if (import.meta.client) {
    currentOrigin.value = window.location.origin
  }
})

/** 回调地址优先取管理员当前访问的域名（地址栏 origin），取不到再退回「论坛地址」配置 */
/** Cloudflare Access 端点由「团队名 + Client ID」完全决定，这里做本地拼装（纯 UI 草稿，不落库） */
const cfAccessDraft = reactive<Record<string, string>>({})

function fillCloudflareAccess(provider: OAuthProviderDTO) {
  const raw = String(cfAccessDraft[provider.key] || '').trim()
  if (!raw) {
    toast.error('请粘贴 Cloudflare Access 的端点地址，或直接填写团队名')
    return
  }

  let team = ''
  let clientId = ''

  const teamMatch = raw.match(/([a-z0-9-]+)\.cloudflareaccess\.com/i)
  if (teamMatch) {
    team = teamMatch[1].toLowerCase()
  }
  const clientMatch = raw.match(/\/sso\/oidc\/([A-Za-z0-9_-]+)/)
  if (clientMatch) {
    clientId = clientMatch[1]
  }

  // 只填了团队名
  if (!team && /^[a-z0-9-]+$/i.test(raw)) {
    team = raw.toLowerCase()
  }
  // 只粘了 Client ID
  if (!clientId && /^[A-Za-z0-9_-]{16,}$/.test(raw)) {
    clientId = raw
  }
  if (!clientId) {
    clientId = String(provider.clientId || '').trim()
  }

  if (!team) {
    toast.error('识别不出团队名，请粘贴完整端点地址，或直接填写团队名（如 iicemeta）')
    return
  }
  if (!clientId) {
    toast.error('缺少 Client ID，请先填写 Client ID，或粘贴带 Client ID 的端点地址')
    return
  }

  const base = `https://${team}.cloudflareaccess.com/cdn-cgi/access/sso/oidc/${clientId}`
  provider.clientId = clientId
  provider.authorizeUrl = `${base}/authorization`
  provider.tokenUrl = `${base}/token`
  provider.userInfoUrl = `${base}/userinfo`
  provider.scope = 'openid email profile'
  provider.idField = 'sub'
  provider.emailField = 'email'
  if (!provider.nameField) {
    provider.nameField = 'name'
  }
  if (!provider.name || provider.name === oauthProviderPresets.generic.name) {
    provider.name = 'Cloudflare Access'
  }

  toast.success(`已填充 Cloudflare Access 端点（团队：${team}）`)
}

const oauthCallbackBase = computed(() => currentOrigin.value || normalizeWebsiteUrl(state.websiteUrl) || 'https://你的域名')

function oauthCallbackUrl(provider: OAuthProviderDTO) {
  return `${oauthCallbackBase.value}/api/oauth/callback?provider=${provider.key || 'provider'}`
}

function copyOAuthCallbackUrl(provider: OAuthProviderDTO) {
  copy(oauthCallbackUrl(provider))
  toast.success('已复制回调地址')
}

function createDefaultState() {
  return {
    websiteName: '极简论坛',
    websiteUrl: '',
    webBgimage: '',
    websiteKeywords: '极简,论坛,极简论坛',
    websiteDescription: '极简论坛',
    favicon: '',
    pointPerPost: 5,
    pointPerPostByDay: 20,
    pointPerComment: 1,
    pointPerCommentByDay: 20,
    pointPerLikeOrDislike: 1,
    pointPerDaySignInMin: 1,
    pointPerDaySignInMax: 10,
    websiteAnnouncement: ``,
    css: '',
    js: '',
    postUrlFormat: {
      type: 'UUID',
      minNumber: 10000,
      dateFormat: 'YYYYMMDDHHmmssSSS',
    },
    invite: false,
    createInviteCodePoint: 100,
    regWithEmailCodeVerify: false,
    email: {
      apiKey: '',
      from: '',
      to: '',
      senderName: '',
    },
    turnstile: {
      siteKey: '',
      secretKey: '',
      enable: false,
    },
    notify: {
      tgBotEnabled: false,
      tgBotToken: '',
      tgBotName: '',
      tgSecret: '',
    },
    oauth2: {
      providers: [] as OAuthProviderDTO[],
    } as OAuth2ConfigDTO,
    upload: {
      imgStrategy: 'r2',
      attachmentStrategy: 'r2',
    },
  }
}

const state = reactive(createDefaultState())

function applyConfig(config: Record<string, any> | null | undefined) {
  const defaults = createDefaultState()
  Object.assign(state, defaults, config ?? {})
  state.postUrlFormat = {
    ...defaults.postUrlFormat,
    ...(config?.postUrlFormat ?? {}),
  }
  state.email = {
    ...defaults.email,
    ...(config?.email ?? {}),
  }
  state.turnstile = {
    ...defaults.turnstile,
    ...(config?.turnstile ?? {}),
  }
  state.notify = {
    ...defaults.notify,
    ...(config?.notify ?? {}),
  }
  state.oauth2 = {
    providers: normalizeProviderList(config?.oauth2?.providers),
  }
  state.upload = {
    ...defaults.upload,
    ...(config?.upload ?? {}),
  }
}

type ConfigStatus = 'idle' | 'pending' | 'success' | 'error'

const configStatus = ref<ConfigStatus>('pending')
const configError = ref<Error | null>(null)
const hasLoadedConfig = ref(false)
const isInitialLoading = computed(() => configStatus.value === 'pending' && !hasLoadedConfig.value)
const shouldShowSettings = computed(() => hasLoadedConfig.value && !isInitialLoading.value)
let configRequestId = 0

async function refreshConfig() {
  const requestId = ++configRequestId
  configStatus.value = 'pending'
  configError.value = null

  try {
    const res = await $fetch<{
      success: boolean
      config?: Record<string, any> | null
      message?: string
    }>('/api/manage/config/get', {
      method: 'POST',
      timeout: 10000,
    })
    if (requestId !== configRequestId) {
      return
    }
    if (!res.success || !res.config) {
      throw new Error(res.message || '系统设置加载失败')
    }
    applyConfig(res.config)
    hasLoadedConfig.value = true
    configStatus.value = 'success'
  }
  catch (error) {
    if (requestId !== configRequestId) {
      return
    }
    configError.value = new Error(getApiErrorMessage(error, '系统设置加载失败'))
    configStatus.value = 'error'
    console.error('加载系统设置失败', error)
  }
}

onMounted(refreshConfig)

function randomString(e: number) {
  e = e || 32
  const t = 'ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678'
  const a = t.length
  let n = ''
  for (let i = 0; i < e; i++) n += t.charAt(Math.floor(Math.random() * a))
  return n
}

function normalizeWebsiteUrl(url: string) {
  return url.trim().replace(/\/+$/, '')
}

function ensureTelegramSecret() {
  if (state.notify.tgBotEnabled && !state.notify.tgSecret) {
    state.notify.tgSecret = randomString(32)
  }
}

function normalizeOAuthProviders() {
  const usedKeys = new Set<string>()
  state.oauth2.providers.forEach((provider, index) => {
    let key = sanitizeProviderKey(provider.key, `provider${index + 1}`)
    while (usedKeys.has(key)) {
      key = `${key}_${index + 1}`
    }
    usedKeys.add(key)
    provider.key = key
  })
}

function validateOAuthProviders() {
  normalizeOAuthProviders()
  for (const provider of state.oauth2.providers) {
    if (!provider.enabled) {
      continue
    }
    const label = provider.name || provider.key
    if (!provider.clientId || !provider.clientSecret) {
      toast.error(`OAuth2「${label}」需要填写 Client ID 和 Client Secret`)
      return false
    }
    if (!provider.authorizeUrl || !provider.tokenUrl || !provider.userInfoUrl) {
      toast.error(`OAuth2「${label}」需要填写授权、令牌与用户信息地址`)
      return false
    }
  }
  return true
}

async function persistSettings(options: { reload?: boolean, successMessage?: string } = {}) {
  const { reload = true, successMessage = '保存成功' } = options
  if (state.turnstile.enable && (!state.turnstile.siteKey || !state.turnstile.secretKey)) {
    toast.error('启用了 Turnstile，请填写 Site Key 和 Secret Key')
    return false
  }

  if (state.regWithEmailCodeVerify && (!state.email.apiKey || !state.email.from)) {
    toast.error('启用了邮件验证码，请填写 Resend API Key 和发件邮箱')
    return false
  }

  if (!validateOAuthProviders()) {
    return false
  }

  ensureTelegramSecret()
  state.websiteUrl = normalizeWebsiteUrl(state.websiteUrl)
  state.upload = {
    imgStrategy: 'r2',
    attachmentStrategy: 'r2',
  }

  try {
    assertApiSuccess(await $fetch('/api/manage/config/save', {
      method: 'POST',
      body: state,
    }), '保存系统设置失败')
  }
  catch (error) {
    toast.error(getApiErrorMessage(error, '保存系统设置失败'))
    return false
  }

  if (successMessage) {
    toast.success(successMessage)
  }
  if (reload) {
    window.location.reload()
  }
  return true
}

async function saveSettings() {
  await persistSettings()
}

const postUrlFormatOptions = [{ value: 'UUID', label: 'UUID' }, { value: 'Number', label: '数字' }, { value: 'Date', label: '日期' }]

const items = [{
  label: '邮件设置',
  icon: 'i-carbon-email',
  defaultOpen: false,
  slot: 'email-settings',
}, {
  label: '外观设置',
  icon: 'i-carbon-machine-learning',
  defaultOpen: false,
  slot: 'appearance-settings',
}, {
  label: 'Turnstile',
  icon: 'i-carbon-security',
  defaultOpen: false,
  slot: 'turnstile-settings',
}, {
  label: '通知设置',
  icon: 'i-carbon-chat',
  defaultOpen: false,
  slot: 'notify-settings',
}, {
  label: 'OAuth2 登录',
  icon: 'i-carbon-login',
  defaultOpen: false,
  slot: 'oauth-settings',
}]

const emailSending = ref(false)

async function testEmail() {
  emailSending.value = true
  try {
    const saved = await persistSettings({ reload: false, successMessage: '' })
    if (!saved) {
      return
    }
    assertApiSuccess(await $fetch('/api/manage/testEmail', {
      method: 'POST',
    }), '测试邮件发送失败')
    toast.success('配置已保存，测试邮件发送成功')
  }
  catch (error) {
    toast.error(getApiErrorMessage(error, '测试邮件发送失败'))
  }
  finally {
    emailSending.value = false
  }
}

const { copy } = useCopyToClipboard()

async function copyWebhook() {
  if (!state.notify.tgBotEnabled) {
    toast.error('请先启用 Telegram 机器人')
    return
  }
  if (!state.notify.tgBotToken) {
    toast.error('请先填写 Bot Token')
    return
  }

  state.websiteUrl = normalizeWebsiteUrl(state.websiteUrl)
  if (!state.websiteUrl) {
    toast.error('请先填写论坛地址')
    return
  }

  let websiteUrl: URL
  try {
    websiteUrl = new URL(state.websiteUrl)
  }
  catch {
    toast.error('论坛地址必须是完整的 URL')
    return
  }

  if (websiteUrl.protocol !== 'https:') {
    toast.error('Telegram Webhook 需要 https 地址')
    return
  }

  const saved = await persistSettings({ reload: false, successMessage: '' })
  if (!saved) {
    return
  }

  const webhookUrl = new URL('/api/tg', `${websiteUrl.toString().replace(/\/+$/, '')}/`)
  const apiUrl = new URL(`https://api.telegram.org/bot${state.notify.tgBotToken}/setwebhook`)
  apiUrl.searchParams.set('secret_token', state.notify.tgSecret)
  apiUrl.searchParams.set('url', webhookUrl.toString())
  copy(apiUrl.toString())
  toast.success('已保存配置并复制 WebHook 地址')
}
</script>

<template>
  <UCard class="flex-1">
    <div v-if="isInitialLoading" class="space-y-3">
      <div class="text-sm text-gray-500">
        正在加载系统设置...
      </div>
      <div class="space-y-2">
        <div class="h-10 rounded bg-gray-100 dark:bg-slate-700 animate-pulse" />
        <div class="h-10 rounded bg-gray-100 dark:bg-slate-700 animate-pulse" />
        <div class="h-[200px] rounded bg-gray-100 dark:bg-slate-700 animate-pulse" />
      </div>
    </div>

    <div v-else-if="configError && !hasLoadedConfig" class="space-y-3">
      <div class="text-sm text-red-500">
        系统设置加载失败：{{ configError.message || '请稍后重试' }}
      </div>
      <UButton class="w-fit" @click="refreshConfig">
        重新加载
      </UButton>
    </div>

    <div v-else-if="shouldShowSettings" class="flex flex-col space-y-2">
      <div
        v-if="configStatus === 'pending' || configError"
        :class="[
          'flex items-center justify-between gap-3 rounded px-3 py-2 text-sm',
          configError
            ? 'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300'
            : 'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300',
        ]"
      >
        <span>
          {{ configError ? `系统设置刷新失败：${configError.message || '请稍后重试'}` : '正在刷新系统设置...' }}
        </span>
        <UButton v-if="configError" size="xs" color="white" @click="refreshConfig">
          重试
        </UButton>
      </div>

      <div class="flex flex-row space-x-2">
        <UFormGroup label="论坛名称" name="websiteName">
          <UInput v-model="state.websiteName" autocomplete="off" />
        </UFormGroup>
        <UFormGroup label="论坛地址" name="websiteUrl">
          <UInput v-model="state.websiteUrl" autocomplete="off" />
        </UFormGroup>
      </div>
      <div class="flex flex-row space-x-2">
        <UFormGroup label="论坛背景图" name="webBgimage">
          <UInput v-model="state.webBgimage" autocomplete="off" />
        </UFormGroup>
        <UFormGroup label="论坛关键词" name="websiteKeywords">
          <UInput v-model="state.websiteKeywords" autocomplete="off" />
        </UFormGroup>
      </div>
      <div class="flex flex-row space-x-2">
        <UFormGroup label="论坛描述" name="websiteDescription">
          <UInput v-model="state.websiteDescription" autocomplete="off" />
        </UFormGroup>
        <UFormGroup label="favicon" name="favicon">
          <UInput v-model="state.favicon" autocomplete="off" />
        </UFormGroup>
      </div>
      <div class="flex flex-row space-x-2">
        <UFormGroup label="站点公告" name="websiteAnnouncement">
          <UTextarea v-model="state.websiteAnnouncement" :rows="8" />
        </UFormGroup>
      </div>

      <div class="flex flex-row space-x-2">
        <UFormGroup label="帖子链接格式定义" name="type" class="w-[225px]">
          <USelectMenu
            v-model="state.postUrlFormat.type" :options="postUrlFormatOptions" value-attribute="value"
            option-attribute="label"
          />
        </UFormGroup>
        <UFormGroup v-if="state.postUrlFormat.type === 'Number'" label="起始数字" name="minNumber">
          <UInput v-model="state.postUrlFormat.minNumber" />
        </UFormGroup>
        <UFormGroup v-if="state.postUrlFormat.type === 'Date'" label="日期格式" name="dateFormat">
          <template #hint>
            <ULink class="text-green-600 underline" to="https://day.js.org/docs/zh-CN/display/format" target="_blank">
              支持的格式
            </ULink>
          </template>
          <UInput v-model="state.postUrlFormat.dateFormat" />
        </UFormGroup>
      </div>

      <div class="flex flex-row space-x-2">
        <UFormGroup label="每次发帖获得积分" name="pointPerPost">
          <UInput v-model.number="state.pointPerPost" autocomplete="off" />
        </UFormGroup>
        <UFormGroup label="每天发帖获得积分上限" name="pointPerPostByDay">
          <UInput v-model.number="state.pointPerPostByDay" autocomplete="off" />
        </UFormGroup>
      </div>

      <div class="flex flex-row space-x-2">
        <UFormGroup label="每次回复获得积分" name="pointPerComment">
          <UInput v-model.number="state.pointPerComment" autocomplete="off" />
        </UFormGroup>
        <UFormGroup label="每天回复获得积分上限" name="pointPerCommentByDay">
          <UInput v-model.number="state.pointPerCommentByDay" autocomplete="off" />
        </UFormGroup>
      </div>

      <div class="flex flex-row space-x-2">
        <UFormGroup label="每次点赞/点踩扣减积分" name="pointPerLikeOrDislike">
          <UInput v-model.number="state.pointPerLikeOrDislike" autocomplete="off" />
        </UFormGroup>
      </div>
      <div class="flex flex-row space-x-2">
        <UFormGroup label="每天签到送积分(最小)" name="pointPerDaySignInMin">
          <UInput v-model.number="state.pointPerDaySignInMin" autocomplete="off" />
        </UFormGroup>
        <UFormGroup label="每天签到送积分(最大)" name="pointPerDaySignInMax">
          <UInput v-model.number="state.pointPerDaySignInMax" autocomplete="off" />
        </UFormGroup>
      </div>
      <div class="flex flex-row space-x-2">
        <UFormGroup label="是否启用邀请注册" name="pointPerDaySignInMin">
          <UToggle v-model="state.invite" />
        </UFormGroup>
      </div>

      <div class="flex flex-row space-x-2">
        <UFormGroup label="每次生成邀请码需要积分" name="createInviteCodePoint">
          <UInput v-model.number="state.createInviteCodePoint" autocomplete="off" />
        </UFormGroup>
      </div>
      <UAccordion :items="items" :ui="{ container: 'max-w-[500px]' }">
        <template #email-settings>
          <div class="flex flex-col space-y-2 ">
            <UFormGroup label="开启邮件验证注册用户" name="regWithEmailCodeVerify">
              <div class="flex items-center gap-3">
                <UToggle v-model="state.regWithEmailCodeVerify" />
                <span class="text-sm text-gray-500">{{ state.regWithEmailCodeVerify ? '是' : '否' }}</span>
              </div>
            </UFormGroup>
            <UFormGroup label="Resend API Key" name="apiKey">
              <template #hint>
                需要在 Resend 后台创建 API Key
              </template>
              <UInput v-model="state.email.apiKey" type="password" autocomplete="off" />
            </UFormGroup>
            <UFormGroup label="发件邮箱" name="from">
              <template #hint>
                这里填写 Resend 已验证域名下的邮箱地址
              </template>
              <UInput v-model="state.email.from" autocomplete="off" />
            </UFormGroup>
            <UFormGroup label="发件人名称" name="senderName">
              <UInput v-model="state.email.senderName" autocomplete="off" />
            </UFormGroup>
            <UButtonGroup size="sm" orientation="horizontal" class="my-2">
              <UInput v-model="state.email.to" placeholder="测试邮件接收地址" />
              <UButton class="w-fit " size="xs" :loading="emailSending" @click="testEmail">
                保存并测试邮件
              </UButton>
            </UButtonGroup>
          </div>
        </template>

        <template #appearance-settings>
          <div class="flex flex-col space-y-2 ">
            <div class="flex flex-row space-x-2">
              <UFormGroup label="自定义css" name="css" class="w-[500px]">
                <UTextarea v-model="state.css" :rows="10" />
              </UFormGroup>
            </div>

            <div class="flex flex-row space-x-2">
              <UFormGroup label="自定义JS" name="css" class="w-[500px]">
                <UTextarea v-model="state.js" :rows="10" />
              </UFormGroup>
            </div>
          </div>
        </template>

        <template #turnstile-settings>
          <div class="flex flex-col space-y-2 ">
            <div class="flex flex-row space-x-2">
              <UFormGroup label="是否启用" name="turnstileEnabled" class="w-[500px]">
                <div class="flex items-center gap-3">
                  <UToggle v-model="state.turnstile.enable" />
                  <span class="text-sm text-gray-500">{{ state.turnstile.enable ? '是' : '否' }}</span>
                </div>
              </UFormGroup>
            </div>

            <div class="flex flex-row space-x-2">
              <UFormGroup label="Site Key" name="css" class="w-[500px]">
                <UInput v-model="state.turnstile.siteKey" autocomplete="off" />
              </UFormGroup>
              <UFormGroup label="Secret Key" name="css" class="w-[500px]">
                <UInput v-model="state.turnstile.secretKey" autocomplete="off" />
              </UFormGroup>
            </div>
          </div>
        </template>

        <template #notify-settings>
          <div class="flex flex-col space-y-2 ">
            <div class="flex flex-row space-x-2">
              <UFormGroup label="是否启用Telegram机器人" name="tgBotEnabled" class="w-[500px]">
                <div class="flex items-center gap-3">
                  <UToggle v-model="state.notify.tgBotEnabled" />
                  <span class="text-sm text-gray-500">{{ state.notify.tgBotEnabled ? '是' : '否' }}</span>
                  <UButton @click="copyWebhook">
                    复制WebHook地址
                  </UButton>
                </div>
              </UFormGroup>
            </div>

            <div class="flex flex-row space-x-2">
              <UFormGroup label="Bot Token" name="tgBotToken" class="w-[500px]">
                <UInput v-model="state.notify.tgBotToken" autocomplete="off" />
              </UFormGroup>
              <UFormGroup label="Bot Name" name="tgBotName" class="w-[500px]" hint="显示在消息页面">
                <UInput v-model="state.notify.tgBotName" autocomplete="off" />
              </UFormGroup>
            </div>
          </div>
        </template>

        <template #oauth-settings>
          <div class="flex flex-col space-y-3">
            <p class="text-sm text-gray-500">
              配置后登录页会出现对应的第三方登录按钮。已存在的邮箱账号会在首次第三方登录时自动绑定，不会重复创建用户。
            </p>

            <div v-if="!state.oauth2.providers.length" class="text-sm text-gray-400">
              还没有配置任何第三方登录方式，点击下方按钮添加。
            </div>

            <div
              v-for="(provider, index) in state.oauth2.providers"
              :key="`${provider.key}-${index}`"
              class="rounded border border-gray-200 dark:border-slate-700 p-3 space-y-3"
            >
              <div class="flex flex-wrap items-end gap-3">
                <UFormGroup label="启用" class="w-[80px]">
                  <UToggle v-model="provider.enabled" />
                </UFormGroup>
                <UFormGroup label="类型" class="w-[170px]">
                  <USelectMenu
                    v-model="provider.type"
                    :options="oauthTypeOptions"
                    value-attribute="value"
                    option-attribute="label"
                    @change="applyOAuthTypeChange(provider)"
                  />
                </UFormGroup>
                <UFormGroup label="标识" class="w-[170px]" hint="小写字母/数字/-/_">
                  <UInput v-model="provider.key" autocomplete="off" />
                </UFormGroup>
                <UFormGroup label="显示名称" class="w-[170px]">
                  <UInput v-model="provider.name" autocomplete="off" />
                </UFormGroup>
                <UButton class="mb-1" color="red" variant="soft" size="xs" @click="removeOAuthProvider(index)">
                  删除
                </UButton>
              </div>

              <div class="flex flex-row space-x-2">
                <UFormGroup label="Client ID" class="w-[320px]">
                  <UInput v-model="provider.clientId" autocomplete="off" />
                </UFormGroup>
                <UFormGroup label="Client Secret" class="w-[320px]">
                  <UInput v-model="provider.clientSecret" type="password" autocomplete="off" />
                </UFormGroup>
              </div>

              <div
                v-if="provider.type === 'generic'"
                class="flex flex-wrap items-end gap-2 rounded bg-gray-50 dark:bg-slate-800/60 p-2"
              >
                <UFormGroup
                  label="Cloudflare Access 快速填充"
                  class="min-w-[380px] flex-1"
                  hint="粘贴 CF 后台任意一条端点地址（含 Client ID），或只填团队名"
                >
                  <UInput
                    v-model="cfAccessDraft[provider.key]"
                    placeholder="https://<团队名>.cloudflareaccess.com/cdn-cgi/access/sso/oidc/<Client ID>/authorization"
                    autocomplete="off"
                  />
                </UFormGroup>
                <UButton class="mb-1" size="xs" color="primary" variant="soft" @click="fillCloudflareAccess(provider)">
                  自动填充端点
                </UButton>
              </div>

              <div class="flex flex-row space-x-2">
                <UFormGroup label="授权地址 (Authorize URL)" class="w-[320px]">
                  <UInput v-model="provider.authorizeUrl" autocomplete="off" />
                </UFormGroup>
                <UFormGroup label="令牌地址 (Token URL)" class="w-[320px]">
                  <UInput v-model="provider.tokenUrl" autocomplete="off" />
                </UFormGroup>
              </div>

              <div class="flex flex-row space-x-2">
                <UFormGroup label="用户信息地址 (UserInfo URL)" class="w-[320px]">
                  <UInput v-model="provider.userInfoUrl" autocomplete="off" />
                </UFormGroup>
                <UFormGroup label="Scope" class="w-[320px]" hint="多个用空格分隔">
                  <UInput v-model="provider.scope" autocomplete="off" />
                </UFormGroup>
              </div>

              <div class="flex flex-row space-x-2">
                <UFormGroup label="用户 ID 字段" class="w-[150px]">
                  <UInput v-model="provider.idField" autocomplete="off" />
                </UFormGroup>
                <UFormGroup label="邮箱字段" class="w-[150px]">
                  <UInput v-model="provider.emailField" autocomplete="off" />
                </UFormGroup>
                <UFormGroup label="昵称字段" class="w-[150px]">
                  <UInput v-model="provider.nameField" autocomplete="off" />
                </UFormGroup>
                <UFormGroup label="头像字段" class="w-[150px]">
                  <UInput v-model="provider.avatarField" autocomplete="off" />
                </UFormGroup>
              </div>

              <div class="flex flex-wrap items-end gap-3">
                <UFormGroup label="首次登录自动注册" class="w-[170px]">
                  <div class="flex items-center gap-3">
                    <UToggle v-model="provider.autoRegister" />
                    <span class="text-sm text-gray-500">{{ provider.autoRegister ? '是' : '否' }}</span>
                  </div>
                </UFormGroup>
                <UFormGroup label="回调地址（填到服务商后台）" class="min-w-[380px] flex-1">
                  <div class="flex items-center gap-2">
                    <UInput :model-value="oauthCallbackUrl(provider)" readonly class="flex-1" autocomplete="off" />
                    <UButton size="xs" color="gray" variant="soft" @click="copyOAuthCallbackUrl(provider)">
                      复制
                    </UButton>
                  </div>
                </UFormGroup>
              </div>
              <p class="text-xs text-gray-400">
                回调地址按你当前访问后台的域名「{{ oauthCallbackBase }}」生成，请用站点的正式域名打开后台后再复制。
              </p>
            </div>

            <UButtonGroup size="sm" orientation="horizontal" class="w-fit">
              <UButton color="gray" variant="soft" @click="addOAuthProvider('github')">
                + GitHub
              </UButton>
              <UButton color="gray" variant="soft" @click="addOAuthProvider('google')">
                + Google
              </UButton>
              <UButton color="gray" variant="soft" @click="addOAuthProvider('gitee')">
                + Gitee
              </UButton>
              <UButton color="gray" variant="soft" @click="addOAuthProvider('generic')">
                + 自定义
              </UButton>
            </UButtonGroup>
          </div>
        </template>
      </UAccordion>

      <UButton class="w-fit" @click="saveSettings">
        保存
      </UButton>
    </div>
  </UCard>
</template>

<style scoped></style>
