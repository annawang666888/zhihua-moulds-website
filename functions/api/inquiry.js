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
  const { request } = context;

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

  const basinEndpoint = "https://usebasin.com/f/faac31d0bb8e";
  const basinForm = new FormData();
  basinForm.set("_subject", "New website inquiry from zhihuamoulds.com");
  basinForm.set("name", inquiry.name);
  basinForm.set("company", inquiry.company);
  basinForm.set("country", inquiry.country);
  basinForm.set("email", inquiry.email);
  basinForm.set("phone", inquiry.phone);
  basinForm.set("product", inquiry.product);
  basinForm.set("quantity", inquiry.quantity);
  basinForm.set("budget", inquiry.budget);
  basinForm.set("message", inquiry.message);
  basinForm.set("source_page", inquiry.source_page);
  basinForm.set("utm_source", inquiry.utm_source);
  basinForm.set("utm_medium", inquiry.utm_medium);
  basinForm.set("utm_campaign", inquiry.utm_campaign);
  basinForm.set("submitted_at", inquiry.submitted_at);
  basinForm.set("ip_country", inquiry.ip_country);

  let basinResponse;
  try {
    basinResponse = await fetch(basinEndpoint, {
      method: "POST",
      body: basinForm,
      headers: { "accept": "application/json" }
    });
  } catch (error) {
    console.error("Basin network error", error);
    return json({ ok: false, message: "Submit failed. Please contact us by WhatsApp or email." }, 502);
  }

  if (!basinResponse.ok) {
    const detail = await basinResponse.text().catch(() => "");
    console.error("Basin submit failed", basinResponse.status, detail.slice(0, 500));
    return json({ ok: false, message: "Submit failed. Please contact us by WhatsApp or email." }, 502);
  }

  return json({ ok: true, message: "Thank you! Your inquiry has been submitted successfully. We will contact you within 24 hours." });
}
export async function onRequestGet() {
  return json({ ok: true, message: "Inquiry endpoint is running. Use POST to submit." });
}
