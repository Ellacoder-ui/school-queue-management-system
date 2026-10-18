import { supabase, publicSupabase } from './supabase.js'
import { createQueueApi } from '../services/queueApi.js'

export const queueApi = createQueueApi(supabase, publicSupabase)
