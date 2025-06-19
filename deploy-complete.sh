#!/bin/bash

# Kompletní deployment script pro MedsTrackingApp 2FA
# Spusťte jako root: sudo bash deploy-complete.sh
# Použití: ./deploy-complete.sh

set -e

echo "🚀 Kompletní deployment MedsTrackingApp 2FA..."

# Barvy pro výstup
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_step() {
    echo -e "${BLUE}[STEP]${NC} $1"
}

# Kontrola root oprávnění
if [[ $EUID -ne 0 ]]; then
   log_error "Tento script musí být spuštěn jako root (sudo)"
   exit 1
fi

# ============================================================================
# NAČTENÍ KONFIGURACE Z .ENV
# ============================================================================
log_step "Načítám konfiguraci z .env souboru..."

# Kontrola, zda existuje .env soubor
if [ -f "/opt/medstrackingapp/.env" ]; then
    log_info "Načítám existující .env soubor..."
    source "/opt/medstrackingapp/.env"
else
    log_error "Žádný .env soubor nenalezen v /opt/medstrackingapp/.env"
    log_error "Prosím, vytvořte .env soubor s následujícími hodnotami:"
    log_error "SMTP_USER=your-email@gmail.com"
    log_error "SMTP_PASS=your-app-password"
    log_error "API_KEY=your-api-key"
    log_error "DOMAIN=your-domain.com"
    log_error "VPS_USER=your-vps-user"
    log_error "APP_DIR=/path/to/app"
    exit 1
fi

# Kontrola povinných hodnot
if [ -z "$SMTP_USER" ] || [ -z "$SMTP_PASS" ] || [ -z "$API_KEY" ] || [ -z "$DOMAIN" ] || [ -z "$VPS_USER" ] || [ -z "$APP_DIR" ]; then
    log_error "Chybí povinné hodnoty v .env souboru!"
    log_error "Potřebné: SMTP_USER, SMTP_PASS, API_KEY, DOMAIN, VPS_USER, APP_DIR"
    exit 1
fi

log_info "Nastavení:"
log_info "  Doména: $DOMAIN"
log_info "  VPS User: $VPS_USER"
log_info "  App Directory: $APP_DIR"
log_info "  SMTP User: ${SMTP_USER:0:10}..."
log_info "  API Key: ${API_KEY:0:10}..."

# ============================================================================
# KROK 1: Aktualizace systému a instalace základních balíčků
# ============================================================================
log_step "1. Aktualizace systému a instalace balíčků..."

apt update && apt upgrade -y
apt install -y curl wget git ufw fail2ban nginx

# ============================================================================
# KROK 2: Instalace Node.js
# ============================================================================
log_step "2. Instalace Node.js..."

curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt-get install -y nodejs

# ============================================================================
# KROK 3: Instalace Postfix
# ============================================================================
log_step "3. Instalace Postfix..."

debconf-set-selections <<< "postfix postfix/mailname string $(hostname -f)"
debconf-set-selections <<< "postfix postfix/main_mailer_type string 'Internet Site'"
apt install -y postfix

# ============================================================================
# KROK 4: Nastavení firewallu
# ============================================================================
log_step "4. Nastavení firewallu..."

ufw --force enable
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 587/tcp
ufw allow 465/tcp
ufw deny 25/tcp
ufw deny 3000/tcp

log_info "Firewall nastaven"

# ============================================================================
# KROK 5: Nastavení fail2ban
# ============================================================================
log_step "5. Nastavení fail2ban..."

systemctl enable fail2ban
systemctl start fail2ban

# Vytvoření fail2ban konfigurace
cat > /etc/fail2ban/jail.local << 'EOF'
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 3

[sshd]
enabled = true
port = ssh
logpath = /var/log/auth.log
maxretry = 3

[nginx-http-auth]
enabled = true
port = http,https
logpath = /var/log/nginx/error.log
maxretry = 3
EOF

systemctl restart fail2ban

# =========================================================================
# KROK 6: Vytvoření uživatele a adresářů
# =========================================================================
log_step "6. Vytvoření adresářů..."

# Vytvoření adresáře pro aplikaci
mkdir -p $APP_DIR
chown $VPS_USER:$VPS_USER $APP_DIR

# ============================================================================
# KROK 7: Instalace PM2
# ============================================================================
log_step "7. Instalace PM2..."

npm install -g pm2
pm2 startup systemd -u $VPS_USER --hp /home/$VPS_USER

# ============================================================================
# KROK 8: Naklonování email serveru
# ============================================================================
log_step "8. Naklonování email serveru..."

cd $APP_DIR
if [ -d ".git" ]; then
    git pull origin main
else
    git clone https://github.com/the-maty/mail-server.git .
fi

# Instalace závislostí
npm install

# ============================================================================
# KROK 9: Nastavení SMTP konfigurace
# ============================================================================
log_step "9. Nastavení SMTP konfigurace..."

