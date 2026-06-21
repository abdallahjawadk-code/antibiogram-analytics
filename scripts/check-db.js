import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';

// Read .env file manually
const envFile = fs.readFileSync('.env', 'utf8');
const env = {};
envFile.split('\n').forEach(line => {
  const parts = line.trim().split('=');
  if (parts.length === 2) {
    env[parts[0]] = parts[1];
  }
});

const supabaseUrl = env['VITE_SUPABASE_URL'];
const supabaseAnonKey = env['VITE_SUPABASE_ANON_KEY'];

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function run() {
  try {
    const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
      email: 'demo@example.com',
      password: 'Password123!'
    });
    if (authErr) throw authErr;
    console.log('Successfully logged in as:', authData.user.email);

    const { data: hospitals, error: hErr } = await supabase.from('hospitals').select('*');
    if (hErr) throw hErr;
    console.log('Hospitals:', hospitals);

    const { data: dataSample, error: dErr } = await supabase.from('antibiogram_data').select('*').limit(5);
    if (dErr) throw dErr;
    console.log('Antibiogram Data Sample:', dataSample);

    const { count, error: countErr } = await supabase.from('antibiogram_data').select('*', { count: 'exact', head: true });
    if (countErr) throw countErr;
    console.log('Total Antibiogram Rows:', count);

  } catch (err) {
    console.error('Error:', err);
  }
}

run();
