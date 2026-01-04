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
      var parsedEmail = parseEmailSafe(rawEmail, message.headers);

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

function parseEmailSafe(rawEmail, headers) {
  var result = { textBody: "", htmlBody: "", attachments: [] };

  try {
    var contentType = headers.get("content-type") || "text/plain";
    var boundaryMatch = contentType.match(/boundary=["']?([^"';\s]+)["']?/i);

    if (boundaryMatch) {
      var boundary = boundaryMatch[1];
      var parts = rawEmail.split("--" + boundary);

      for (var i = 0; i < parts.length && i < 20; i++) {
        var part = parts[i];
        if (!part || part.trim() === "" || part.trim() === "--") continue;

        var splitIdx = part.indexOf("\r\n\r\n");
        if (splitIdx === -1) splitIdx = part.indexOf("\n\n");
        if (splitIdx === -1) continue;

        var partHeaders = part.substring(0, splitIdx).toLowerCase();
        var partBody = part.substring(splitIdx + 4);

        if (partHeaders.indexOf("content-disposition") !== -1 &&
            (partHeaders.indexOf("attachment") !== -1 || partHeaders.indexOf("filename") !== -1)) {
          var fnMatch = part.match(/filename=["']?([^"'\s;]+)["']?/i);
          var ctMatch = part.match(/content-type:\s*([^\s;]+)/i);
          result.attachments.push({
            filename: fnMatch ? fnMatch[1] : "attachment",
            content_type: ctMatch ? ctMatch[1] : "application/octet-stream",
            content: partBody.substring(0, 50000).trim(),
            encoding: partHeaders.indexOf("base64") !== -1 ? "base64" : "text"
          });
        } else if (partHeaders.indexOf("text/plain") !== -1 && !result.textBody) {
          result.textBody = decodeBodySafe(partBody, partHeaders);
        } else if (partHeaders.indexOf("text/html") !== -1 && !result.htmlBody) {
          result.htmlBody = decodeBodySafe(partBody, partHeaders);
        } else if (partHeaders.indexOf("multipart/alternative") !== -1) {
          var nestedBoundary = part.match(/boundary=["']?([^"';\s]+)["']?/i);
          if (nestedBoundary) {
            var nestedParts = partBody.split("--" + nestedBoundary[1]);
            for (var j = 0; j < nestedParts.length && j < 10; j++) {
              var np = nestedParts[j];
              if (!np) continue;
              var nSplit = np.indexOf("\r\n\r\n");
              if (nSplit === -1) nSplit = np.indexOf("\n\n");
              if (nSplit === -1) continue;
              var nHeaders = np.substring(0, nSplit).toLowerCase();
              var nBody = np.substring(nSplit + 4);
              if (nHeaders.indexOf("text/plain") !== -1 && !result.textBody) {
                result.textBody = decodeBodySafe(nBody, nHeaders);
              } else if (nHeaders.indexOf("text/html") !== -1 && !result.htmlBody) {
                result.htmlBody = decodeBodySafe(nBody, nHeaders);
              }
            }
          }
        }
      }
    } else {
      var splitIdx2 = rawEmail.indexOf("\r\n\r\n");
      if (splitIdx2 === -1) splitIdx2 = rawEmail.indexOf("\n\n");
      if (splitIdx2 !== -1) {
        var body = rawEmail.substring(splitIdx2 + 4);
        var encoding = headers.get("content-transfer-encoding") || "";
        if (contentType.indexOf("text/html") !== -1) {
          result.htmlBody = decodeBodySafe(body, encoding);
        } else {
          result.textBody = decodeBodySafe(body, encoding);
        }
      }
    }
  } catch (e) {
    console.error("Parse error: " + e.message);
    var fallbackSplit = rawEmail.indexOf("\r\n\r\n");
    if (fallbackSplit === -1) fallbackSplit = rawEmail.indexOf("\n\n");
    if (fallbackSplit !== -1) {
      result.textBody = rawEmail.substring(fallbackSplit + 4).substring(0, 10000);
    }
  }

  result.textBody = cleanBody(result.textBody);
  return result;
}

function decodeBodySafe(body, headersOrEncoding) {
  if (!body) return "";
  body = body.replace(/\r?\n--[^\n]*--?\s*$/s, "").trim();

  var isBase64 = typeof headersOrEncoding === "string"
    ? headersOrEncoding.indexOf("base64") !== -1
    : false;
  var isQP = typeof headersOrEncoding === "string"
    ? headersOrEncoding.indexOf("quoted-printable") !== -1
    : false;

  if (isBase64) {
    try {
      return atob(body.replace(/\s/g, ""));
    } catch (e) {
      return body;
    }
  } else if (isQP) {
    return body
      .replace(/=\r?\n/g, "")
      .replace(/=([0-9A-Fa-f]{2})/g, function(m, hex) {
        return String.fromCharCode(parseInt(hex, 16));
      });
  }
  return body;
}

function cleanBody(text) {
  if (!text) return "";
  var lines = text.split("\n");
  var clean = [];

  for (var i = 0; i < lines.length && i < 200; i++) {
    var line = lines[i];
    if (/^On .+ wrote:$/i.test(line)) break;
    if (/^-+\s*Original Message/i.test(line)) break;
    if (/^From:.*@/i.test(line)) break;
    if (line.charAt(0) !== ">") clean.push(line);
  }
  return clean.join("\n").trim().substring(0, 50000);
}
