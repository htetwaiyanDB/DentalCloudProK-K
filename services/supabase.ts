import { createClient } from '@supabase/supabase-js';

// Configuration with hardcoded keys to ensure immediate connectivity
const SUPABASE_URL = 'https://vkknrwgqqcfcyjcaslyo.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZra25yd2dxcWNmY3lqY2FzbHlvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUzOTA1NTksImV4cCI6MjEwMDk2NjU1OX0.WQoR45ZQKn3VGrUh6kBEB0f_SraYBdIxp6Li9fFFsQ8';

// ---------------------------------------------------------------------------
// IMPORTANT: The app logs in with its OWN custom auth (users/patient_auth
// tables + staff_auth_sessions), NOT Supabase Auth. Persisting a Supabase Auth
// session is dangerous: when its access token expires (~1 hour) it is still
// attached to every request and PostgREST replies "401 Unauthorized", causing
// intermittent "cannot save / cannot load" errors (e.g. adding a treatment).
// For that reason Supabase Auth sessions are never persisted or auto-refreshed
// here. Password recovery still works because detectSessionInUrl stays on - the
// one-shot token arrives in the URL hash for that single page load.
// ---------------------------------------------------------------------------
if (typeof window !== 'undefined') {
  try {
    // Heal browsers that already stored a stale/expired Supabase session.
    window.localStorage.removeItem('dental_supabase_auth');
    // Older builds may have used the default Supabase storage key format.
    Object.keys(window.localStorage)
      .filter((key) => key.startsWith('sb-') && key.endsWith('-auth-token'))
      .forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // ignore - storage may be unavailable (private mode / SSR / disabled)
  }
}

// Create client with proper configuration for the app's custom auth
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
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
