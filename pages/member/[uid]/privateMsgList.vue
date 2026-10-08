<script lang="ts" setup>
import { sendMsgSuccessed } from '~/utils/eventbus'

const route = useRoute()
const uid = route.params.fromUid as string
</script>

<template>
  <div>
    <XPrivateMsgList :from-uid="uid" />
    <XSendMsg :to-uid="uid" @send-msg-success="sendMsgSuccessed.emit()" />
  </div>
</template>

<style scoped></style>
