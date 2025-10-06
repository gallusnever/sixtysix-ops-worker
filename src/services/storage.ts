import { supabaseAdmin } from './supabase'
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

export async function downloadToTmp(bucket: string, objectPath: string): Promise<string> {
  const { data, error } = await supabaseAdmin.storage.from(bucket).download(objectPath)
  if (error) throw error
  const buffer = Buffer.from(await data.arrayBuffer())
  const tmpDir = path.join(process.cwd(), 'tmp')
  await fs.mkdir(tmpDir, { recursive: true })
  const filePath = path.join(tmpDir, `${crypto.randomUUID()}-${path.basename(objectPath)}`)
  await fs.writeFile(filePath, buffer)
  return filePath
}

export async function uploadBuffer(bucket: string, objectPath: string, buf: Buffer, contentType = 'application/pdf') {
  const { error } = await supabaseAdmin.storage.from(bucket).upload(objectPath, buf, {
    upsert: true,
    contentType
  })
  if (error) throw error
}

export async function signedUrl(bucket: string, objectPath: string, expiresIn = 3600) {
  const { data, error } = await supabaseAdmin.storage.from(bucket).createSignedUrl(objectPath, expiresIn)
  if (error) throw error
  return data.signedUrl
}
