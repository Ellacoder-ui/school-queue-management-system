<script setup>
import { ref } from 'vue'
defineProps({ disabled:Boolean })
const emit = defineEmits(['login'])
const email=ref(''),password=ref('')
function submit() { const value=password.value; password.value=''; emit('login',email.value,value) }
</script>

<template>
  <form class="mt-5 grid max-w-md gap-4" @submit.prevent="submit" data-testid="development-login">
    <p class="text-sm text-amber-900">Local development test accounts only. This form is excluded from the product login.</p>
    <label class="grid gap-1.5 text-sm font-medium" for="login-email">Email<input id="login-email" v-model="email" type="email" autocomplete="username" required class="rounded-lg border border-slate-300 px-3 py-2" :disabled="disabled"></label>
    <label class="grid gap-1.5 text-sm font-medium" for="login-password">Password<input id="login-password" v-model="password" type="password" autocomplete="current-password" required class="rounded-lg border border-slate-300 px-3 py-2" :disabled="disabled"></label>
    <button type="submit" class="auth-primary justify-self-start" :disabled="disabled">Sign in to local test account</button>
  </form>
</template>
