import express from 'express'
import cors from 'cors'
import sharp from 'sharp'
import { proofsQueue, startWorker } from './queue.js'
import { supabaseAdmin } from './services/supabase.js'
import { signedUrl } from './services/storage.js'
import { renderSingle, listMockups } from './services/dynamicMockups.js'

const app = express()
const PORT = Number(process.env.PORT || 4001)
const HOST = process.env.HOST || '0.0.0.0'
const ALLOWED_ORIGINS = (process.env.PUBLIC_SITE_ORIGIN || 'http://localhost:3000').split(',')

// Middleware
app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }))
app.use(express.json())

// Auth middleware
const requireAuth = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) {
    console.log('[Auth] No authorization token provided')
    return res.status(401).json({ error: 'No authorization token' })
  }

  console.log('[Auth] Validating token:', token.substring(0, 20) + '...')
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !user) {
    console.error('[Auth] Token validation failed:', error?.message || 'No user found')
    console.error('[Auth] Full error:', JSON.stringify(error, null, 2))
    return res.status(401).json({ error: 'Invalid token', details: error?.message })
  }

  console.log('[Auth] Token valid for user:', user.id)
  ;(req as any).user = user
  next()
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Debug auth endpoint
app.get('/api/debug/auth', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) {
    return res.json({
      error: 'No token provided',
      hasAuthHeader: !!req.headers.authorization,
      authHeader: req.headers.authorization?.substring(0, 20) + '...'
    })
  }

  console.log('[Debug] Token received:', token.substring(0, 20) + '...')

  try {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)
    res.json({
      success: !error,
      hasUser: !!user,
      userId: user?.id,
      error: error?.message,
      tokenLength: token.length,
      tokenStart: token.substring(0, 20) + '...'
    })
  } catch (err: any) {
    res.json({
      error: 'Exception occurred',
      message: err.message,
      tokenLength: token.length
    })
  }
})

// Generate proof
app.post('/api/proofs/:orderId/generate', requireAuth, async (req, res) => {
  try {
    const { orderId } = req.params
    const { version = 1 } = req.body

    await proofsQueue.add('generate-proof', { orderId, version })
    res.json({ message: 'Proof generation queued', orderId })
  } catch (error: any) {
    console.error('Queue error:', error)
    res.status(500).json({ error: error.message })
  }
})

// List proofs
app.get('/api/proofs', requireAuth, async (req, res) => {
  try {
    const user = (req as any).user
    const { data, error } = await supabaseAdmin
      .from('proofs')
      .select('*, order:orders!inner(*)')
      .eq('orders.created_by', user.id)
      .order('created_at', { ascending: false })

    if (error) throw error
    res.json(data)
  } catch (error: any) {
    console.error('List proofs error:', error)
    res.status(500).json({ error: error.message })
  }
})

// Refresh signed URL
app.get('/api/proofs/:id/signed', requireAuth, async (req, res) => {
  try {
    const { id } = req.params
    const { data: proof, error } = await supabaseAdmin
      .from('proofs')
      .select('pdf_path')
      .eq('id', id)
      .single()

    if (error || !proof) {
      return res.status(404).json({ error: 'Proof not found' })
    }

    const url = await signedUrl(process.env.BUCKET_PROOFS!, proof.pdf_path, 86400)
    res.json({ signedUrl: url })
  } catch (error: any) {
    console.error('Signed URL error:', error)
    res.status(500).json({ error: error.message })
  }
})

// Public proof viewer
app.get('/api/public/proofs/:id', async (req, res) => {
  try {
    const { id } = req.params
    const { token } = req.query

    if (!token) {
      return res.status(401).json({ error: 'Token required' })
    }

    const { data: proof, error } = await supabaseAdmin
      .from('proofs')
      .select('*, order:orders(*, customer:customers(*))')
      .eq('id', id)
      .eq('approval_token', token)
      .single()

    if (error || !proof) {
      return res.status(404).json({ error: 'Proof not found or invalid token' })
    }

    const pdfUrl = await signedUrl(process.env.BUCKET_PROOFS!, proof.pdf_path, 86400)
    res.json({ ...proof, pdf_signed_url: pdfUrl })
  } catch (error: any) {
    console.error('Public proof error:', error)
    res.status(500).json({ error: error.message })
  }
})

// Public approval
app.post('/api/public/proofs/:id/approve', async (req, res) => {
  try {
    const { id } = req.params
    const { token } = req.query

    if (!token) {
      return res.status(401).json({ error: 'Token required' })
    }

    const { error } = await supabaseAdmin
      .from('proofs')
      .update({ status: 'approved', approved_at: new Date().toISOString() })
      .eq('id', id)
      .eq('approval_token', token)

    if (error) throw error

    res.json({ message: 'Proof approved' })
  } catch (error: any) {
    console.error('Approval error:', error)
    res.status(500).json({ error: error.message })
  }
})

// Dynamic Mockups: List available mockups from library
app.get('/api/mockups/list', async (req, res) => {
  try {
    const mockups = await listMockups()
    res.json({ mockups })
  } catch (error: any) {
    console.error('List mockups error:', error)
    res.status(500).json({ error: error.message })
  }
})

