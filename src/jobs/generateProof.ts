import { Job } from 'bullmq'
import { ProofJob } from '../types.js'
import { supabaseAdmin } from '../services/supabase.js'
import { renderProofPdf } from '../services/renderer.js'
import { uploadBuffer, signedUrl } from '../services/storage.js'
import { renderSingle } from '../services/dynamicMockups.js'
import crypto from 'node:crypto'

/**
 * Resolve mockup template binding for an order
 * Tries to find a custom binding by SKU, falls back to default env vars
 */
async function resolveBindingForOrder(order: any): Promise<{ mockup_uuid: string; smart_object_uuid: string } | null> {
  // Try to get SKU from first product
  const sku = Array.isArray(order.products) && order.products[0]?.product_id

  if (sku) {
    const { data, error } = await supabaseAdmin
      .from('product_mockup_bindings')
      .select('mockup_uuid, smart_object_uuid')
      .eq('sku', sku)
      .maybeSingle()

    if (!error && data?.mockup_uuid && data?.smart_object_uuid) {
      console.log(`[Mockup] Found binding for SKU ${sku}`)
      return data as any
    }
  }

  // Fallback to default mockup from env
  const defM = process.env.DYNAMIC_MOCKUPS_DEFAULT_MOCKUP_UUID
  const defS = process.env.DYNAMIC_MOCKUPS_DEFAULT_SMART_UUID

  if (defM && defS && defM !== '00000000-0000-0000-0000-000000000000') {
    console.log(`[Mockup] Using default mockup template`)
    return { mockup_uuid: defM, smart_object_uuid: defS }
  }

  console.log(`[Mockup] No mockup binding found, will use raw artwork`)
  return null
}

