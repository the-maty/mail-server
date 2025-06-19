require('dotenv').config();
const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

// Načtení SMTP konfigurace z environment variables
const smtpConfig = {
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT) : 587,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  },
  tls: {
    rejectUnauthorized: process.env.SMTP_REJECT_UNAUTHORIZED !== 'false'
  }
};

// Kontrola povinných SMTP údajů
if (!smtpConfig.host || !smtpConfig.auth.user || !smtpConfig.auth.pass) {
  console.error('❌ Chybí povinné SMTP údaje v environment variables!');
  console.error('Potřebné: SMTP_HOST, SMTP_USER, SMTP_PASS');
  process.exit(1);
}

// API Key pro autentifikaci
const API_KEY = process.env.API_KEY;
if (!API_KEY) {
  console.error('❌ Chybí API_KEY v environment variables!');
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Middleware
app.use(cors());
app.use(express.json());

// SMTP transporter
const transporter = nodemailer.createTransport(smtpConfig);

// Rate Limiting pro 2FA emaily - chytře nastavený pro 5minutové čekání
const emailLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minut (stejně jako platnost kódu)
  max: 3, // max 3 požadavky na IP za 5 minut
  message: {
    error: 'Příliš mnoho požadavků',
    message: 'Zkuste to znovu za 5 minut (platnost kódu)',
    retryAfter: 300 // 5 minut v sekundách
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Custom key generator - kombinace IP a emailu pro lepší ochranu
  keyGenerator: (req) => {
    const email = req.body.to || 'unknown';
    return `${req.ip}-${email}`;
  }
});

// Middleware pro kontrolu API Key
const checkApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  
  if (!apiKey) {
    return res.status(401).json({ 
      error: 'Chybí API klíč',
      message: 'Požadavek musí obsahovat X-API-Key header'
    });
  }
  
  if (apiKey !== API_KEY) {
    return res.status(401).json({ 
      error: 'Neplatný API klíč',
      message: 'Zadaný API klíč není správný'
    });
  }
  
  next();
};

// Email endpoint s zabezpečením
app.post('/send-email', checkApiKey, emailLimiter, async (req, res) => {
  try {
    const { to, from, subject, code } = req.body;
    
    if (!to || !subject || !code) {
      return res.status(400).json({ error: 'Chybí povinné parametry' });
    }

    // Nastavení odesílatele s názvem nebo bez
    const fromAddress = from ? `"${from}" <${smtpConfig.auth.user}>` : smtpConfig.auth.user;

    const mailOptions = {
      from: fromAddress,
      to: to,
      subject: subject,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2563eb;">ReMeds</h2>
          <h3>Váš verifikační kód</h3>
          <div style="background-color: #f3f4f6; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0;">
            <span style="font-size: 32px; font-weight: bold; color: #2563eb; letter-spacing: 4px;">${code}</span>
          </div>
          <p><strong>Tento kód je platný 5 minut.</strong></p>
          <p>Pokud jste tento kód nevyžádali, ignorujte tento email.</p>
          <hr style="margin: 30px 0;">
          <p style="color: #6b7280; font-size: 14px;">
            S pozdravem,<br>
            Tým ReMeds
          </p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    
    console.log(`✅ Email odeslán na ${to} od ${from || 'systému'} (IP: ${req.ip})`);
    res.json({ success: true, message: 'Email odeslán' });
    
  } catch (error) {
    console.error('❌ Chyba při odesílání emailu:', error);
    res.status(500).json({ error: 'Chyba při odesílání emailu', details: error.message });
  }
});

// Health check (bez API Key pro monitoring)
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    smtp: {
      host: smtpConfig.host,
      port: smtpConfig.port,
      user: smtpConfig.auth.user
    },
    security: {
      rateLimitEnabled: true,
      apiKeyRequired: true
    }
  });
});

app.listen(PORT, HOST, () => {
  console.log(`🚀 Email server běží na ${HOST}:${PORT}`);
  console.log(`📧 SMTP: ${smtpConfig.host}:${smtpConfig.port}`);
  console.log(`👤 User: ${smtpConfig.auth.user}`);
  console.log(`🔐 API Key: ${API_KEY.substring(0, 10)}...`);
  console.log(`🛡️ Rate Limit: 3 požadavků/5min na IP+email`);
}); 