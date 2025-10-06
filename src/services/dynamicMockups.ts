/**
 * Dynamic Mockups API client
 * Docs: https://docs.dynamicmockups.com
 */

const BASE = 'https://app.dynamicmockups.com/api/v1'

export type RenderOpts = {
  mockup_uuid: string
  smart_object_uuid: string
  assetUrl: string // public (signed) URL to uploaded design
  export_label?: string
  image_format?: 'jpg' | 'png' | 'webp'
  image_size?: number // width px
  mode?: 'view' // view = return URL; default binary download
}

export type RenderResult = {
  url: string
  label: string
}

/**
 * Render a single mockup with one design file
 * https://docs.dynamicmockups.com/api-reference/endpoint/renders
 */
export async function renderSingle(opts: RenderOpts): Promise<RenderResult> {
  const apiKey = process.env.DYNAMIC_MOCKUPS_API_KEY
  if (!apiKey) {
    throw new Error('DYNAMIC_MOCKUPS_API_KEY not configured')
  }

  const body = {
    mockup_uuid: opts.mockup_uuid,
    export_label: opts.export_label ?? 'proof',
    export_options: {
      image_format: opts.image_format ?? (process.env.DYNAMIC_MOCKUPS_EXPORT_FORMAT as any) ?? 'jpg',
      image_size: opts.image_size ?? Number(process.env.DYNAMIC_MOCKUPS_EXPORT_SIZE ?? 1500),
      mode: 'view'
    },
    smart_objects: [
      {
        uuid: opts.smart_object_uuid,
        asset: { url: opts.assetUrl }
      }
    ]
  }

  console.log('[DynamicMockups] Rendering mockup:', opts.mockup_uuid)

  const response = await fetch(`${BASE}/renders`, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`DynamicMockups render failed (${response.status}): ${text}`)
  }

  const json = await response.json() as any
  const url = json?.data?.export_path
  if (!url) {
    throw new Error('DynamicMockups: no export_path in response')
  }

  console.log('[DynamicMockups] Render complete:', url)

  return { url, label: json?.data?.export_label ?? 'proof' }
}

/**
 * List available mockups from your library
 * https://docs.dynamicmockups.com/api-reference/endpoint/get-mockups
 */
export async function listMockups() {
  const apiKey = process.env.DYNAMIC_MOCKUPS_API_KEY
  if (!apiKey) {
    throw new Error('DYNAMIC_MOCKUPS_API_KEY not configured')
  }

  const response = await fetch(`${BASE}/mockups`, {
    method: 'GET',
    headers: {
      'x-api-key': apiKey,
      'Accept': 'application/json'
    }
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`DynamicMockups list failed (${response.status}): ${text}`)
  }

  const json = await response.json() as any
  return json?.data ?? []
}
