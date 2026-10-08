<script lang="ts" setup>
const route = useRoute()
const uid = route.params.fromUid as string

onMounted(() => {
  userCardChanged.emit()
})
</script>

<template>
  <XPrivateMsgList :from-uid="uid" />
  <XSendMsg :to-uid="uid" @send-msg-success="sendMsgSuccessed.emit()" />
</template>

<style scoped>

</style>
