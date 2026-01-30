/**
 * Cloudflare Email Worker for Evidence Emails
 *
 * This worker receives emails sent to evidence@autopilotamerica.com,
 * forwards them to your webhook for processing, and also forwards
 * to Gmail as a backup.
 *
 * SETUP INSTRUCTIONS:
 * 1. Go to Cloudflare Dashboard → Workers & Pages → Create Worker
 * 2. Name it: evidence-email-worker
 * 3. Paste this code
 * 4. Add environment variable: WEBHOOK_SECRET (generate a random string)
 * 5. Go to Email → Email Routing → Email Workers tab
 * 6. Click "Create" and select your worker
 * 7. Update evidence@autopilotamerica.com to use this worker:
 *    - Go to Email Routing → Routing Rules
 *    - Edit evidence@autopilotamerica.com
 *    - Change action from "Send to email" to "Send to Worker"
 *    - Select evidence-email-worker
 *
 * Also add the same WEBHOOK_SECRET value to Vercel as CLOUDFLARE_EMAIL_WORKER_SECRET
 */

export default {
  async email(message, env, ctx) {
    const webhookUrl = 'https://ticketlessamerica.com/api/webhooks/evidence-email';
    const backupEmail = 'hiautopilotamerica@gmail.com';

    console.log(`Received email from: ${message.from} to: ${message.to}`);
    console.log(`Subject: ${message.headers.get('subject')}`);

    try {
      // Read the raw email content
      const rawEmail = await streamToString(message.raw);

      // Parse the email to extract text body
      const parsedEmail = parseEmail(rawEmail, message.headers);

      // Build webhook payload (matching Resend's format for compatibility)
      const webhookPayload = {
        type: 'email.received',
        data: {
          from: message.from,
          to: message.to,
          subject: message.headers.get('subject') || '(no subject)',
          text: parsedEmail.textBody,
          html: parsedEmail.htmlBody,
          headers: Object.fromEntries(message.headers.entries()),
          attachments: parsedEmail.attachments,
          raw_size: message.rawSize,
          received_at: new Date().toISOString(),
        }
      };

      console.log(`Sending to webhook: ${webhookUrl}`);
      console.log(`Text body length: ${parsedEmail.textBody.length}`);
      console.log(`Attachments: ${parsedEmail.attachments.length}`);
      for (const att of parsedEmail.attachments) {
        console.log(`  Attachment: ${att.filename} (${att.content_type}, encoding: ${att.encoding}, content length: ${att.content?.length || 0})`);
      }

      // POST to webhook
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Cloudflare-Email-Worker': env.WEBHOOK_SECRET || 'cloudflare-evidence-worker',
        },
        body: JSON.stringify(webhookPayload),
      });

      console.log(`Webhook response: ${response.status}`);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Webhook error: ${errorText}`);
      }

    } catch (error) {
      console.error(`Error processing email: ${error.message}`);
      // Continue to forward even if webhook fails
    }

    // Always forward to Gmail as backup
    try {
      await message.forward(backupEmail);
      console.log(`Forwarded to ${backupEmail}`);
    } catch (forwardError) {
      console.error(`Failed to forward: ${forwardError.message}`);
    }
  }
};

/**
 * Convert ReadableStream to ArrayBuffer then to string using Latin-1 encoding
 * This preserves binary data (like image attachments) that would be corrupted by UTF-8
 */
async function streamToString(stream) {
  const reader = stream.getReader();
  const chunks = [];
  let totalLength = 0;

  // Read all chunks as raw bytes
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalLength += value.length;
  }

  // Combine all chunks into a single Uint8Array
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  // Convert to string using Latin-1 (ISO-8859-1) which preserves all byte values 0-255
  // This is critical for binary attachments - UTF-8 would corrupt them
  let result = '';
  for (let i = 0; i < combined.length; i++) {
    result += String.fromCharCode(combined[i]);
  }

  return result;
}

/**
 * Parse email content to extract text body, HTML body, and attachments
 * This is a simplified parser for common email formats
 */
function parseEmail(rawEmail, headers, depth = 0) {
  const contentType = headers.get('content-type') || 'text/plain';
  const result = {
    textBody: '',
    htmlBody: '',
    attachments: [],
  };

  // Guard against infinite recursion
  if (depth > 5) {
    console.error('parseEmail: max recursion depth exceeded, stopping');
    return result;
  }

  // Check if multipart
  const boundaryMatch = contentType.match(/boundary=["']?([^"';\s]+)["']?/i);

  if (boundaryMatch) {
    // Multipart email
    const boundary = boundaryMatch[1];
    const parts = rawEmail.split(new RegExp(`--${escapeRegex(boundary)}`));

    for (const part of parts) {
      if (part.trim() === '' || part.trim() === '--') continue;

      // Split headers from body
      const headerBodySplit = part.indexOf('\r\n\r\n');
      if (headerBodySplit === -1) continue;

      const partHeaders = part.substring(0, headerBodySplit);
      let partBody = part.substring(headerBodySplit + 4);

      // Get content type of this part
      const partContentType = getHeader(partHeaders, 'content-type') || 'text/plain';
      const contentDisposition = getHeader(partHeaders, 'content-disposition') || '';
      const contentTransferEncoding = getHeader(partHeaders, 'content-transfer-encoding') || '';

      // Check if it's an attachment or an image/file part
      // Detect attachments by:
      // 1. Content-Disposition contains "attachment" or "filename"
      // 2. Content-Type is an image/*, application/pdf, or other file type (inline images from phones)
      // 3. Content-Type has a name= parameter (some clients put filename here)
      const mimeType = partContentType.split(';')[0].trim().toLowerCase();
      const isExplicitAttachment = contentDisposition.includes('attachment') || contentDisposition.includes('filename');
      const isImagePart = mimeType.startsWith('image/');
      const isPdfPart = mimeType === 'application/pdf';
      const hasNameInContentType = partContentType.match(/name=["']?([^"';\s]+)["']?/i);
      const isFilePart = isExplicitAttachment || isImagePart || isPdfPart || !!hasNameInContentType;

      if (isFilePart) {
        // Extract filename from Content-Disposition or Content-Type name= parameter
        const filenameMatch = contentDisposition.match(/filename=["']?([^"';\s]+)["']?/i)
          || partContentType.match(/name=["']?([^"';\s]+)["']?/i);
        const filename = filenameMatch ? filenameMatch[1] : `attachment.${mimeType.split('/')[1] || 'bin'}`;

        // Clean up the body (remove trailing boundary markers)
        partBody = partBody.replace(/\r?\n--.*$/, '').trim();

        result.attachments.push({
          filename: filename,
          content_type: mimeType,
          content: partBody, // Base64 or raw content
          encoding: contentTransferEncoding.toLowerCase(),
        });
      } else if (partContentType.includes('text/plain')) {
        result.textBody = decodeBody(partBody, contentTransferEncoding);
      } else if (partContentType.includes('text/html')) {
        result.htmlBody = decodeBody(partBody, contentTransferEncoding);
      } else if (partContentType.includes('multipart/')) {
        // Nested multipart - recursively parse using partBody (not part, which
        // includes redundant headers and can cause infinite recursion)
        const nestedBoundaryMatch = partContentType.match(/boundary=["']?([^"';\s]+)["']?/i);
        if (nestedBoundaryMatch) {
          const nestedResult = parseEmail(partBody, new Headers([['content-type', partContentType]]), depth + 1);
          if (!result.textBody && nestedResult.textBody) result.textBody = nestedResult.textBody;
          if (!result.htmlBody && nestedResult.htmlBody) result.htmlBody = nestedResult.htmlBody;
          result.attachments.push(...nestedResult.attachments);
        }
      }
    }
  } else {
    // Simple single-part email
    const headerBodySplit = rawEmail.indexOf('\r\n\r\n');
    if (headerBodySplit !== -1) {
      const body = rawEmail.substring(headerBodySplit + 4);
      const transferEncoding = headers.get('content-transfer-encoding') || '';

      if (contentType.includes('text/html')) {
        result.htmlBody = decodeBody(body, transferEncoding);
      } else {
        result.textBody = decodeBody(body, transferEncoding);
      }
    }
  }

  // Clean up text body - remove quoted replies and signatures
  result.textBody = cleanEmailBody(result.textBody);

  return result;
}

/**
 * Get a header value from raw header string
 * Handles MIME header folding (continuation lines starting with whitespace)
 */
function getHeader(headers, name) {
  const regex = new RegExp(`^${name}:\\s*(.+(?:\\r?\\n[ \\t]+.+)*)`, 'im');
  const match = headers.match(regex);
  if (!match) return null;
  // Unfold the header by replacing line breaks + whitespace with a single space
  return match[1].replace(/\r?\n[ \t]+/g, ' ').trim();
}

/**
 * Decode email body based on transfer encoding
 */
function decodeBody(body, encoding) {
  encoding = encoding.toLowerCase().trim();

  // Remove trailing boundary markers
  body = body.replace(/\r?\n--.*$/s, '').trim();

  if (encoding === 'base64') {
    try {
      return atob(body.replace(/\s/g, ''));
    } catch {
      return body;
    }
  } else if (encoding === 'quoted-printable') {
    return decodeQuotedPrintable(body);
  }

  return body;
}

/**
 * Decode quoted-printable encoding
 */
function decodeQuotedPrintable(str) {
  return str
    .replace(/=\r?\n/g, '') // Remove soft line breaks
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/**
 * Clean email body - remove quoted replies and common signatures
 */
function cleanEmailBody(text) {
  if (!text) return '';

  // Remove lines starting with > (quoted replies)
  const lines = text.split('\n');
  const cleanLines = [];
  let inQuote = false;

  for (const line of lines) {
    // Detect start of quoted content
    if (line.match(/^On .+ wrote:$/i) ||
        line.match(/^-+\s*Original Message\s*-+$/i) ||
        line.match(/^From:/i) && line.includes('@')) {
      inQuote = true;
    }

    if (!inQuote && !line.startsWith('>')) {
      cleanLines.push(line);
    }
  }

  return cleanLines.join('\n').trim();
}

/**
 * Escape special regex characters
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
