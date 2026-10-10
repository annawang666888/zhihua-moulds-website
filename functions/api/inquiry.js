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

// ---------------------------------------------------------------------------
// Lead persistence backup (Cloudflare KV binding: INQUIRY_KV)
// Every accepted inquiry is stored BEFORE the email is attempted and updated
// with the email result afterwards. If the mailbox/provider ever breaks, the
// leads are still retrievable at  GET /api/inquiry?key=LEADS_VIEW_KEY
// When the binding is absent (e.g. local dev) all store calls are no-ops.
// ---------------------------------------------------------------------------
async function saveLead(env, id, record) {
  if (!env.INQUIRY_KV) return;
  try {
    await env.INQUIRY_KV.put(`lead:${id}`, JSON.stringify(record), {
      expirationTtl: 31536000 // keep 1 year
    });
  } catch (error) {
    console.error("KV put failed", error);
  }
}

function newLeadId() {
  // Epoch-ms prefix sorts newest last in KV listing; random suffix dedupes.
  const rand = (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)).slice(0, 8);
  return `${Date.now()}-${rand}`;
}

function publicRecord(record) {
  // Never expose internal metadata tokens; KV only holds inquiry data anyway.
  return record;
}

// Content-level spam detector. These inquiries pass field validation (they
// fill name/email/phone/message) but carry no buying intent: phishing/jackpot
// lures, anonymous-link domains and giveaway language. Real buyers mention a
// product, size, quantity or application — never these patterns.
// Only block anonymous content hosts that never appear in a legitimate
// concrete-mould RFQ. Do NOT block trade channels (wa.me, t.me) or generic
// shorteners (bit.ly, tinyurl) — buyers legitimately share those for contacts
// or reference-photo links, and blocking them would cost real inquiries.
const SPAM_LINK_DOMAINS = [
  "telegra.ph",   // anonymous Telegram article host used in the jackpot scams
  "telegra.ac"    // Telegram telegra.ph mirror
];
const SPAM_PHRASES = [
  "promo code", "jackpot", "winner", "you won", "you have won", "claim your",
  "crypto airdrop", "airdrop", "btc", "usdt", "investment opportunity",
  "make money fast", "work from home", "loan offer", "quick loan",
  "casino", "betting tips", "hot singles", "adult dating", "get rich"
];
// Amount lures like "$25,000 promo" / "1,000,000 jackpot".
const MONEY_LURE = /\$\s?\d{1,3}(,\d{3})+|\d{1,3}(,\d{3}){2,}/i;

function looksLikeSpam(inquiry) {
  const hay = `${inquiry.message} ${inquiry.company} ${inquiry.name}`.toLowerCase();
  // Anonymous/phishing link domains in the message.
  for (const d of SPAM_LINK_DOMAINS) {
    if (d && hay.includes(d)) return true;
  }
  // Classic scam/giveaway phrases.
  for (const p of SPAM_PHRASES) {
    if (p && hay.includes(p)) return true;
  }
  // Big-money lures only count when paired with giveaway wording.
  if (MONEY_LURE.test(hay) && /(promo|jackpot|win|won|prize|reward|bonus|cash)/.test(hay)) {
    return true;
  }
  // Junk company names: bots fill company with a search engine / portal name.
  const company = (inquiry.company || "").toLowerCase().trim();
  if (["google", "facebook", "amazon", "microsoft", "apple", "test", "none"]
      .includes(company) && /http|promo|jackpot|win|prize|click|link/.test(hay)) {
    return true;
  }
  return false;
}

async function parseBody(request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return await request.json();
  const form = await request.formData();
  return Object.fromEntries(form.entries());
}

