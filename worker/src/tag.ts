import type { Env } from './types'
import { all } from './db'
import { DAY_MS, json } from './utils'
import { publicUsernameFields } from './auth'

/**
 * 解析 tags.post_roles(JSON 数组的头衔 ID 列表)。
 * 非法/为空一律返回 [],表示不限制发帖头衔。
 */
export function parsePostRoleIds(raw: unknown): number[] {
  if (!raw) {
    return []
  }
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!Array.isArray(parsed)) {
      return []
    }
    return [...new Set(parsed.map(v => Number(v)).filter(v => Number.isInteger(v) && v > 0))]
  }
  catch {
    return []
  }
}

export function mapTag(row: any) {
  return {
    id: Number(row.id),
    name: row.name,
    enName: row.en_name,
    desc: row.desc,
    count: Number(row.count ?? 0),
    hot: Number(row.hot) === 1,
    postRoleIds: parsePostRoleIds(row.post_roles),
  }
}

/**
 * 把头衔 ID 解析成 { id, title },供前端展示「该标签仅限 xx 头衔发帖」。
 * 头衔可能已被删除,查不到的直接丢弃。
 */
export async function attachTagRoles<T extends { postRoleIds: number[] }>(env: Env, tags: T[]) {
  const ids = [...new Set(tags.flatMap(tag => tag.postRoleIds))]
  const names = new Map<number, string>()
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',')
    const rows = await all(env, `SELECT id, title FROM titles WHERE id IN (${placeholders})`, ids)
    for (const row of rows) {
      names.set(Number(row.id), row.title)
    }
  }
  return tags.map(tag => ({
    ...tag,
    postRoles: tag.postRoleIds
      .map(id => ({ id, title: names.get(id) ?? '' }))
      .filter(role => role.title),
  }))
}

export async function buildTagListResponse(env: Env, url: URL) {
  const hot = url.searchParams.get('hot')
  const name = url.searchParams.get('name')
  const where: string[] = []
  const args: any[] = []

  if (hot === 'true') {
    where.push('hot = 1')
  }
  if (name) {
    where.push('en_name = ?')
    args.push(name)
  }

  const sql = `SELECT id, name, en_name, "desc", count, hot, post_roles FROM tags${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY hot DESC, count DESC, id ASC`
  const rows = await all(env, sql, args)
  const headers = new Headers({
    'Cache-Control': 'no-store',
  })

  return json({
    success: true,
    tags: await attachTagRoles(env, rows.map(mapTag)),
  }, headers)
}

export async function buildMemberHotResponse(env: Env) {
  const since = new Date(Date.now() - 3 * DAY_MS).toISOString()
  const rows = await all(env, `
    SELECT u.uid, u.username, u.nickname, u.username_visible, u.avatar_url, u.head_img, SUM(ph.point) AS points
    FROM point_history ph
    JOIN users u ON u.uid = ph.uid
    WHERE ph.created_at > ?
      AND ph.reason NOT IN ('INVITE', 'PUTIN')
    GROUP BY u.uid, u.username, u.nickname, u.username_visible, u.avatar_url, u.head_img
    HAVING SUM(ph.point) > 0
    ORDER BY points DESC
    LIMIT 10
  `, [since])

  return json(rows.map(row => ({
    uid: row.uid,
    ...publicUsernameFields(row),
    avatarUrl: row.avatar_url,
    headImg: row.head_img,
    points: Number(row.points ?? 0),
  })))
}
