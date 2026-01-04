export default {
  async fetch(request, env, ctx) {
    return new Response("Evidence Email Worker is running.", {
      status: 200,
      headers: { "Content-Type": "text/plain" }
    });
  },

  async email(message, env, ctx) {
    var webhookUrl = "https://www.autopilotamerica.com/api/webhooks/evidence-email";
    var backupEmail = "hiautopilotamerica@gmail.com";

    console.log("Received email from: " + message.from + " to: " + message.to);
    console.log("Subject: " + message.headers.get("subject"));

    try {
      var rawEmail = await streamToString(message.raw);
      var parsedEmail = parseEmail(rawEmail, message.headers);

      var webhookPayload = {
        type: "email.received",
        data: {
          from: message.from,
          to: message.to,
          subject: message.headers.get("subject") || "(no subject)",
          text: parsedEmail.textBody,
          html: parsedEmail.htmlBody,
          attachments: parsedEmail.attachments,
          received_at: new Date().toISOString()
        }
      };

      console.log("Text body length: " + parsedEmail.textBody.length);
      console.log("Attachments: " + parsedEmail.attachments.length);

      var response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Cloudflare-Email-Worker": env.WEBHOOK_SECRET || "cloudflare-evidence-worker"
        },
        body: JSON.stringify(webhookPayload)
      });

      console.log("Webhook response: " + response.status);

    } catch (error) {
      console.error("Error processing email: " + error.message);
    }

    try {
      await message.forward(backupEmail);
      console.log("Forwarded to " + backupEmail);
    } catch (forwardError) {
      console.error("Failed to forward: " + forwardError.message);
    }
  }
};

async function streamToString(stream) {
  var reader = stream.getReader();
  var decoder = new TextDecoder();
  var result = "";

  while (true) {
    var chunk = await reader.read();
    if (chunk.done) break;
    result += decoder.decode(chunk.value, { stream: true });
  }
  result += decoder.decode();
  return result;
}

function parseEmail(rawEmail, headers) {
  var contentType = headers.get("content-type") || "text/plain";
  var result = { textBody: "", htmlBody: "", attachments: [] };

  var boundaryMatch = contentType.match(/boundary=["']?([^"';\s]+)["']?/i);

  if (boundaryMatch) {
    var boundary = boundaryMatch[1];
    var escapedBoundary = boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    var regex = new RegExp("--" + escapedBoundary);
    var parts = rawEmail.split(regex);

    for (var i = 0; i < parts.length; i++) {
      var part = parts[i];
      if (part.trim() === "" || part.trim() === "--") continue;

      var headerBodySplit = part.indexOf("\r\n\r\n");
      if (headerBodySplit === -1) continue;

      var partHeaders = part.substring(0, headerBodySplit);
      var partBody = part.substring(headerBodySplit + 4);

      var partContentType = getHeader(partHeaders, "content-type") || "text/plain";
      var contentDisposition = getHeader(partHeaders, "content-disposition") || "";
      var transferEncoding = getHeader(partHeaders, "content-transfer-encoding") || "";

      if (contentDisposition.indexOf("attachment") !== -1 || contentDisposition.indexOf("filename") !== -1) {
        var filenameMatch = contentDisposition.match(/filename=["']?([^"';\s]+)["']?/i);
        result.attachments.push({
          filename: filenameMatch ? filenameMatch[1] : "attachment",
          content_type: partContentType.split(";")[0].trim(),
          content: partBody.replace(/\r?\n--.*$/s, "").trim(),
          encoding: transferEncoding.toLowerCase()
        });
      } else if (partContentType.indexOf("text/plain") !== -1 && !result.textBody) {
        result.textBody = decodeBody(partBody, transferEncoding);
      } else if (partContentType.indexOf("text/html") !== -1 && !result.htmlBody) {
        result.htmlBody = decodeBody(partBody, transferEncoding);
      } else if (partContentType.indexOf("multipart/alternative") !== -1) {
        var nested = parseEmail(part, new Headers([["content-type", partContentType]]));
        if (!result.textBody) result.textBody = nested.textBody;
        if (!result.htmlBody) result.htmlBody = nested.htmlBody;
      }
    }
  } else {
    var headerBodySplit2 = rawEmail.indexOf("\r\n\r\n");
    if (headerBodySplit2 !== -1) {
      var body = rawEmail.substring(headerBodySplit2 + 4);
      var transferEncoding2 = headers.get("content-transfer-encoding") || "";
      if (contentType.indexOf("text/html") !== -1) {
        result.htmlBody = decodeBody(body, transferEncoding2);
      } else {
        result.textBody = decodeBody(body, transferEncoding2);
      }
    }
  }

  result.textBody = cleanEmailBody(result.textBody);
  return result;
}

function getHeader(headers, name) {
  var regex = new RegExp("^" + name + ":\\s*(.+)", "im");
  var match = headers.match(regex);
  return match ? match[1].trim() : null;
}

function decodeBody(body, encoding) {
  body = body.replace(/\r?\n--.*$/s, "").trim();
  encoding = (encoding || "").toLowerCase().trim();

  if (encoding === "base64") {
    try { return atob(body.replace(/\s/g, "")); } catch (e) { return body; }
  } else if (encoding === "quoted-printable") {
    return body
      .replace(/=\r?\n/g, "")
      .replace(/=([0-9A-Fa-f]{2})/g, function(m, hex) { return String.fromCharCode(parseInt(hex, 16)); });
  }
  return body;
}

function cleanEmailBody(text) {
  if (!text) return "";
  var lines = text.split("\n");
  var clean = [];

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (/^On .+ wrote:$/i.test(line)) break;
    if (/^-+\s*Original Message/i.test(line)) break;
    if (/^From:.*@/i.test(line)) break;
    if (line.charAt(0) !== ">") clean.push(line);
  }
  return clean.join("\n").trim();
}
