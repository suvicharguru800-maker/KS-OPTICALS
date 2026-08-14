import { createClient } from "@supabase/supabase-js";

// These come from Vercel Environment Variables (see README.md).
// Locally, put the same values in a .env file (see .env.example).
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
