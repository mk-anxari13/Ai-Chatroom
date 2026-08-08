import { createClient } from '@supabase/supabase-js';

const supabase = createClient('https://ahscpdroorbtysyiuwjd.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFoc2NwZHJvb3JidHlzeWl1d2pkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MzQwNTQ0NiwiZXhwIjoyMDk4OTgxNDQ2fQ.XhJJHE5rDp-q0y7jR9eFWkgR69OOTy7qIOqApGa9kug');
async function run() {
  const { data, error } = await supabase.from('document_chunks').select('id, document_id, tenant_id, documents!inner(filename, tenant_id)').eq('tenant_id', '00000000-0000-0000-0000-000000000001').limit(1);
  console.log('Result:', JSON.stringify({data, error}, null, 2));
}
run();
