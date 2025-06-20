# ReMeds Email Server

Bezpečný Node.js email server pro 2FA verifikaci v ReMeds aplikaci.

## Funkce

- ✅ **SMTP email odesílání** s Gmail podporou
- ✅ **API Key autentifikace** pro zabezpečení
- ✅ **Rate limiting** - 3 požadavky na IP+email za 5 minut
- ✅ **CORS podpora** pro cross-origin požadavky
- ✅ **Health check endpoint** pro monitoring
- ✅ **Bezpečnostní headers** a ochrana proti útokům
- ✅ **Automatický deployment script** pro VPS

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
SMTP_USER=mail@gmail.com
SMTP_PASS="p a s s w o r d"
SMTP_REJECT_UNAUTHORIZED=true

# Deployment Configuration
DOMAIN=api.domain.com
VPS_USER=user
APP_DIR=/opt/app

# Server Configuration
PORT=3000
HOST=127.0.0.1

# Security
API_KEY=2FA-API-KEY
NODE_ENV=production
```

### 3. Gmail App Password

Pro Gmail SMTP potřebujete app password:

1. Jděte na https://myaccount.google.com/
2. **Security** → **2-Step Verification** (musí být zapnuté)
3. **App passwords** → **Generate**
4. Vyberte **Mail** a **Other (Custom name)**
5. Zadejte název: `ReMeds Email Server`
6. **Generate** - dostanete 16místný kód

### 4. API Key

Vygenerujte bezpečný API klíč pro autentifikaci:

```bash
# Vygenerujte náhodný klíč
openssl rand -hex 32
```

## Spuštění

```bash
# Vývoj (s auto-reload)
npm run dev

# Produkce
npm start
```

Server se spustí na `http://127.0.0.1:3000` (lokální přístup).

## API Endpoints

### POST /send-email
Odešle verifikační email s ReMeds brandingem.

**Headers:**
```
X-API-Key: 2FA-API-KEY
Content-Type: application/json
```

**Body:**
```json
{
  "to": "user@example.com",
  "subject": "Verifikační kód",
  "code": "123456",
  "from": "ReMeds Team" // volitelné
}
```

**Rate Limiting:** 3 požadavky na kombinaci IP+email za 5 minut

**Response:**
```json
{
  "success": true,
  "message": "Email odeslán"
}
```

### GET /health
Health check endpoint pro monitoring (bez API Key).

**Response:**
```json
{
  "status": "OK",
  "timestamp": "2024-01-01T12:00:00.000Z",
  "smtp": {
    "host": "smtp.gmail.com",
    "port": 587,
    "user": "mail@gmail.com"
  },
  "security": {
    "rateLimitEnabled": true,
    "apiKeyRequired": true
  }
}
```

## Email Template

Server automaticky generuje krásný HTML email s:
- ReMeds brandingem
- Velkým verifikačním kódem
- Informací o 5minutové platnosti
- Bezpečnostním varováním

## Deployment na VPS

### Automatický deployment

```bash
# Nahrání deployment scriptu
scp deploy-complete.sh root@your-vps:/tmp/

# Spuštění na VPS
ssh root@your-vps
sudo bash /tmp/deploy-complete.sh your-email@gmail.com your-app-password your-api-key
```

### Manuální deployment

1. Naklonujte repozitář na VPS
2. Nainstalujte závislosti: `npm install`
3. Vytvořte `.env` soubor s vašimi údaji
4. Spusťte s PM2: `pm2 start server.js --name email-server`
5. Uložte PM2 konfiguraci: `pm2 save`

### Deployment konfigurace

V `.env` souboru nastavte:

```env
# Deployment Configuration
DOMAIN=api.yourdomain.com
VPS_USER=your-vps-username
APP_DIR=/opt/your-app-directory
```

## Nginx Reverse Proxy

```nginx
server {
    listen 80;
    server_name api.yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/api.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.yourdomain.com/privkey.pem;
    
    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options DENY always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-XSS-Protection "1; mode=block" always;

    location / {
        proxy_pass http://127.0.0.1:3000;
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

- ✅ **API Key autentifikace** pro všechny požadavky
- ✅ **Rate limiting** proti spam útokům
- ✅ **Environment variables** pro citlivé údaje
- ✅ **HTTPS** s Let's Encrypt
- ✅ **Firewall** (UFW)
- ✅ **Fail2ban** proti bruteforce útokům
- ✅ **Security headers**
- ✅ **CORS ochrana**
- ✅ **TLS/SSL SMTP** s certifikátovou validací

## Monitoring

### PM2 Monitoring
```bash
# Stav procesů
pm2 status

# Logy
pm2 logs email-server

# Restart
pm2 restart email-server
```

### Health Check
```bash
# Test health endpointu
curl https://api.yourdomain.com/health
```

## Troubleshooting

### Časté problémy

1. **"Chybí povinné SMTP údaje"**
   - Zkontrolujte `.env` soubor
   - Ověřte SMTP_HOST, SMTP_USER, SMTP_PASS

2. **"Chybí API_KEY"**
   - Nastavte API_KEY v `.env` souboru
   - Používejte bezpečný náhodný klíč

3. **"Příliš mnoho požadavků"**
   - Rate limit: 3 požadavky/5min na IP+email
   - Počkejte 5 minut nebo změňte IP

4. **"Neplatný API klíč"**
   - Zkontrolujte X-API-Key header
   - Ověřte správnost klíče v `.env`

### Logy
```bash
# PM2 logy
pm2 logs email-server --lines 100

# Systémové logy
journalctl -u pm2-root -f
``` 