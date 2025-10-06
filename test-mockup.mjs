#!/usr/bin/env node
/**
 * Quick test script for Dynamic Mockups integration
 * Usage: node test-mockup.mjs <mockup-uuid> <smart-object-uuid> <design-file-path>
 */

import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://hqoysmhgzorrrvvytnep.supabase.co'
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhxb3lzbWhnem9ycnJ2dnl0bmVwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1OTYyMjcyMiwiZXhwIjoyMDc1MTk4NzIyfQ.EVxcEjyg2cgScJgYLMFy-quYBnIytd6Zx5qfI8CtFw4'
const API_KEY = process.env.DYNAMIC_MOCKUPS_API_KEY || 'f03df975-430c-4c90-9c3e-c6c58b95ff97:30ecddbd3e4e3c2e184e6cf18b3914b7a2b42db0df8895ccc9d515cbb9a475ce'

const [mockupUuid, smartObjectUuid, designFilePath] = process.argv.slice(2)

if (!mockupUuid || !smartObjectUuid) {
  console.log('Usage: node test-mockup.mjs <mockup-uuid> <smart-object-uuid> [design-file-path]')
  console.log('')
  console.log('1. Go to https://app.dynamicmockups.com/mockup-library')
  console.log('2. Pick a template and copy the Mockup UUID and Smart Object UUID')
  console.log('3. Run this script with those UUIDs')
  console.log('')
  console.log('Example:')
  console.log('  node test-mockup.mjs a1b2c3d4-... e5f6g7h8-...')
  process.exit(1)
}

const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, { auth: { persistSession: false } })

console.log('🎨 Testing Dynamic Mockups integration...\n')

// If design file path provided, use it; otherwise use a test image URL
let artworkUrl

if (designFilePath && fs.existsSync(designFilePath)) {
  console.log('📤 Uploading test design file to Supabase...')
  const fileBuffer = fs.readFileSync(designFilePath)
  const fileName = `test-${Date.now()}-${designFilePath.split('/').pop()}`
  const storagePath = `test/${fileName}`

  const { error: uploadError } = await supa.storage
    .from('design-files')
    .upload(storagePath, fileBuffer, { upsert: true })

  if (uploadError) {
    console.error('❌ Upload failed:', uploadError.message)
    process.exit(1)
  }

  const { data: signedData } = await supa.storage
    .from('design-files')
    .createSignedUrl(storagePath, 3600)

  artworkUrl = signedData.signedUrl
  console.log('✅ Design file uploaded\n')
} else {
  // Use a public test image
  artworkUrl = 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800'
  console.log('ℹ️  Using test artwork URL (no file provided)\n')
}

console.log('📡 Calling Dynamic Mockups API...')
console.log(`   Mockup UUID: ${mockupUuid}`)
console.log(`   Smart Object UUID: ${smartObjectUuid}`)
console.log(`   Artwork URL: ${artworkUrl.substring(0, 60)}...`)
console.log('')

const response = await fetch('https://app.dynamicmockups.com/api/v1/renders', {
  method: 'POST',
  headers: {
    'x-api-key': API_KEY,
    'Accept': 'application/json',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    mockup_uuid: mockupUuid,
    export_label: 'test-render',
    export_options: {
      image_format: 'jpg',
      image_size: 1500,
      mode: 'view'
    },
    smart_objects: [
      {
        uuid: smartObjectUuid,
        asset: { url: artworkUrl }
      }
    ]
  })
})

if (!response.ok) {
  const error = await response.text()
  console.error('❌ Render failed:', error)
  process.exit(1)
}

const result = await response.json()
const exportUrl = result?.data?.export_path

if (!exportUrl) {
  console.error('❌ No export path in response:', result)
  process.exit(1)
}

console.log('✅ Mockup rendered successfully!\n')
console.log('🖼️  View your mockup here:')
console.log(`   ${exportUrl}\n`)
console.log('💡 To use this template by default, update worker/.env:')
console.log(`   DYNAMIC_MOCKUPS_DEFAULT_MOCKUP_UUID=${mockupUuid}`)
console.log(`   DYNAMIC_MOCKUPS_DEFAULT_SMART_UUID=${smartObjectUuid}`)
console.log('')
console.log('Then restart the worker and generate a proof!')