// Returns { ok, hardFail, status }.
// - status "verified" => a real Turnstile success verdict.
// - status "absent"   => NO token was submitted. This is ambiguous: it can be a
//   bot POSTing directly, OR a genuine buyer whose browser could not load the
//   widget — challenges.cloudflare.com is commonly unreachable on networks in
//   mainland China, so rejecting missing tokens silently discarded real leads.
//   We ACCEPT (honeypot + content filter still catch junk) and flag the lead
//   as unverified in KV so it can be reviewed manually.
// - status "invalid"  => a token WAS presented but Turnstile returned a clear
//   non-infra failure verdict => a bot/tampered request, REJECTED.
// - status "infra"    => configuration/service fault (bad secret, siteverify
//   down): FAIL OPEN so our own outage never blocks a real buyer.
async function verifyTurnstile(token, secret, request) {
  if (!secret) {
    console.error("TURNSTILE_SECRET_KEY is not configured; failing OPEN for genuine inquiries.");
    return { ok: true, hardFail: true, status: "infra" };
  }
  if (!token) {
    console.warn("Turnstile token missing on POST; accepting as unverified (widget blocked or direct POST). Honeypot/content filter still apply.");
    return { ok: true, hardFail: false, status: "absent" };
  }

  const formData = new FormData();
  formData.append("secret", secret);
  formData.append("response", token);
  const ip = request.headers.get("cf-connecting-ip");
  if (ip) formData.append("remoteip", ip);

  // Error codes that are infrastructure/configuration faults, not bot verdicts.
  const INFRA_CODES = [
    "missing-input-secret",
    "invalid-input-secret",
    "siteverify-failure",
    "challenge-expired",
    "generic-parser-error"
  ];

  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: formData
    });
    const result = await response.json();
    if (result.success) return { ok: true, hardFail: false, status: "verified" };
    const codes = Array.isArray(result["error-codes"]) ? result["error-codes"] : [];
    const infra = codes.some((c) => INFRA_CODES.includes(c));
    console.error("Turnstile verification failed", JSON.stringify(result), "infra=", infra);
    // Configuration/service fault => let genuine inquiries through; clear
    // invalid-token verdict (bots) => reject.
    return { ok: infra, hardFail: infra, status: infra ? "infra" : "invalid" };
  } catch (error) {
    console.error("Turnstile verification network error; failing OPEN.", error);
    return { ok: true, hardFail: true, status: "infra" };
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
    ["Lead Intent", inquiry.lead_intent],
    ["Reference Product", inquiry.ref_product],
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
    `Lead Intent: ${inquiry.lead_intent}`,
    `Reference Product: ${inquiry.ref_product}`,
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
    lead_intent: String(data.lead_intent || "").trim(),
    ref_product: String(data.ref_product || "").trim(),
    submitted_at: new Date().toISOString(),
    ip_country: request.headers.get("cf-ipcountry") || "",
  };

  const errors = {};
  if (!required(inquiry.name)) errors.name = "Name is required.";
  if (!required(inquiry.email) || !/^\S+@\S+\.\S+$/.test(inquiry.email)) errors.email = "Valid email is required.";
  if (!required(inquiry.phone)) errors.phone = "Phone / WhatsApp is required.";
  if (!required(inquiry.message)) errors.message = "Message is required.";
  if (Object.keys(errors).length) return json({ ok: false, errors, message: "Please fill in the required fields." }, 400);

  // Honeypot: hidden field real buyers never see; if filled it is a bot.
  // Check both the new field name and the legacy "website" name. Reject
  // silently with a fake success so the bot believes it went through.
  const honeypot = data.company_url || data.website;
  if (honeypot && String(honeypot).trim().length > 0) {
    console.warn("Inquiry rejected: honeypot tripped.", { name: inquiry.name, email: inquiry.email });
    return json({ ok: true, message: "Thank you! Your inquiry has been submitted successfully." });
  }

  // Content-level spam filter: phishing/jackpot/giveaway lures with no buying
  // intent. Silently accepted (fake success) so bots do not retry with edits.
  if (looksLikeSpam(inquiry)) {
    console.warn("Inquiry rejected: content spam filter.", {
      name: inquiry.name, email: inquiry.email,
      country: inquiry.country, snippet: String(inquiry.message).slice(0, 120)
    });
    return json({ ok: true, message: "Thank you! Your inquiry has been submitted successfully." });
  }

  const turnstileToken = String(data["cf-turnstile-response"] || "").trim();
  const turnstile = await verifyTurnstile(turnstileToken, env.TURNSTILE_SECRET_KEY, request);
  if (!turnstile.ok) {
    return json({ ok: false, message: "Please complete the anti-spam check, then submit again. If it keeps failing, message us directly on WhatsApp or email." }, 403);
  }
  const turnstileStatus = turnstile.status || "verified";

  // Recipients: comma-separated env list, default = enterprise mailbox AND the
  // owner's QQ mailbox, so a single-mailbox outage can never swallow leads.
  const toEmails = (env.INQUIRY_TO_EMAIL || "anna@zhihuamoulds.com,354909745@qq.com")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const fromEmail = env.INQUIRY_FROM_EMAIL || "Zhihua Moulds <noreply@zhihuamoulds.com>";

  if (!env.RESEND_API_KEY) {
    console.error("RESEND_API_KEY is not configured.");
    return json({ ok: false, message: "Submit failed. Please contact us by WhatsApp or email." }, 500);
  }

  // Persist the lead BEFORE sending — even if the worker crashes mid-fetch the
  // buyer is already captured in KV (status updated once email result is known).
  const leadId = newLeadId();
  await saveLead(env, leadId, { ...publicRecord(inquiry), turnstile: turnstileStatus, email_status: "sending", recipients: toEmails });

  const subjectName = inquiry.name ? ` from ${inquiry.name}` : "";
  const payload = {
    from: fromEmail,
    to: toEmails,
    reply_to: inquiry.email,
    subject: `New Zhihua Moulds inquiry${subjectName}`,
    html: buildEmailHtml(inquiry),
    text: buildEmailText(inquiry)
  };

  let emailOk = false;
  let emailError = "";
  try {
    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "authorization": `Bearer ${env.RESEND_API_KEY}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    if (resendResponse.ok) {
      emailOk = true;
    } else {
      emailError = `${resendResponse.status} ${(await resendResponse.text().catch(() => "")).slice(0, 500)}`;
      console.error("Resend email failed", emailError);
    }
  } catch (error) {
    emailError = String(error && error.message || error).slice(0, 500);
    console.error("Resend network error", error);
  }

  await saveLead(env, leadId, {
    ...publicRecord(inquiry),
    turnstile: turnstileStatus,
    email_status: emailOk ? "sent" : "email_failed",
    email_error: emailOk ? "" : emailError,
    recipients: toEmails
  });

  // Lead is captured regardless of mail delivery: show success so the buyer
  // does not leave; a failed email is visible in the KV lead list for follow-up.
  return json({
    ok: true,
    message: "Thank you! Your inquiry has been submitted successfully. We will contact you within 24 hours."
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // Lead backup viewer: GET /api/inquiry?key=LEADS_VIEW_KEY
  // Returns stored leads newest-first. Works even when email is fully broken.
  const key = url.searchParams.get("key");
  if (key) {
    if (!env.LEADS_VIEW_KEY || key !== env.LEADS_VIEW_KEY) {
      return json({ ok: false, message: "Forbidden." }, 403);
    }
    if (!env.INQUIRY_KV) {
      return json({ ok: false, message: "Lead store (INQUIRY_KV) is not bound." }, 503);
    }
    try {
      const listed = await env.INQUIRY_KV.list({ prefix: "lead:", limit: 200 });
      const keys = listed.keys.map((k) => k.name).sort().reverse();
      const records = [];
      for (const k of keys) {
        const raw = await env.INQUIRY_KV.get(k);
        if (raw) {
          try { records.push(JSON.parse(raw)); } catch { /* skip malformed */ }
        }
      }
      const failed = records.filter((r) => r.email_status === "email_failed").length;
      return json({ ok: true, count: records.length, email_failed: failed, leads: records });
    } catch (error) {
      console.error("KV list failed", error);
      return json({ ok: false, message: "Could not read lead store." }, 500);
    }
  }

  return json({ ok: true, message: "Inquiry endpoint is running. Use POST to submit." });
}
