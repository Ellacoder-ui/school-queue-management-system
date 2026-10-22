<script setup>
import PublicQueueDisplay from './PublicQueueDisplay.vue'
import { usePublicQueue } from '../composables/usePublicQueue.js'
const { state } = usePublicQueue()
</script>

<template><PublicQueueDisplay :state="state" /></template>
