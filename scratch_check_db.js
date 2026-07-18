const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

// Parse .env.local manually
const envFile = fs.readFileSync('.env.local', 'utf8');
const env = {};
envFile.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let value = match[2] ? match[2].trim() : '';
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    env[match[1]] = value;
  }
});

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function main() {
  const { data: lectures, error: lecError } = await supabase
    .from('lectures')
    .select('id, title, created_at, duration_seconds, deleted_at, status');
  console.log("Lectures:", lectures);
  console.log("Lectures error:", lecError);

  const { data: flashcards, error: fcError } = await supabase
    .from('flashcards')
    .select('id, question, status');
  console.log("Total Flashcards:", flashcards?.length);
  console.log("Flashcards status count:", flashcards?.reduce((acc, f) => {
    acc[f.status] = (acc[f.status] || 0) + 1;
    return acc;
  }, {}));
}

main();
