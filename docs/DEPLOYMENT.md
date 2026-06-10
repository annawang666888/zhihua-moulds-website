# Zhihua Moulds Deployment Guide

This site is prepared for Cloudflare Pages.

## Recommended production domain

Use `https://zhihuamoulds.com` as the canonical domain. Redirect `www.zhihuamoulds.com` to `zhihuamoulds.com`.

## Cloudflare Pages settings

- Framework preset: None / Static HTML
- Build command: leave empty
- Build output directory: `/` or leave empty if Cloudflare allows root static deployment
- Production branch: `main`

## Required DNS / domain work

After the Pages project is deployed, add these custom domains in Cloudflare Pages:

- `zhihuamoulds.com`
- `www.zhihuamoulds.com` redirecting to the root domain

Cloudflare will show exact DNS records. Follow the records it gives you.

## Inquiry form backend

The contact form now posts to `/api/inquiry`, implemented in `functions/api/inquiry.js`.

To enable email notifications, create a Resend account and set these Cloudflare Pages environment variables:

- `RESEND_API_KEY`
- `INQUIRY_TO_EMAIL` — the address that receives inquiries
- `INQUIRY_FROM_EMAIL` — verified sender address, e.g. `Zhihua Moulds <inquiry@zhihuamoulds.com>`

Until those variables are set, the endpoint can receive and validate submissions, but it will only log them in Cloudflare runtime logs and will not send email.

## Later improvements

- Add Cloudflare Turnstile anti-spam to the form.
- Save inquiries to Google Sheet / Airtable.
- Convert the site to Astro for product/blog content management.
- Generate sitemap automatically after the Astro migration.
