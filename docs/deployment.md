# Deployment Guide

## Content Security Policy (CSP)

The application requires a strict Content Security Policy to protect against XSS and other injection attacks.

### Development

For local development, a `<meta>` tag CSP is included in `index.html`:

```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; connect-src 'self'; object-src 'none'" />
```

### Production

In production, CSP **must** be delivered as an HTTP response header. This is required because:

1. `frame-ancestors` directive is ignored in `<meta>` tags
2. HTTP headers provide stronger security guarantees

Configure your web server or CDN to include this header:

```
Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'
```

### Directive Breakdown

| Directive | Value | Reason |
|-----------|-------|--------|
| `default-src` | `'self'` | Fallback for all resource types |
| `script-src` | `'self' 'wasm-unsafe-eval'` | Allow WASM compilation (required for wa-sqlite) |
| `style-src` | `'self' 'unsafe-inline'` | Tailwind CSS uses inline styles |
| `worker-src` | `'self' blob:` | Vite bundler may emit blob URL workers |
| `connect-src` | `'self'` | Restrict fetch/XHR to same origin |
| `frame-ancestors` | `'none'` | Prevent clickjacking (header only) |
| `object-src` | `'none'` | Block plugins (Flash, Java, etc.) |

### Server Configuration Examples

#### Nginx

```nginx
add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'" always;
```

#### Apache

```apache
Header always set Content-Security-Policy "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'"
```

#### Cloudflare Pages (`_headers` file)

```
/*
  Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'
```

#### Vercel (`vercel.json`)

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "Content-Security-Policy",
          "value": "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'"
        }
      ]
    }
  ]
}
```

### Verification

After deployment, verify CSP is active:

1. Open browser DevTools (F12)
2. Go to Network tab
3. Reload the page
4. Check response headers for `Content-Security-Policy`
5. Check Console tab for any CSP violations during normal usage

The E2E test `E2E-SEC-02` validates that WASM loads, workers start, and no CSP violations occur during a full workflow.
