<script setup>
defineProps({ state:{type:Object,required:true} })
defineEmits(['reconcile','cancel'])
</script>

<template>
  <div v-if="state.phase !== 'idle' && state.phase !== 'complete' && state.phase !== 'cancelled'" class="google-flow-status" :role="['error','uncertain'].includes(state.phase) ? 'alert' : 'status'" data-testid="google-callback-status">
    <p>{{ state.message || 'Preparing secure sign-in…' }}</p>
    <div class="mt-3 flex flex-wrap gap-3">
      <button v-if="state.phase === 'uncertain'" type="button" class="auth-secondary" @click="$emit('reconcile')">Check sign-in outcome</button>
      <button v-if="['starting','redirecting','exchanging','uncertain','checking','blocked','error'].includes(state.phase)" type="button" class="auth-secondary" @click="$emit('cancel')">Cancel sign-in</button>

    </div>
  </div>
</template>
