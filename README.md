# MedsTrackingApp Email Server

Jednoduchý Node.js email server pro 2FA verifikaci v MedsTrackingApp.

## Instalace

```bash
npm install
```

## Konfigurace

Vytvořte soubor `smtp-config.js`:

```javascript
module.exports = {
  host: 'localhost', // nebo IP vašeho SMTP serveru
  port: 587,
  secure: false,
  auth: {
    user: 'noreply@vas-domain.com',
    pass: 'vas-smtp-heslo'
  }
};
```

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

1. Naklonujte repozitář na VPS
2. Nainstalujte závislosti: `npm install`
3. Vytvořte `smtp-config.js` s vašimi SMTP údaji
4. Spusťte s PM2: `pm2 start server.js --name email-server`
5. Uložte PM2 konfiguraci: `pm2 save`

## Nginx Reverse Proxy

```nginx
server {
    listen 80;
    server_name your-domain.com;

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