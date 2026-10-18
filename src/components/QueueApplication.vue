<script setup>
import PublicQueueDisplay from './PublicQueueDisplay.vue'
import { usePublicQueue } from '../composables/usePublicQueue.js'
import AuthWorkspace from './AuthWorkspace.vue'
import { useQueueAuth } from '../composables/useQueueAuth.js'
import { isDevelopmentLoginPath } from '../lib/oauthConfig.js'
const { state, retry } = usePublicQueue()
const auth = useQueueAuth(state)
const developmentLogin = isDevelopmentLoginPath(import.meta.env.DEV, window.location.pathname)
</script>

<template>
  <PublicQueueDisplay :state="state" @retry="retry">
    <AuthWorkspace :state="auth.state.value" :oauth-state="auth.oauthState.value" :development-login="developmentLogin"
      @google="auth.google" @reconcile-oauth="auth.reconcileOAuth" @cancel-oauth="auth.cancelOAuth"
      @login="auth.login" @logout="auth.logout" @refresh="auth.refresh" @navigate="auth.navigate" />
  </PublicQueueDisplay>
</template>
