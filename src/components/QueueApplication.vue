<script setup>
import { usePublicQueue } from '../composables/usePublicQueue.js'
import AuthWorkspace from './AuthWorkspace.vue'
import { useQueueAuth } from '../composables/useQueueAuth.js'
import { isDevelopmentLoginPath } from '../lib/oauthConfig.js'
import { useWorkspaceData } from '../composables/useWorkspaceData.js'
import { useQueueActions } from '../composables/useQueueActions.js'
import { useAdminWorkspace } from '../composables/useAdminWorkspace.js'
import { useAdminRecords } from '../composables/useAdminRecords.js'
import '../workspace.css'
const props = defineProps({ mfaMode: { type: Boolean, default: false } })
const { state, refresh } = usePublicQueue()
const auth = useQueueAuth()
const workspace = useWorkspaceData(auth.state, state)
const actions = useQueueActions(auth, workspace, refresh)
const management = useAdminWorkspace(auth, state, refresh)
const records = useAdminRecords(auth, state, management)
const developmentLogin = isDevelopmentLoginPath(import.meta.env.DEV, window.location.pathname)
</script>

<template>
    <AuthWorkspace :state="auth.state.value" :oauth-state="auth.oauthState.value" :development-login="developmentLogin" :mfa-mode="props.mfaMode" :actor="auth.getVerifiedActor()"
      :mfa-state="auth.mfa.state.value" @mfa-open="auth.mfa.open" @mfa-close="auth.mfa.close" @mfa-enroll="auth.mfa.enroll" @mfa-select="auth.mfa.select" @mfa-verify="auth.mfa.verify"
      @mfa-request-discard="auth.mfa.requestDiscard" @mfa-cancel-discard="auth.mfa.cancelDiscard" @mfa-discard="auth.mfa.discardUnfinished"
      :public-state="state" :data="workspace.state.value" @refresh-data="workspace.refresh"
      :action-state="actions.state.value" @queue-action="actions.perform" @retry-action="actions.retry" @dismiss-action="actions.clearMessage"
      :management-state="management.state.value" @refresh-staff="management.refresh" @management-action="management.perform" @reconcile-management="management.retry"
      :admin-records="{staff:records.staff.value,pending:records.pending.value,lookup:records.lookup.value,payors:records.payors.value,history:records.history.value}"
      @records-tab="records.activate" @records-find="records.find" @records-clear="records.clearLookup" @records-query="records.query" @records-events="records.events" @records-close-history="records.clearHistory" @records-retry="records.retry"
      @google="auth.google"
      @login="auth.login" @logout="auth.logout" @refresh="auth.refresh" @navigate="auth.navigate" />
</template>
