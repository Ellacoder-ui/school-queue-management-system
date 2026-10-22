<script setup>
import { ref } from 'vue'
import CashierDashboard from './CashierDashboard.vue'
import '../workspace.css'

const counterId = '00000000-0000-4000-8000-000000000001'
const businessDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date())
const context = {
  role: 'CASHIER',
  enabled: true,
  cashier_counters: [{
    counter_id: counterId,
    counter_number: 1,
    counter_label: 'Counter 1',
    is_open: true,
    service_codes: ['TP'],
  }],
}
const data = {
  status: 'ready',
  updatedAt: Date.now(),
  rows: [
    {
      ticket_id: '00000000-0000-4000-8000-000000000031',
      service: 'TP',
      number: 31,
      business_date: businessDate,
      status: 'CALLED',
      counter_id: counterId,
      wait_position: 0,
    },
    {
      ticket_id: '00000000-0000-4000-8000-000000000032',
      service: 'TP',
      number: 32,
      business_date: businessDate,
      status: 'WAITING',
      counter_id: null,
      wait_position: 1,
    },
    {
      ticket_id: '00000000-0000-4000-8000-000000000033',
      service: 'TP',
      number: 33,
      business_date: businessDate,
      status: 'WAITING',
      counter_id: null,
      wait_position: 2,
    },
  ],
}
const publicState = {
  counters: [{
    counter_id: counterId,
    counter_label: 'Counter 1',
    is_open: true,
    ticket_label: 'TP-031',
    service_code: 'TP',
    business_date: businessDate,
  }],
  services: [{ service_code: 'TP', business_date: businessDate, waiting_count: 2 }],
  context: {
    timezone: 'Asia/Manila',
    business_date: businessDate,
    queue_day_open: true,
    services: [{ code: 'TP', name: 'Tuition Payment', issuance_status: 'OPEN' }],
  },
  hasSnapshot: true,
  loading: false,
  refreshing: false,
  connection: 'connected',
  synchronized: true,
  error: null,
  lastRefreshed: null,
}
const previewNotice = ref('')
const actionState = { phase: 'idle', busy: false, message: null }

function previewAction(action) {
  previewNotice.value = `Preview only: ${action.replaceAll('_', ' ')} was not sent to the backend. No queue operation was performed.`
}
</script>

<template>
  <div class="cqs-app">
    <a class="cqs-skip" href="#workspace-main">Skip to main content</a>
    <header class="cqs-header">
      <a href="/" class="cqs-brand" aria-label="Liceo de Cagayan University home">
        <img src="/liceo-logo.png" alt="Liceo de Cagayan University logo" class="cqs-brand-logo" />
        <span><strong>Liceo de Cagayan University</strong><small>University cashier services</small></span>
      </a>
      <div class="cqs-header-actions">
        <span class="cqs-account"><span class="cqs-avatar" aria-hidden="true">P</span><span>Synthetic cashier<small>Development preview</small></span></span>
        <a class="cqs-button cqs-button-outline" href="/">Exit preview</a>
      </div>
    </header>
    <main id="workspace-main" class="cqs-workspace">
      <p class="cqs-notice" role="status" data-testid="cashier-preview-banner">
        DEVELOPMENT PREVIEW — synthetic CASHIER at Counter 1. This is not an authenticated Google session.
        Tickets are sample data. Queue actions are intercepted; no backend request or queue operation is performed.
      </p>
      <p v-if="previewNotice" class="cqs-notice" role="status" data-testid="cashier-preview-action-notice">{{ previewNotice }}</p>
      <CashierDashboard :context="context" :public-state="publicState" :data="data" :action-state="actionState" @action="previewAction" @refresh="previewAction('refresh queue')" @retry-public="previewAction('refresh public queue')" />
    </main>
    <footer class="cqs-footer">Liceo Cashier Queue <span>Development preview · Sample queue only</span></footer>
  </div>
</template>
