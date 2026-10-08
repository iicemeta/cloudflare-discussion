export const userCardChanged = useEventBus<void>('user-card-changed')

export interface CommentQuotedPayload {
  /** 被引用者的 uid（用于生成 /member/<uid> 链接，进而定位被提及的人） */
  uid: string
  /** 被引用者的显示名（昵称优先），只用于展示 */
  name: string
  pid: string
  floor: number
  content: string
  cid: string
}
export const commentQuoted = useEventBus<CommentQuotedPayload>('comment-quoted')
export const themeChanged = useEventBus<string>('theme-changed')
export const sendMsgSuccessed = useEventBus<string>('send-msg-successed')
