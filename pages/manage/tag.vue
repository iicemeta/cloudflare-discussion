<script lang="ts" setup>
import { toast } from 'vue-sonner'
import type { TagDTO } from '~/types'

useHead({
  title: '标签管理',
})
const route = useRoute()
definePageMeta({
  layout: 'backend',
})

const page = ref(Number.parseInt(route.query.page as any as string) || 1)
const size = ref(20)

const saveState = reactive({
  name: '',
  desc: '',
  enName: '',
  id: 0,
  postRoleIds: [] as number[],
})

const isOpen = ref(false)

function doEdit(row: TagDTO) {
  saveState.name = row.name
  saveState.desc = row.desc
  saveState.enName = row.enName
  saveState.id = row.id
  saveState.postRoleIds = (row.postRoles ?? []).map(role => role.id)
  isOpen.value = true
}

function doAdd() {
  saveState.name = ''
  saveState.desc = ''
  saveState.enName = ''
  saveState.id = 0
  saveState.postRoleIds = []
  isOpen.value = true
}

const columns = [{
  key: 'name',
  label: '名称',
}, {
  key: 'enName',
  label: '编码',
}, {
  key: 'desc',
  label: '描述',
}, {
  key: 'hot',
  label: '是否热门',
}, {
  key: 'postRoles',
  label: '发帖限制',
}, {
  key: 'count',
  label: '帖子数量',
}, {
  key: 'actions',
}]

interface TagListResponse {
  success: boolean
  message?: string
  tags?: TagDTO[]
  total?: number
}

const {
  data: tagListRes,
  pending,
  errorMessage,
  execute: reload,
} = useApiRequest(() => $fetch<TagListResponse>('/api/manage/tagList', {
  method: 'POST',
  body: {
    page: page.value,
    size: size.value,
  },
}), '标签列表加载失败')
const tagList = computed(() => tagListRes.value?.tags ?? [])
const total = computed(() => tagListRes.value?.total ?? 0)

interface TitleListResponse {
  success: boolean
  message?: string
  titles?: Array<{ id: number, title: string, style: string, status: boolean }>
}

const titleOptions = ref<Array<{ id: number, title: string }>>([])

onMounted(async () => {
  try {
    const res = assertApiSuccess(await $fetch<TitleListResponse>('/api/manage/title/titleList', {
      method: 'POST',
      body: { page: 1, size: 100, onlyEnabled: true },
    }), '头衔列表加载失败')
    titleOptions.value = (res.titles ?? []).map(item => ({ id: item.id, title: item.title }))
  }
  catch (error) {
    toast.error(getApiErrorMessage(error, '头衔列表加载失败'))
  }
})

onMounted(reload)

async function saveTag() {
  if (!saveState.enName.trim() || !saveState.name.trim() || !saveState.desc.trim()) {
    toast.error('请填写完整,都是必填字段')
    return
  }
  try {
    const res = assertApiSuccess(await $fetch('/api/manage/saveTag', {
      method: 'POST',
      body: saveState,
    }), '保存失败')
    isOpen.value = false
    await reload()
    await refreshNuxtData(['hotTagLists', 'allTagLists'])
    toast.success('保存成功')
  }
  catch (error) {
    toast.error(getApiErrorMessage(error, '保存失败'))
  }
}

async function toggleHot(tag: TagDTO) {
  try {
    assertApiSuccess(await $fetch('/api/manage/toggleHot', {
      method: 'POST',
      body: { id: tag.id },
    }), '更新热门状态失败')
    await reload()
    await refreshNuxtData(['hotTagLists', 'allTagLists'])
  }
  catch (error) {
    toast.error(getApiErrorMessage(error, '更新热门状态失败'))
  }
}

watch(() => route.query.page, () => {
  page.value = Number.parseInt(String(route.query.page || '1')) || 1
  void reload()
})
</script>

<template>
  <UCard class="flex-1">
    <template #header>
      <UButton @click="doAdd">
        新增标签
      </UButton>
    </template>
    <XManageDataState :pending="pending" :error="errorMessage" @retry="reload">
      <UTable :rows="tagList" :columns="columns">
      <template #avatarUrl-data="{ row }">
        <NuxtLink :to="`/member/${row.uid}`">
          <UAvatar :src="getAvatarUrl(row.avatarUrl!, row.headImg)" size="lg" alt="Avatar" />
        </NuxtLink>
      </template>
      <template #actions-data="{ row }">
        <div class="space-x-2">
          <UButton color="white" @click="doEdit(row)">
            编辑
          </UButton>
          <UButton color="gray" @click="toggleHot(row)">
            {{ row.hot ? '取消' : '设为' }}热门
          </UButton>
        </div>
      </template>
      <template #hot-data="{ row }">
        {{ row.hot ? '是' : '否' }}
      </template>
      <template #postRoles-data="{ row }">
        {{ row.postRoles?.length ? row.postRoles.map((role: any) => role.title).join('、') : '不限' }}
      </template>
      </UTable>
    </XManageDataState>
    <template #footer>
      <UPagination
        v-if="total > size" v-model="page" size="sm" :to="(page: number) => ({
          query: { page },
        })" class="my-2" :page-count="size" :total="total || 0"
      />
    </template>
  </UCard>

  <UModal v-model="isOpen">
    <div class="p-4 space-y-4">
      <UFormGroup label="名称" name="name">
        <UInput v-model="saveState.name" />
      </UFormGroup>
      <UFormGroup label="编码" name="enName">
        <UInput v-model="saveState.enName" />
      </UFormGroup>
      <UFormGroup label="描述" name="desc">
        <UTextarea v-model="saveState.desc" />
      </UFormGroup>
      <UFormGroup label="发帖头衔限制" name="postRoleIds">
        <USelectMenu
          v-model="saveState.postRoleIds"
          :options="titleOptions"
          value-attribute="id"
          option-attribute="title"
          multiple
          placeholder="不限制,任何用户都可发帖"
        >
          <template #label>
            <span class="truncate">
              {{ saveState.postRoleIds.length
                ? titleOptions.filter(option => saveState.postRoleIds.includes(option.id)).map(option => option.title).join('、')
                : '不限制,任何用户都可发帖' }}
            </span>
          </template>
        </USelectMenu>
        <p class="text-xs text-gray-400 mt-1">
          选择头衔后,该标签仅限拥有任一所选头衔的用户发帖(管理员不受限);留空则不限制
        </p>
      </UFormGroup>
      <UButton @click="saveTag">
        提交
      </UButton>
    </div>
  </UModal>
</template>

<style scoped></style>
