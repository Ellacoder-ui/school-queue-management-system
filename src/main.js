import { createApp } from 'vue'
import './design-tokens.css'
import './style.css'
import App from './App.vue'
import { supabase } from './lib/supabase.js'

const app = createApp(App)
app.provide('supabase', supabase)
app.mount('#app')
