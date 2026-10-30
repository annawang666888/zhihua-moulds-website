#!/bin/zsh
# 志华网站询盘链路每周体检（只读：curl/dig，UA=Mozilla/5.0，绝不提交表单）
# cron 每周一 09:00 调用；全部 OK 输出一行总结，任何 FAIL 逐条列出并以非零退出。
set -u
UA='Mozilla/5.0 (compatible; ZhihuaHealthcheck/1.0)'
BASE='https://zhihuamoulds.com'
FAILS=()
check(){ # desc expected actual
  if [ "$2" = "$3" ]; then echo "OK   $1 ($3)"; else echo "FAIL $1 (expected $2, got $3)"; FAILS+=("$1: expected $2 got $3"); fi
}

echo "== 页面可达性 =="
check "首页 /"                 200 "$(curl -s -o /dev/null -w '%{http_code}' -A "$UA" --max-time 20 "$BASE/")"
check "/contact"               200 "$(curl -s -o /dev/null -w '%{http_code}' -A "$UA" --max-time 20 "$BASE/contact")"
check "/sitemap.xml"           200 "$(curl -s -o /dev/null -w '%{http_code}' -A "$UA" --max-time 20 "$BASE/sitemap.xml")"

echo "== 询盘 API =="
API_BODY="$(curl -s -A "$UA" --max-time 20 "$BASE/api/inquiry")"
if echo "$API_BODY" | grep -q '"ok":true'; then echo "OK   /api/inquiry 存活响应"; else echo "FAIL /api/inquiry 响应异常: $API_BODY"; FAILS+=("/api/inquiry 响应异常"); fi

echo "== 邮件域名记录 =="
MX="$(dig +short MX zhihuamoulds.com | tr '\n' ' ')"
if echo "$MX" | grep -q 'mxbiz1.qq.com'; then echo "OK   MX (腾讯企业邮): $MX"; else echo "FAIL MX 缺 mxbiz1.qq.com: $MX"; FAILS+=("MX 记录异常: $MX"); fi
DMARC="$(dig +short TXT _dmarc.zhihuamoulds.com | tr '\n' ' ')"
if echo "$DMARC" | grep -q 'v=DMARC1'; then echo "OK   DMARC 存在"; else echo "FAIL DMARC TXT 缺失: $DMARC"; FAILS+=("DMARC 记录缺失"); fi
DKIM="$(dig +short TXT resend._domainkey.zhihuamoulds.com | tr '\n' ' ')"
if echo "$DKIM" | grep -q 'p=MIG'; then echo "OK   Resend DKIM 存在"; else echo "FAIL Resend DKIM 缺失: $DKIM"; FAILS+=("Resend DKIM 缺失"); fi

echo "== Turnstile 人机验证（国内买家降级路径）=="
CONTACT_HTML="$(curl -s -A "$UA" --max-time 20 "$BASE/contact")"
if echo "$CONTACT_HTML" | grep -qi 'turnstile'; then echo "OK   contact 页含 Turnstile 引用"; else echo "FAIL contact 页找不到 turnstile"; FAILS+=("contact 页缺 Turnstile"); fi
TS_CODE="$(curl -s -o /dev/null -w '%{http_code}' -A "$UA" --max-time 20 'https://challenges.cloudflare.com/turnstile/v0/api.js')"
if [[ "$TS_CODE" =~ ^(2[0-9][0-9]|3[0-9][0-9])$ ]]; then echo "OK   challenges.cloudflare.com api.js ($TS_CODE)"; else echo "FAIL challenges.cloudflare.com api.js ($TS_CODE)"; FAILS+=("Turnstile api.js 不可达: $TS_CODE"); fi
JSVER="$(echo "$CONTACT_HTML" | grep -o 'main.js?v=[^"]*' | head -1)"
JSDATE="$(echo "$JSVER" | sed -n 's/^main.js?v=\([0-9]*\).*/\1/p')"
if [ "$JSVER" = 'main.js?v=20261011-turnstile-fallback' ] \
   || { [ -n "$JSDATE" ] && [ "$JSDATE" -ge 20261011 ] 2>/dev/null; }; then
  echo "OK   $JSVER（看门狗版本在位）"
else
  echo "FAIL main.js 版本疑似回退: $JSVER"; FAILS+=("main.js 版本疑似回退: $JSVER")
fi

echo
if [ ${#FAILS[@]} -eq 0 ]; then
  echo "全部正常 ✅ $(date '+%Y-%m-%d %H:%M %Z')"
  exit 0
else
  echo "❌ ${#FAILS[@]} 项异常（服务器侧通过不等于国内可加载；contact 页 Turnstile/看门狗异常意味着真实买家可能无法提交表单）："
  printf ' - %s\n' "${FAILS[@]}"
  exit 1
fi
