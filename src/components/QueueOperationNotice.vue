<script setup>
defineProps({ state: { type: Object, required: true } })
defineEmits(['retry', 'dismiss'])
</script>
<template>
  <section v-if="state.phase !== 'idle'" class="cqs-notice" :class="{ 'cqs-notice-success': state.phase === 'success' }" :role="['error', 'unknown', 'blocked'].includes(state.phase) ? 'alert' : 'status'" data-testid="queue-operation-status" :data-phase="state.phase" :aria-busy="!!state.busy">
    <p>{{ state.message }}</p><strong v-if="state.phase === 'success' && state.operation === 'issue_ticket' && state.result">{{ state.result.service }}-{{ String(state.result.sequence_number).padStart(3, '0') }} · {{ state.result.business_date }}</strong>
    <template v-if="state.phase === 'unknown'"><p>Checking may complete your original action if it did not reach the server. It keeps the same request key.</p><button type="button" class="cqs-button cqs-button-outline" data-testid="retry-queue-operation" :disabled="state.busy" @click="$emit('retry')">Check / retry same action</button></template>
    <button v-if="['success', 'error'].includes(state.phase)" type="button" class="cqs-link" :disabled="state.busy" @click="$emit('dismiss')">Dismiss message</button>
  </section>
</template>
