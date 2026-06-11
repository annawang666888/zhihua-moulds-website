function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function required(value) {
  return typeof value === "string" && value.trim().length > 0;
}

async function parseBody(request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return await request.json();
  const form = await request.formData();
  return Object.fromEntries(form.entries());
}

async function verifyTurnstile(token, secret, request) {
  if (!secret) {
    console.error("TURNSTILE_SECRET_KEY is not configured.");
    return false;
  }
  if (!token) return false;

  const formData = new FormData();
  formData.append("secret", secret);
  formData.append("response", token);
  const ip = request.headers.get("cf-connecting-ip");
  if (ip) formData.append("remoteip", ip);

  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: formData
    });
    const result = await response.json();
    if (!result.success) {
      console.error("Turnstile verification failed", JSON.stringify(result));
    }
    return Boolean(result.success);
  } catch (error) {
    console.error("Turnstile verification error", error);
    return false;
  }
}

function buildEmailHtml(inquiry) {
  const rows = [
    ["Name", inquiry.name],
    ["Company", inquiry.company],
    ["Country", inquiry.country],
    ["Email", inquiry.email],
    ["Phone / WhatsApp", inquiry.phone],
    ["Product", inquiry.product],
    ["Estimated Quantity", inquiry.quantity],
    ["Estimated Budget", inquiry.budget],
    ["Source Page", inquiry.source_page],
    ["UTM Source", inquiry.utm_source],
    ["UTM Medium", inquiry.utm_medium],
    ["UTM Campaign", inquiry.utm_campaign],
    ["Submitted At", inquiry.submitted_at],
    ["Visitor Country", inquiry.ip_country]
  ];

  const tableRows = rows.map(([label, value]) => `
    <tr>
      <th style="text-align:left;padding:8px 10px;border-bottom:1px solid #e5e7eb;background:#f8fafc;width:180px;">${escapeHtml(label)}</th>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">${escapeHtml(value) || "-"}</td>
    </tr>
  `).join("");

  return `
    <div style="font-family:Arial,sans-serif;color:#111827;line-height:1.6;">
      <h2 style="margin:0 0 12px;color:#0f172a;">New website inquiry from zhihuamoulds.com</h2>
      <p style="margin:0 0 16px;color:#475569;">A visitor submitted the official contact form.</p>
      <table style="border-collapse:collapse;width:100%;max-width:760px;border:1px solid #e5e7eb;">${tableRows}</table>
      <h3 style="margin:20px 0 8px;color:#0f172a;">Message / Specifications</h3>
      <div style="white-space:pre-wrap;padding:12px;border:1px solid #e5e7eb;background:#f8fafc;border-radius:6px;">${escapeHtml(inquiry.message)}</div>
      <p style="margin-top:18px;color:#475569;">Reply to customer email: <a href="mailto:${escapeHtml(inquiry.email)}">${escapeHtml(inquiry.email)}</a></p>
    </div>
  `;
}

function buildEmailText(inquiry) {
  return [
    "New website inquiry from zhihuamoulds.com",
    "",
    `Name: ${inquiry.name}`,
    `Company: ${inquiry.company}`,
    `Country: ${inquiry.country}`,
    `Email: ${inquiry.email}`,
    `Phone / WhatsApp: ${inquiry.phone}`,
    `Product: ${inquiry.product}`,
    `Estimated Quantity: ${inquiry.quantity}`,
    `Estimated Budget: ${inquiry.budget}`,
    "",
    "Message / Specifications:",
    inquiry.message,
    "",
    `Source Page: ${inquiry.source_page}`,
    `UTM Source: ${inquiry.utm_source}`,
    `UTM Medium: ${inquiry.utm_medium}`,
    `UTM Campaign: ${inquiry.utm_campaign}`,
    `Submitted At: ${inquiry.submitted_at}`,
    `Visitor Country: ${inquiry.ip_country}`
  ].join("\n");
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let data;
  try {
    data = await parseBody(request);
  } catch (error) {
    return json({ ok: false, message: "Invalid form data." }, 400);
  }

  const inquiry = {
    name: String(data.name || "").trim(),
    company: String(data.company || "").trim(),
    country: String(data.country || "").trim(),
    email: String(data.email || "").trim(),
    phone: String(data.phone || "").trim(),
    product: String(data.product || "").trim(),
    quantity: String(data.quantity || "").trim(),
    budget: String(data.budget || "").trim(),
    message: String(data.message || "").trim(),
    source_page: String(data.source_page || request.headers.get("referer") || "").trim(),
    utm_source: String(data.utm_source || "").trim(),
    utm_medium: String(data.utm_medium || "").trim(),
    utm_campaign: String(data.utm_campaign || "").trim(),
    submitted_at: new Date().toISOString(),
    ip_country: request.headers.get("cf-ipcountry") || "",
  };

  const errors = {};
  if (!required(inquiry.name)) errors.name = "Name is required.";
  if (!required(inquiry.email) || !/^\S+@\S+\.\S+$/.test(inquiry.email)) errors.email = "Valid email is required.";
  if (!required(inquiry.phone)) errors.phone = "Phone / WhatsApp is required.";
  if (!required(inquiry.message)) errors.message = "Message is required.";
  if (Object.keys(errors).length) return json({ ok: false, errors, message: "Please fill in the required fields." }, 400);

  // Honeypot: if the hidden website field is filled by bots, reject silently.
  if (data.website) return json({ ok: true, message: "Thank you! Your inquiry has been submitted successfully." });

  const turnstileToken = String(data["cf-turnstile-response"] || "").trim();
  const turnstileOk = await verifyTurnstile(turnstileToken, env.TURNSTILE_SECRET_KEY, request);
  if (!turnstileOk) {
    return json({ ok: false, message: "Please complete the anti-spam check, then submit again." }, 403);
  }

  const resendApiKey = env.RESEND_API_KEY;
  const toEmail = env.INQUIRY_TO_EMAIL || "354909745@qq.com";
  const fromEmail = env.INQUIRY_FROM_EMAIL || "Zhihua Moulds <noreply@zhihuamoulds.com>";

  if (!resendApiKey) {
    console.error("RESEND_API_KEY is not configured.");
    return json({ ok: false, message: "Submit failed. Please contact us by WhatsApp or email." }, 500);
  }

  const subjectName = inquiry.name ? ` from ${inquiry.name}` : "";
  const payload = {
    from: fromEmail,
    to: [toEmail],
    reply_to: inquiry.email,
    subject: `New Zhihua Moulds inquiry${subjectName}`,
    html: buildEmailHtml(inquiry),
    text: buildEmailText(inquiry)
  };

  let resendResponse;
  try {
    resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "authorization": `Bearer ${resendApiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    console.error("Resend network error", error);
    return json({ ok: false, message: "Submit failed. Please contact us by WhatsApp or email." }, 502);
  }

  if (!resendResponse.ok) {
    const detail = await resendResponse.text().catch(() => "");
    console.error("Resend email failed", resendResponse.status, detail.slice(0, 1000));
    return json({ ok: false, message: "Submit failed. Please contact us by WhatsApp or email." }, 502);
  }

  return json({ ok: true, message: "Thank you! Your inquiry has been submitted successfully. We will contact you within 24 hours." });
}

export async function onRequestGet() {
  return json({ ok: true, message: "Inquiry endpoint is running. Use POST to submit." });
}