// Dynamic Mockups: Generate and save mockup
app.post('/api/mockups/generate', requireAuth, async (req, res) => {
  try {
    const user = (req as any).user
    const { design_file_id, mockup_uuid, smart_object_uuid, customer_id, order_id, mockup_name } = req.body

    if (!design_file_id || !mockup_uuid || !smart_object_uuid) {
      return res.status(400).json({ error: 'design_file_id, mockup_uuid, and smart_object_uuid required' })
    }

    // Fetch design file
    const { data: designFile, error: dfError } = await supabaseAdmin
      .from('design_files')
      .select('*')
      .eq('id', design_file_id)
      .single()

    if (dfError || !designFile) {
      return res.status(404).json({ error: 'Design file not found' })
    }

    // Create signed URL for artwork
    const { data: signedData, error: signError } = await supabaseAdmin.storage
      .from(process.env.BUCKET_DESIGN!)
      .createSignedUrl(designFile.storage_path, 3600)

    if (signError) throw signError

    let artworkUrl = signedData.signedUrl

    // Convert SVG to PNG if needed (Dynamic Mockups doesn't support SVG)
    if (designFile.mime_type === 'image/svg+xml' || designFile.filename.toLowerCase().endsWith('.svg')) {
      console.log('[Mockup Generate] Converting SVG to PNG...')

      // Download SVG
      const svgResponse = await fetch(signedData.signedUrl)
      if (!svgResponse.ok) throw new Error('Failed to download SVG')
      const svgBuffer = Buffer.from(await svgResponse.arrayBuffer())

      // Convert to PNG with transparent background
      const pngBuffer = await sharp(svgBuffer)
        .resize(4000, 4000, { fit: 'inside', withoutEnlargement: true })
        .png({ quality: 100 })
        .toBuffer()

      // Upload converted PNG temporarily
      const tempPngPath = `temp/${Date.now()}-converted.png`
      const { error: uploadError } = await supabaseAdmin.storage
        .from(process.env.BUCKET_DESIGN!)
        .upload(tempPngPath, pngBuffer, { contentType: 'image/png' })

      if (uploadError) throw uploadError

      // Create signed URL for converted PNG
      const { data: pngSignedData, error: pngSignError } = await supabaseAdmin.storage
        .from(process.env.BUCKET_DESIGN!)
        .createSignedUrl(tempPngPath, 3600)

      if (pngSignError) throw pngSignError
      artworkUrl = pngSignedData.signedUrl

      console.log('[Mockup Generate] SVG converted to PNG')
    }

    // Render mockup via Dynamic Mockups
    console.log('[Mockup Generate] Rendering mockup...')
    const { url: exportUrl } = await renderSingle({
      mockup_uuid,
      smart_object_uuid,
      assetUrl: artworkUrl,
      export_label: `${customer_id || 'customer'}-${design_file_id}`
    })

    // Download rendered mockup
    console.log('[Mockup Generate] Downloading rendered mockup...')
    const response = await fetch(exportUrl)
    if (!response.ok) throw new Error(`Download failed: ${response.status}`)

    const buffer = Buffer.from(await response.arrayBuffer())
    const ext = (process.env.DYNAMIC_MOCKUPS_EXPORT_FORMAT ?? 'jpg').toLowerCase()

    // Upload to mockups bucket
    const storagePath = `${customer_id || 'general'}/${Date.now()}-${designFile.filename}.${ext}`
    console.log('[Mockup Generate] Uploading to storage:', storagePath)

    const { error: uploadError } = await supabaseAdmin.storage
      .from(process.env.BUCKET_MOCKUPS!)
      .upload(storagePath, buffer, { contentType: `image/${ext}` })

    if (uploadError) throw uploadError

    // Save to database
    const mockupRecord = {
      customer_id: customer_id || null,
      order_id: order_id || null,
      design_file_id,
      mockup_uuid,
      mockup_name: mockup_name || null,
      smart_object_uuid,
      storage_path: storagePath,
      filename: `mockup-${designFile.filename}.${ext}`,
      mime_type: `image/${ext}`,
      file_size: buffer.length,
      created_by: user.id
    }

    const { data: savedMockup, error: insertError } = await supabaseAdmin
      .from('generated_mockups')
      .insert(mockupRecord)
      .select()
      .single()

    if (insertError) throw insertError

    // Create signed URL for response
    const { data: mockupSignedUrl } = await supabaseAdmin.storage
      .from(process.env.BUCKET_MOCKUPS!)
      .createSignedUrl(storagePath, 86400)

    console.log('[Mockup Generate] Success:', savedMockup.id)
    res.json({ ...savedMockup, signed_url: mockupSignedUrl?.signedUrl })
  } catch (error: any) {
    console.error('Mockup generate error:', error)
    res.status(500).json({ error: error.message })
  }
})

// Dynamic Mockups: Test render with a design file
app.post('/api/mockups/test', async (req, res) => {
  try {
    const { storage_path, mockup_uuid, smart_object_uuid } = req.body

    if (!storage_path) {
      return res.status(400).json({ error: 'storage_path required' })
    }

    // Create signed URL for the design file
    const { data, error } = await supabaseAdmin.storage
      .from(process.env.BUCKET_DESIGN!)
      .createSignedUrl(storage_path, 3600)

    if (error) throw error

    // Use provided UUIDs or fall back to env defaults
    const result = await renderSingle({
      mockup_uuid: mockup_uuid || process.env.DYNAMIC_MOCKUPS_DEFAULT_MOCKUP_UUID!,
      smart_object_uuid: smart_object_uuid || process.env.DYNAMIC_MOCKUPS_DEFAULT_SMART_UUID!,
      assetUrl: data.signedUrl,
      export_label: 'test'
    })

    res.json(result)
  } catch (error: any) {
    console.error('Mockup test error:', error)
    res.status(500).json({ error: error.message })
  }
})

// Only start BullMQ worker if Redis is configured (only in non-serverless environment)
if (process.env.REDIS_URL && !process.env.VERCEL) {
  startWorker()
  console.log('BullMQ worker started')
}

// Start server (only in non-serverless environment)
if (!process.env.VERCEL) {
  app.listen(PORT, HOST, () => {
    console.log(`Worker API listening on http://${HOST}:${PORT}`)
  })
}

// Export for Vercel serverless
export default app
