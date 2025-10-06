import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://hqoysmhgzorrrvvytnep.supabase.co'
const SUPABASE_SERVICE_ROLE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhxb3lzbWhnem9ycnJ2dnl0bmVwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1OTYyMjcyMiwiZXhwIjoyMDc1MTk4NzIyfQ.EVxcEjyg2cgScJgYLMFy-quYBnIytd6Zx5qfI8CtFw4'

const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
  auth: { persistSession: false }
})

// Create mockups bucket
console.log('Creating mockups bucket...')
const { data: mockups, error: mockupsError } = await supa.storage.createBucket('mockups', {
  public: false,
  fileSizeLimit: 52428800 // 50MB
})
if (mockupsError && !mockupsError.message.includes('already exists')) {
  console.error('Error creating mockups bucket:', mockupsError)
} else {
  console.log('✓ mockups bucket ready')
}

// Create sanmar bucket
console.log('Creating sanmar bucket...')
const { data: sanmar, error: sanmarError } = await supa.storage.createBucket('sanmar', {
  public: false,
  fileSizeLimit: 52428800 // 50MB
})
if (sanmarError && !sanmarError.message.includes('already exists')) {
  console.error('Error creating sanmar bucket:', sanmarError)
} else {
  console.log('✓ sanmar bucket ready')
}

console.log('Done!')
