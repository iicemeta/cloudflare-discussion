import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime.js'

import zhCn from 'dayjs/locale/zh-cn.js'
import { toast } from 'vue-sonner'
import type { SysConfigDTO } from '~/types'

dayjs.extend(relativeTime).locale(zhCn)

export function getAvatarUrl(hash: string, url: string | undefined | null) {
  if (url)
    return url
  const config = useRuntimeConfig()
  return `${config.public.avatarCdn}${hash}?d=identicon`
}

interface DisplayNameSource {
  nickname?: string | null
  username?: string | null
  usernameVisible?: boolean | null
  uid?: string | null
}

/**
 * 统一显示名：昵称 → （已公开时）用户名 → 「用户 + uid 后 4 位」。
 * 用户名默认不公开，所以拿不到 username 时不要回退到它。
 * 服务端 worker/src/auth.ts 的 displayNameOf 是同一套规则（用于消息正文）。
 */
export function displayNameOf(user: DisplayNameSource | null | undefined) {
  const nickname = String(user?.nickname || '').trim()
  if (nickname)
    return nickname
  if (user?.usernameVisible && user?.username)
    return String(user.username)
  const uid = String(user?.uid || '')
  return uid ? `用户${uid.slice(-4)}` : '匿名用户'
}

/** 个人主页地址一律用 uid，避免把用户名/学号暴露在 URL 里 */
export function profilePathOf(user: { uid?: string | null } | null | undefined, sub = '') {
  const uid = String(user?.uid || '')
  const base = `/member/${uid}`
  if (!sub)
    return base
  return `${base}/${String(sub).replace(/^\/+/, '')}`
}

export function dateFormat(date: Date | number | string, pattern: string = 'YYYY-MM-DD HH:mm:ss') {
  return dayjs(date).format(pattern)
}

export function dateFormatAgo(date: Date | number | string) {
  return dayjs(date).fromNow()
}

export function canUseInternalImageUpload(_sysconfig?: Partial<SysConfigDTO> | null) {
  return true
}

interface UploadImageResponse {
  success?: boolean
  filename?: string | null
  url?: string | null
  message?: string | null
}

function getUploadedImageUrl(result: UploadImageResponse) {
  const url = result.filename || result.url
  return typeof url === 'string' ? url.trim() : ''
}

export async function onUploadImg(files: File[], callback: any) {
  const global = useGlobalConfig()
  const sysconfig = global.value?.sysConfig as SysConfigDTO

  let upload = async () => {
    throw new Error('当前未配置 R2 图片上传，或注入自定义 uploadImg')
  }
  if ('uploadImg' in window) {
    // @ts-expect-error 自定义上传图片函数
    upload = window.uploadImg
  }

  if (canUseInternalImageUpload(sysconfig)) {
    upload = async () => {
      const res = await Promise.all(
        files.map(async (f) => {
          const form = new FormData()
          form.append('file', f)
          return (await $fetch('/api/imgs/upload', {
            method: 'POST',
            body: form,
          })) as UploadImageResponse
        }),
      )
      const failed = res.find(r => !r.success)
      if (failed) {
        throw new Error(failed.message || '上传失败')
      }

      const urls = res.map(getUploadedImageUrl).filter(url => url.length > 0)
      if (urls.length !== res.length) {
        throw new Error('上传成功但未返回图片地址')
      }

      callback(urls)
    }
  }

  toast.promise(upload, {
    loading: '上传中...请耐心等待..',
    success: () => {
      return '上传成功'
    },
    error: (error) => {
      return error instanceof Error ? error.message : '上传失败'
    },
  })
}

export const getLength = function (str: string) {
  /// <summary>获得字符串实际长度，中文2，英文1</summary>
  /// <param name="str">要获得长度的字符串</param>
  let realLength = 0
  const len = str.length
  let charCode = -1
  for (let i = 0; i < len; i++) {
    charCode = str.charCodeAt(i)
    if (charCode >= 0 && charCode <= 128)
      realLength += 1
    else realLength += 2
  }
  return realLength
}
