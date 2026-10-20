<script setup>
import { defineAsyncComponent } from 'vue'
import { isPublicMonitorPath } from './lib/publicBoard.js'
// The monitor never mounts the Auth controller/form; existing app access stays at /.
const isAccountSecurityPath = /^\/account\/security\/?$/.test(window.location.pathname)
const Page = defineAsyncComponent(() => isPublicMonitorPath(window.location.pathname)
  ? import('./components/PublicQueueMonitor.vue') : import('./components/QueueApplication.vue'))
</script>

<template><component :is="Page" :mfa-mode="isAccountSecurityPath" /></template>
