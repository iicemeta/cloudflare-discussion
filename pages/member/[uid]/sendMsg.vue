<script lang="ts" setup>
import type { UserDTO } from '~/types'

const route = useRoute()
const currentUser = useState<UserDTO>('userinfo', () => ({} as UserDTO))
const uid = route.params.uid as string
async function sendMsgSuccess() {
  const owner = currentUser.value?.uid || uid
  await navigateTo(`/member/${owner}/from/${uid}`)
}
</script>

<template>
  <XSendMsg :to-uid="uid" @send-msg-success="sendMsgSuccess" />
</template>

<style scoped>

</style>