export async function generateProof(job: Job<ProofJob>) {
  const { orderId, version = 1, notes } = job.data
  console.log(`[generateProof] Starting proof generation for order ${orderId}, version ${version}`)

  // Fetch order, customer, and design files
  const { data: order, error: orderError } = await supabaseAdmin
    .from('orders')
    .select('*, customer:customers(*), design_files(*)')
    .eq('id', orderId)
    .single()

  if (orderError || !order) {
    console.error(`[generateProof] Order fetch error:`, orderError)
    throw new Error(`Order not found: ${orderId}`)
  }
  console.log(`[generateProof] Order fetched:`, order.id)

  // Get signed URLs for design files and try to render mockups
  console.log(`[generateProof] Design files count:`, order.design_files?.length || 0)

  const files: any[] = []

  // Check if user has selected specific mockups
  const selectedMockupIds = order.mockup_ids || []
  if (selectedMockupIds.length > 0) {
    console.log(`[Mockup] User selected ${selectedMockupIds.length} mockup(s), fetching from database...`)

    const { data: selectedMockups, error: mockupError } = await supabaseAdmin
      .from('generated_mockups')
      .select('*')
      .in('id', selectedMockupIds)

    if (!mockupError && selectedMockups && selectedMockups.length > 0) {
      console.log(`[Mockup] Found ${selectedMockups.length} selected mockup(s)`)

      for (const mockup of selectedMockups) {
        // Fetch mockup file from storage and create data URL
        const mockupSignedUrl = await signedUrl(process.env.BUCKET_MOCKUPS!, mockup.storage_path, 3600)

        // Fetch and convert to data URL for PDF embedding
        const resp = await fetch(mockupSignedUrl)
        if (resp.ok) {
          const buf = Buffer.from(await resp.arrayBuffer())
          const ext = mockup.mime_type?.split('/')[1] || 'jpg'
          const dataUrl = `data:${mockup.mime_type};base64,${buf.toString('base64')}`

          files.push({
            filename: mockup.filename,
            placement: mockup.mockup_name || 'MOCKUP',
            url: dataUrl
          })
          console.log(`[Mockup] Added selected mockup: ${mockup.filename}`)
        } else {
          console.warn(`[Mockup] Failed to fetch selected mockup: ${mockup.filename}`)
        }
      }
    }
  }

  // If no user-selected mockups, try automatic mockup generation
  if (files.length === 0) {
    console.log(`[Mockup] No selected mockups, trying automatic generation...`)
    const binding = await resolveBindingForOrder(order).catch(() => null)

    for (const df of order.design_files || []) {
      // Create signed URL for the artwork (needed for both mockup API and fallback)
      const artworkSignedUrl = await signedUrl(process.env.BUCKET_DESIGN!, df.storage_path, 3600)

      // Try to render mockup if we have a binding
      if (binding) {
        try {
          console.log(`[Mockup] Rendering mockup for ${df.filename}...`)

          const { url: exportUrl } = await renderSingle({
            mockup_uuid: binding.mockup_uuid,
            smart_object_uuid: binding.smart_object_uuid,
            assetUrl: artworkSignedUrl,
            export_label: `${orderId}-v${version}-${df.filename}`
          })

          // Fetch the rendered mockup and rehost to our bucket
          console.log(`[Mockup] Fetching rendered mockup from Dynamic Mockups...`)
          const resp = await fetch(exportUrl)
          if (!resp.ok) throw new Error(`fetch export failed: ${resp.status}`)

          const buf = Buffer.from(await resp.arrayBuffer())
          const hash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 8)
          const ext = (process.env.DYNAMIC_MOCKUPS_EXPORT_FORMAT ?? 'jpg').toLowerCase()
          const mockPath = `${orderId}/v${version}-${hash}.${ext}`

          console.log(`[Mockup] Uploading mockup to storage: ${mockPath}`)
          await uploadBuffer(process.env.BUCKET_MOCKUPS!, mockPath, buf, `image/${ext}`)

          // Create data URL for PDF embedding (avoids network fetch during render)
          const dataUrl = `data:image/${ext};base64,${buf.toString('base64')}`

          files.push({
            filename: `mockup-${df.filename}.${ext}`,
            placement: df.placement,
            url: dataUrl
          })

          console.log(`[Mockup] Successfully created mockup for ${df.filename}`)
          continue
        } catch (e: any) {
          console.warn(`[Mockup] Mockup render failed for ${df.filename}, falling back to raw artwork:`, e.message)
        }
      }

      // Fallback: use the original artwork
      files.push({
        filename: df.filename,
        placement: df.placement,
        url: artworkSignedUrl
      })
    }
  } else {
    // User selected mockups, but also include raw artwork files for reference
    console.log(`[Mockup] Adding raw artwork files as reference...`)
    for (const df of order.design_files || []) {
      const artworkSignedUrl = await signedUrl(process.env.BUCKET_DESIGN!, df.storage_path, 3600)
      files.push({
        filename: df.filename,
        placement: `${df.placement} (Artwork)`,
        url: artworkSignedUrl
      })
    }
  }

  console.log(`[generateProof] Prepared ${files.length} files for PDF (mockups + originals)`)

  // Render PDF
  console.log(`[generateProof] Starting PDF render...`)
  const pdfBuffer = await renderProofPdf({
    order,
    customer: order.customer,
    files: files.map(f => ({
      ...f,
      needsDigitizing: order.needs_digitizing || false
    })),
    watermark: 'PROOF - NOT FOR PRODUCTION',
    version,
    designedBy66: order.designed_by_66 || false
  })
  console.log(`[generateProof] PDF rendered, size: ${pdfBuffer.length} bytes`)

  // Upload to storage
  const pdfPath = `${orderId}/v${version}/proof.pdf`
  console.log(`[generateProof] Uploading PDF to:`, pdfPath)
  await uploadBuffer(process.env.BUCKET_PROOFS!, pdfPath, pdfBuffer)
  console.log(`[generateProof] PDF uploaded successfully`)

  // Create signed URL
  const pdfSignedUrl = await signedUrl(process.env.BUCKET_PROOFS!, pdfPath, 86400) // 24h
  console.log(`[generateProof] Signed URL created`)

  // Insert proof record
  console.log(`[generateProof] Inserting proof record...`)
  const { data: proof, error: proofError } = await supabaseAdmin
    .from('proofs')
    .insert({
      order_id: orderId,
      version,
      pdf_path: pdfPath,
      pdf_signed_url: pdfSignedUrl,
      status: 'ready',
      notes: notes || null
    })
    .select()
    .single()

  if (proofError) {
    console.error(`[generateProof] Proof insert error:`, proofError)
    throw new Error(`Failed to create proof record: ${proofError.message}`)
  }

  console.log(`[generateProof] Proof record created:`, proof.id)
  return proof
}
