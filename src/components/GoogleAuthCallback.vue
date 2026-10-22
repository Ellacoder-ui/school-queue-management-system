<script setup>
defineProps({ state:{type:Object,required:true} })
</script>

<template>
  <div v-if="state.phase !== 'idle' && state.phase !== 'complete' && state.phase !== 'cancelled'" class="google-flow-status" :role="['error','uncertain'].includes(state.phase) ? 'alert' : 'status'" data-testid="google-callback-status">
    <p>{{ state.message || 'Preparing secure sign-in…' }}</p>
  </div>
</template>
