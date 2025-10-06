import mustache from 'mustache'
import fs from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

type RenderInput = {
  order: any
  customer: any
  files: { filename: string; placement?: string; url: string; needsDigitizing?: boolean }[]
  watermark: string
  version: number
  designedBy66?: boolean
}

export async function renderProofPdf(input: RenderInput): Promise<Buffer> {
  const templatePath = path.join(process.cwd(), 'src', 'templates', 'proof-template.html')
  const template = await fs.readFile(templatePath, 'utf8')
  const html = mustache.render(template, input)

  const browser = await chromium.launch({ args: ['--no-sandbox'] })
  const page = await browser.newPage({ viewport: { width: 1200, height: 1600 } })
  await page.setContent(html, { waitUntil: 'networkidle' })
  const pdf = await page.pdf({
    format: 'Letter',
    printBackground: true,
    margin: { top: '0.5in', bottom: '0.5in', left: '0.5in', right: '0.5in' }
  })
  await browser.close()
  return pdf
}
