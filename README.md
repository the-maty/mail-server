# MedsTrackingApp Email Server

Jednoduchý Node.js email server pro 2FA verifikaci v MedsTrackingApp.

## Instalace

```bash
npm install
```

## Konfigurace

### 1. Environment Variables

Zkopírujte `env.example` na `.env` a upravte hodnoty:

```bash
cp env.example .env
nano .env
```

### 2. .env soubor

```env
# SMTP Configuration
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_REJECT_UNAUTHORIZED=true

# Server Configuration
PORT=3000
HOST=127.0.0.1

# Security
NODE_ENV=production
```

### 3. Gmail App Password

Pro Gmail SMTP potřebujete app password:

1. Jděte na https://myaccount.google.com/
2. **Security** → **2-Step Verification** (musí být zapnuté)
3. **App passwords** → **Generate**
4. Vyberte **Mail** a **Other (Custom name)**
5. Zadejte název: `MedsTrackingApp`
6. **Generate** - dostanete 16místný kód

## Spuštění

```bash
# Vývoj
npm run dev

# Produkce
npm start
```

## API Endpoints

### POST /send-email
Odešle verifikační email.

**Body:**
```json
{
  "to": "user@example.com",
  "subject": "Verifikační kód",
  "code": "123456"
}
```

### GET /health
Health check endpoint.

## Deployment na VPS

### Automatický deployment

```bash
# Nahrání deployment scriptu
scp deploy-complete.sh root@your-vps:/tmp/

# Spuštění na VPS
ssh root@your-vps
sudo bash /tmp/deploy-complete.sh your-email@gmail.com your-app-password
```

### Manuální deployment

1. Naklonujte repozitář na VPS
2. Nainstalujte závislosti: `npm install`
3. Vytvořte `.env` soubor s vašimi SMTP údaji
4. Spusťte s PM2: `pm2 start server.js --name email-server`
5. Uložte PM2 konfiguraci: `pm2 save`

## Nginx Reverse Proxy

```nginx
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;
    
    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options DENY always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-XSS-Protection "1; mode=block" always;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## Bezpečnost

- ✅ **Environment variables** pro citlivé údaje
- ✅ **HTTPS** s Let's Encrypt
- ✅ **Firewall** (UFW)
- ✅ **Fail2ban** proti bruteforce útokům
- ✅ **Security headers**
- ✅ **Lokální přístup** pouze pro Node.js server 