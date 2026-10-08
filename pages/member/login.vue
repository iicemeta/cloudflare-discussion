<script lang="ts" setup>
import { toast } from 'vue-sonner'
import type { z } from 'zod'
import type { FormSubmitEvent } from '#ui/types'
import { type SysConfigDTO, loginRequestSchema } from '~/types'
import type { PublicOAuthProviderDTO } from '~/types'

useHead({
  title: `登录`,
})

type Schema = z.output<typeof loginRequestSchema>

const state = reactive<Schema>({
  password: '',
  username: '',
})
const pending = ref(false)
const route = useRoute()
const global = useGlobalConfig()
const sysconfig = global.value?.sysConfig as SysConfigDTO
const turnstileRef = ref<{ execute: () => Promise<string> } | null>(null)

const oauthProviders = computed(() => (global.value?.sysConfig?.oauth2?.providers ?? []) as PublicOAuthProviderDTO[])

function oauthProviderIcon(type: string) {
  if (type === 'github')
    return 'i-carbon-logo-github'
  if (type === 'google')
    return 'i-carbon-logo-google'
  if (type === 'gitee')
    return 'i-carbon-user-avatar'
  return 'i-carbon-login'
}

function safeRedirectTarget() {
  const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
  return redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/'
}

function oauthLogin(provider: PublicOAuthProviderDTO) {
  const params = new URLSearchParams({
    provider: provider.key,
    redirect: safeRedirectTarget(),
  })
  location.href = `/api/oauth/start?${params.toString()}`
}

onMounted(() => {
  const oauthError = typeof route.query.oauth_error === 'string' ? route.query.oauth_error : ''
  if (!oauthError) {
    return
  }
  toast.error(`第三方登录失败：${oauthError}`)
  const query = { ...route.query }
  delete query.oauth_error
  navigateTo({ path: route.path, query }, { replace: true })
})

async function onSubmit(event: FormSubmitEvent<Schema>) {
  pending.value = true
  try {
    const token = sysconfig.turnstile?.enable ? await turnstileRef.value?.execute() || '' : ''
    await login(event.data, token)
  }
  catch (error) {
    toast.error(error instanceof Error ? error.message : '人机验证失败')
  }
  finally {
    pending.value = false
  }
}

async function login(data: Schema, token: string = '') {
  const result = await $fetch<{
    success: boolean
    tokenKey?: string
    message?: string
  }>('/api/member/login', {
    method: 'POST',
    body: { ...data, token },
  })
  if (result.success && result.tokenKey) {
    toast.success(`登录成功,自动跳转中...`)
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
    location.href = redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/'
  }
  else if (result.message) {
    toast.error(`登录失败,${result.message}`)
  }
}
</script>

<template>
  <UCard class="w-full mt-2">
    <template #header>
      <div class="text-center text-sm">
        登录
      </div>
    </template>
    <div class="flex flex-col my-2 lg:w-[300px] mx-auto">
      <UForm
        :schema="loginRequestSchema" :state="state" :validate-on="['submit']" class="space-y-4" autocomplete="off"
        @submit="onSubmit"
      >
        <UFormGroup label="用户名" name="username">
          <UInput v-model="state.username" autocomplete="off" />
        </UFormGroup>
        <UFormGroup label="密码" name="password">
          <UInput v-model="state.password" type="password" autocomplete="off" />
        </UFormGroup>
        <XTurnstile
          v-if="sysconfig.turnstile?.enable"
          ref="turnstileRef"
          :site-key="sysconfig.turnstile.siteKey"
          action="login"
        />
        <div class="flex gap-2 items-center">
          <UButton type="submit" :loading="pending" :disabled="pending">
            登录
          </UButton>
          <UButton color="gray" variant="solid" class="button" @click="navigateTo('/member/forgotPassword')">
            忘记密码了
          </UButton>

          <NuxtLink to="/member/reg" class="text-primary text-sm ml-2 underline underline-offset-4">
            没有账户?去注册
          </NuxtLink>
        </div>
      </UForm>

      <div v-if="oauthProviders.length" class="mt-4">
        <div class="flex items-center gap-2 my-3">
          <div class="h-px flex-1 bg-gray-200 dark:bg-slate-700" />
          <span class="text-xs text-gray-400">或使用第三方账号登录</span>
          <div class="h-px flex-1 bg-gray-200 dark:bg-slate-700" />
        </div>
        <div class="flex flex-col gap-2">
          <UButton
            v-for="provider in oauthProviders"
            :key="provider.key"
            block
            color="gray"
            variant="soft"
            :icon="oauthProviderIcon(provider.type)"
            @click="oauthLogin(provider)"
          >
            {{ provider.name }}
          </UButton>
        </div>
      </div>
    </div>
  </UCard>
</template>

<style scoped></style>
