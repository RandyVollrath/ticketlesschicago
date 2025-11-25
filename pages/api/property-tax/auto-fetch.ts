import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { chromium } from 'playwright'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface FetchResult {
  success: boolean
  pdfUrl?: string
  propertyInfo?: {
    pin: string
    address: string
    owner: string
    taxYear: string
  }
  error?: string
  fallbackUrl?: string
}

/**
 * Auto-fetch property tax bill from Cook County Treasurer
 * POST /api/property-tax/auto-fetch
 * Body: { userId: string, address: string }
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<FetchResult>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  const { userId, address } = req.body

  if (!userId || !address) {
    return res.status(400).json({
      success: false,
      error: 'userId and address are required'
    })
  }

  console.log(`🏠 Property Tax Auto-Fetch for user ${userId}`)
  console.log(`   Address: ${address}`)

  // Parse the address to extract components
  const addressParts = parseChicagoAddress(address)
  if (!addressParts) {
    return res.status(400).json({
      success: false,
      error: 'Could not parse address. Please ensure it\'s a valid Chicago address.',
      fallbackUrl: 'https://www.cookcountypropertyinfo.com'
    })
  }

  let browser = null

  try {
    console.log('🌐 Launching browser...')

    // Launch browser - use headless for production
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    })

    const page = await browser.newPage({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    })

    // Navigate to Cook County Property Info Portal (better than treasurer site)
    console.log('📄 Navigating to Cook County Property Info Portal...')
    await page.goto('https://www.cookcountypropertyinfo.com', {
      waitUntil: 'networkidle',
      timeout: 30000
    })

    // Wait for page to load
    await page.waitForTimeout(2000)

    // Look for address search option and click it
    console.log('🔍 Looking for address search option...')

    // Try to find and click the "Search By Property Address" radio button or link
    const addressSearchOption = await page.$('text=Search By Property Address')
    if (addressSearchOption) {
      await addressSearchOption.click()
      await page.waitForTimeout(1000)
    }

    // Try to find address input fields
    // Cook County uses a specific form structure - look for common field patterns
    const houseNumField = await page.$('input[id*="HouseNum"], input[name*="house"], input[placeholder*="House"]')
    const streetNameField = await page.$('input[id*="Street"], input[name*="street"], input[placeholder*="Street"]')

    if (houseNumField && streetNameField) {
      console.log('📝 Filling address fields...')
      await houseNumField.fill(addressParts.houseNumber)
      await streetNameField.fill(addressParts.streetName)

      // Look for search button
      const searchButton = await page.$('input[type="submit"], button[type="submit"], button:has-text("Search")')
      if (searchButton) {
        await searchButton.click()
        await page.waitForTimeout(3000)
      }
    } else {
      // Try filling a combined address field if available
      const addressField = await page.$('input[id*="Address"], input[name*="address"]')
      if (addressField) {
        await addressField.fill(address)
        const searchButton = await page.$('input[type="submit"], button[type="submit"]')
        if (searchButton) {
          await searchButton.click()
          await page.waitForTimeout(3000)
        }
      }
    }

    // Check if we got results
    const pageContent = await page.content()

    // Look for property results
    if (pageContent.includes('No results found') || pageContent.includes('no records')) {
      throw new Error('No property found for this address')
    }

    // Look for tax bill link
    console.log('📋 Looking for tax bill...')
    const taxBillLink = await page.$('a:has-text("Tax Bill"), a:has-text("View Bill"), a[href*="taxbill"], a[href*=".pdf"]')

    if (taxBillLink) {
      const pdfUrl = await taxBillLink.getAttribute('href')

      if (pdfUrl) {
        console.log('📥 Downloading tax bill PDF...')

        // Download the PDF
        const pdfResponse = await page.goto(pdfUrl.startsWith('http') ? pdfUrl : `https://www.cookcountytreasurer.com${pdfUrl}`)
        const pdfBuffer = await pdfResponse?.body()

        if (pdfBuffer) {
          // Upload to Supabase
          const fileName = `property-tax-${userId}-${Date.now()}.pdf`
          const filePath = `residency-proofs/${fileName}`

          const { error: uploadError } = await supabase.storage
            .from('residency-proofs-temps')
            .upload(filePath, pdfBuffer, {
              contentType: 'application/pdf'
            })

          if (uploadError) {
            throw new Error(`Failed to save tax bill: ${uploadError.message}`)
          }

          // Get public URL
          const { data: urlData } = supabase.storage
            .from('residency-proofs-temps')
            .getPublicUrl(filePath)

          // Update user profile
          await supabase
            .from('user_profiles')
            .update({
              residency_proof_path: urlData.publicUrl,
              residency_proof_type: 'property_tax',
              residency_proof_uploaded_at: new Date().toISOString()
            })
            .eq('user_id', userId)

          console.log('✅ Tax bill fetched and saved successfully!')

          await browser.close()

          return res.status(200).json({
            success: true,
            pdfUrl: urlData.publicUrl,
            propertyInfo: {
              pin: 'extracted-from-page',
              address: address,
              owner: 'extracted-from-page',
              taxYear: new Date().getFullYear().toString()
            }
          })
        }
      }
    }

    // If we couldn't find a direct PDF link, try the property overview page
    console.log('🔄 Trying alternative approach...')

    // Look for any property result link
    const propertyLink = await page.$('a[href*="yourpropertytaxoverview"], a[href*="pin="]')
    if (propertyLink) {
      await propertyLink.click()
      await page.waitForTimeout(3000)

      // Now look for tax bill download on the property page
      const downloadLink = await page.$('a:has-text("Download"), a:has-text("Tax Bill"), a[href*=".pdf"]')
      if (downloadLink) {
        const href = await downloadLink.getAttribute('href')
        if (href) {
          // Try to download
          const pdfResponse = await page.goto(href.startsWith('http') ? href : `https://www.cookcountytreasurer.com${href}`)
          const pdfBuffer = await pdfResponse?.body()

          if (pdfBuffer) {
            const fileName = `property-tax-${userId}-${Date.now()}.pdf`
            const filePath = `residency-proofs/${fileName}`

            await supabase.storage
              .from('residency-proofs-temps')
              .upload(filePath, pdfBuffer, { contentType: 'application/pdf' })

            const { data: urlData } = supabase.storage
              .from('residency-proofs-temps')
              .getPublicUrl(filePath)

            await supabase
              .from('user_profiles')
              .update({
                residency_proof_path: urlData.publicUrl,
                residency_proof_type: 'property_tax',
                residency_proof_uploaded_at: new Date().toISOString()
              })
              .eq('user_id', userId)

            await browser.close()

            return res.status(200).json({
              success: true,
              pdfUrl: urlData.publicUrl
            })
          }
        }
      }
    }

    // If all else fails, return the search URL for manual fallback
    throw new Error('Could not automatically retrieve tax bill. The site may require CAPTCHA verification.')

  } catch (error: any) {
    console.error('❌ Auto-fetch error:', error.message)

    if (browser) {
      await browser.close()
    }

    return res.status(400).json({
      success: false,
      error: error.message || 'Failed to fetch tax bill',
      fallbackUrl: 'https://www.cookcountypropertyinfo.com'
    })
  }
}

/**
 * Parse a Chicago address into components
 */
