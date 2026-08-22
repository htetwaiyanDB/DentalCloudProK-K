import { createClient } from '@supabase/supabase-js';

// Configuration with hardcoded keys to ensure immediate connectivity
const SUPABASE_URL = 'https://supabasekandk.dentalcloud.asia';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZra25yd2dxcWNmY3lqY2FzbHlvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUzOTA1NTksImV4cCI6MjEwMDk2NjU1OX0.WQoR45ZQKn3VGrUh6kBEB0f_SraYBdIxp6Li9fFFsQ8';

// Create client with proper configuration for Supabase Auth
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    storageKey: 'dental_supabase_auth'
  },
  db: {
    schema: 'public'
  }
});

// Export URL and key for reference
export const supabaseUrl = SUPABASE_URL;
export const supabaseAnonKey = SUPABASE_ANON_KEY;