# Vytvoření finálního .env souboru
cat > $APP_DIR/.env << EOF
# SMTP Configuration
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=$SMTP_USER
SMTP_PASS=$SMTP_PASS
SMTP_REJECT_UNAUTHORIZED=true

# Server Configuration
PORT=3000
HOST=127.0.0.1

# Security
NODE_ENV=production
API_KEY=$API_KEY

# Deployment Configuration
DOMAIN=$DOMAIN
VPS_USER=$VPS_USER
APP_DIR=$APP_DIR
EOF

chown $VPS_USER:$VPS_USER $APP_DIR/.env
chmod 600 $APP_DIR/.env

# ============================================================================
# KROK 10: Nastavení Nginx
# ============================================================================
log_step "10. Nastavení Nginx..."

# Vytvoření základní HTTP Nginx konfigurace (pro certbot)
cat > /etc/nginx/sites-available/medstrackingapp << EOF
server {
    listen 80;
    server_name $DOMAIN;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF

# Aktivace Nginx site
ln -sf /etc/nginx/sites-available/medstrackingapp /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Test a restart Nginx
nginx -t && systemctl reload nginx

# ============================================================================
# KROK 11: Instalace Certbot a SSL
# ============================================================================
log_step "11. Instalace SSL certifikátu..."

apt install -y certbot python3-certbot-nginx

# Získání SSL certifikátu (certbot automaticky upraví konfiguraci na HTTPS)
certbot --nginx -d $DOMAIN --non-interactive --agree-tos --email $SMTP_USER

# Otestování finální konfigurace
nginx -t && systemctl reload nginx

# ============================================================================
# KROK 12: Spuštění email serveru
# ============================================================================
log_step "12. Spuštění email serveru..."

# Spuštění jako uživatel
sudo -u $VPS_USER bash -c "cd $APP_DIR && HOST=127.0.0.1 pm2 start server.js --name email-server"
sudo -u $VPS_USER pm2 save

# ============================================================================
# KROK 13: Testování
# ============================================================================
log_step "13. Testování..."

sleep 5

# Test health endpoint
if curl -s https://$DOMAIN/health | grep -q "OK"; then
    log_info "✅ Health check: OK"
else
    log_warn "⚠️  Health check selhal"
fi

# Test email endpoint
if curl -s -X POST https://$DOMAIN/send-email \
    -H 'Content-Type: application/json' \
    -d '{"to":"test@example.com","from":"ReMeds","subject":"Deployment Test","code":"123456"}' | grep -q "success"; then
    log_info "✅ Email endpoint: OK"
else
    log_warn "⚠️  Email endpoint selhal"
fi

# ============================================================================
# KROK 14: Vytvoření reportu
# ============================================================================
log_step "14. Vytvoření deployment reportu..."

cat > /root/deployment-report.txt << EOF
=== MEDSTRACKINGAPP 2FA DEPLOYMENT REPORT ===
Datum: $(date)
Doména: $DOMAIN
Gmail: $GMAIL_EMAIL

SERVICES:
- Node.js: $(node --version)
- Nginx: $(nginx -v 2>&1)
- PM2: $(pm2 --version)
- Certbot: $(certbot --version)

ENDPOINTS:
- Health: https://$DOMAIN/health
- Email: https://$DOMAIN/send-email

FIREWALL:
$(ufw status numbered)

SSL CERTIFICATE:
$(openssl s_client -connect $DOMAIN:443 -servername $DOMAIN < /dev/null 2>/dev/null | openssl x509 -noout -dates)

PM2 PROCESSES:
$(pm2 list)

LOG FILES:
- PM2 logs: pm2 logs email-server
- Nginx logs: /var/log/nginx/
- System logs: journalctl -u pm2-$VPS_USER

MANAGEMENT:
- Restart server: pm2 restart email-server
- View logs: pm2 logs email-server
- Update app: cd $APP_DIR && git pull && pm2 restart email-server
- SSL renewal: certbot renew

iOS APP CONFIG:
URL: https://$DOMAIN/send-email
EOF

# ============================================================================
# DOKONČENÍ
# ============================================================================
log_info "🎉 DEPLOYMENT DOKONČEN!"
log_info "📋 Report: /root/deployment-report.txt"
log_info "🌐 URL: https://$DOMAIN"
log_info "📧 Email server: https://$DOMAIN/send-email"
log_info "🔍 Health check: https://$DOMAIN/health"

echo ""
echo "=== PŘÍKAZY PRO SPRÁVU ==="
echo "🔍 Status: pm2 status"
echo "📊 Logy: pm2 logs email-server"
echo "🔄 Restart: pm2 restart email-server"
echo "📋 Report: cat /root/deployment-report.txt"
echo ""
echo "=== iOS APLIKACE ==="
echo "URL: https://$DOMAIN/send-email"
echo "HTTPS: povinné"
echo ""
echo "✅ Všechno je připravené pro iOS aplikaci!" 