function parseChicagoAddress(address: string): { houseNumber: string; direction: string; streetName: string; streetType: string } | null {
  // Handle various address formats:
  // "1234 N Main St"
  // "1234 North Main Street"
  // "1234 N. Main St."

  const cleaned = address.trim().toUpperCase()

  // Regex to match address components
  const match = cleaned.match(/^(\d+)\s*(N|S|E|W|NORTH|SOUTH|EAST|WEST)?\.?\s+(.+)$/i)

  if (!match) {
    return null
  }

  const houseNumber = match[1]
  let direction = match[2] || ''
  const streetPart = match[3]

  // Normalize direction
  const directionMap: Record<string, string> = {
    'NORTH': 'N',
    'SOUTH': 'S',
    'EAST': 'E',
    'WEST': 'W'
  }
  direction = directionMap[direction] || direction

  // Extract street name and type
  const streetTypes = ['ST', 'STREET', 'AVE', 'AVENUE', 'BLVD', 'BOULEVARD', 'DR', 'DRIVE', 'RD', 'ROAD', 'CT', 'COURT', 'PL', 'PLACE', 'WAY', 'LN', 'LANE', 'TER', 'TERRACE', 'PKWY', 'PARKWAY']

  let streetName = streetPart
  let streetType = ''

  for (const type of streetTypes) {
    const typeRegex = new RegExp(`\\b${type}\\.?$`, 'i')
    if (streetPart.match(typeRegex)) {
      streetType = type.replace('.', '')
      streetName = streetPart.replace(typeRegex, '').trim()
      break
    }
  }

  return {
    houseNumber,
    direction,
    streetName,
    streetType
  }
}

// Increase timeout for this API route (Vercel)
export const config = {
  api: {
    responseLimit: false,
    bodyParser: {
      sizeLimit: '1mb'
    }
  },
  maxDuration: 60 // 60 seconds timeout
}
