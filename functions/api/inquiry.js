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
  if (Object.keys(errors).length) return json({ ok: false, errors }, 400);

  // Honeypot: if a hidden website field is added later and filled by bots, reject silently.
  if (data.website) return json({ ok: true });

  const subject = `New inquiry from ${inquiry.name} - Zhihua Moulds`;
  const html = `
    <h2>New Zhihua Moulds Inquiry</h2>
    <p><strong>Name:</strong> ${escapeHtml(inquiry.name)}</p>
    <p><strong>Company:</strong> ${escapeHtml(inquiry.company)}</p>
    <p><strong>Country:</strong> ${escapeHtml(inquiry.country)}</p>
    <p><strong>Email:</strong> ${escapeHtml(inquiry.email)}</p>
    <p><strong>Phone / WhatsApp:</strong> ${escapeHtml(inquiry.phone)}</p>
    <p><strong>Product:</strong> ${escapeHtml(inquiry.product)}</p>
    <p><strong>Quantity:</strong> ${escapeHtml(inquiry.quantity)}</p>
    <p><strong>Budget:</strong> ${escapeHtml(inquiry.budget)}</p>
    <p><strong>Message:</strong><br>${escapeHtml(inquiry.message).replaceAll("\n", "<br>")}</p>
    <hr>
    <p><strong>Source page:</strong> ${escapeHtml(inquiry.source_page)}</p>
    <p><strong>UTM:</strong> ${escapeHtml([inquiry.utm_source, inquiry.utm_medium, inquiry.utm_campaign].filter(Boolean).join(" / "))}</p>
    <p><strong>Submitted at:</strong> ${escapeHtml(inquiry.submitted_at)}</p>
    <p><strong>IP country:</strong> ${escapeHtml(inquiry.ip_country)}</p>
  `;

  // Email via Resend. Set RESEND_API_KEY, INQUIRY_TO_EMAIL, and INQUIRY_FROM_EMAIL in Cloudflare Pages.
  if (env.RESEND_API_KEY && env.INQUIRY_TO_EMAIL && env.INQUIRY_FROM_EMAIL) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "authorization": `Bearer ${env.RESEND_API_KEY}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        from: env.INQUIRY_FROM_EMAIL,
        to: [env.INQUIRY_TO_EMAIL],
        reply_to: inquiry.email,
        subject,
        html
      })
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error("Resend failed", detail);
      return json({ ok: false, message: "Inquiry received but email notification failed. Please contact us by WhatsApp." }, 502);
    }
  } else {
    console.log("Inquiry received; email env vars are not configured yet.", inquiry);
  }

  return json({ ok: true, message: "Thank you! Your inquiry has been submitted successfully. We will contact you within 24 hours." });
}

export async function onRequestGet() {
  return json({ ok: true, message: "Inquiry endpoint is running. Use POST to submit." });
}
