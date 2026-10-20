<script setup>
import { onMounted, onUnmounted, ref, useId } from 'vue'
defineProps({ title: { type: String, required: true } })
const emit = defineEmits(['close'])
const dialog = ref(null), titleId = useId()
let previousFocus
const focusable = () => [...dialog.value.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')]
function trapFocus(event) {
  if (event.key !== 'Tab') return
  const elements = focusable(), first = elements[0], last = elements.at(-1)
  if (!first) { event.preventDefault(); return }
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}
onMounted(() => { previousFocus = document.activeElement; dialog.value.showModal(); focusable()[0]?.focus() })
onUnmounted(() => { if (previousFocus?.isConnected) previousFocus.focus() })
</script>

<template>
  <dialog ref="dialog" class="cqs-dialog" :aria-labelledby="titleId" @keydown="trapFocus" @cancel.prevent="emit('close')" @click="event => { if (event.target === dialog) emit('close') }">
    <div class="cqs-dialog-heading"><h2 :id="titleId">{{ title }}</h2><button class="cqs-icon-button" type="button" aria-label="Close dialog" @click="emit('close')">×</button></div>
    <div class="cqs-dialog-content"><slot /></div>
    <div class="cqs-dialog-actions"><slot name="actions" /></div>
  </dialog>
</template>
