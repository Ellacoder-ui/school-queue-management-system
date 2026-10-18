<script setup>
import PublicQueueDisplay from './PublicQueueDisplay.vue'
import { usePublicQueue } from '../composables/usePublicQueue.js'
const { state, retry } = usePublicQueue()
</script>

<template><PublicQueueDisplay :state="state" @retry="retry" /></template>
