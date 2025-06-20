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
  },
  // Connection pooling pro lepší výkon
  pool: process.env.SMTP_POOL === 'true',
  maxConnections: process.env.SMTP_MAX_CONNECTIONS ? parseInt(process.env.SMTP_MAX_CONNECTIONS) : 5,
  maxMessages: process.env.SMTP_MAX_MESSAGES ? parseInt(process.env.SMTP_MAX_MESSAGES) : 100,
  rateLimit: process.env.SMTP_RATE_LIMIT ? parseInt(process.env.SMTP_RATE_LIMIT) : 20, // Gmail limit
  rateDelta: process.env.SMTP_RATE_DELTA ? parseInt(process.env.SMTP_RATE_DELTA) : 1000 // 1 sekunda
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

// Traffic protection nastavení
const TRAFFIC_PROTECTION = {
  enabled: process.env.TRAFFIC_PROTECTION === 'true',
  maxConcurrentRequests: process.env.MAX_CONCURRENT_REQUESTS ? parseInt(process.env.MAX_CONCURRENT_REQUESTS) : 10,
  requestTimeout: process.env.REQUEST_TIMEOUT ? parseInt(process.env.REQUEST_TIMEOUT) : 30000, // 30s
  retryAttempts: process.env.RETRY_ATTEMPTS ? parseInt(process.env.RETRY_ATTEMPTS) : 3,
  retryDelay: process.env.RETRY_DELAY ? parseInt(process.env.RETRY_DELAY) : 1000, // 1s
  throttleEnabled: process.env.THROTTLE_ENABLED === 'true',
  throttleDelay: process.env.THROTTLE_DELAY ? parseInt(process.env.THROTTLE_DELAY) : 100 // 100ms
};

// Middleware
app.use(cors());
app.use(express.json({ limit: '1mb' })); // Limit velikosti requestu

// SMTP transporter s connection pooling
const transporter = nodemailer.createTransport(smtpConfig);

// Verifikace SMTP připojení
transporter.verify((error, success) => {
  if (error) {
    console.error('❌ SMTP připojení selhalo:', error);
  } else {
    console.log('✅ SMTP server připraven');
  }
});

// Rate Limiting pro 2FA emaily - chytře nastavený pro 5minutové čekání
const emailLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minut (stejně jako platnost kódu)
  max: 5, // max 5 požadavků na IP za 5 minut
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

// Traffic protection middleware
let activeRequests = 0;
const trafficProtection = (req, res, next) => {
  if (!TRAFFIC_PROTECTION.enabled) {
    return next();
  }

  // Kontrola počtu současných požadavků
  if (activeRequests >= TRAFFIC_PROTECTION.maxConcurrentRequests) {
    return res.status(429).json({
      error: 'Server je přetížený',
      message: 'Zkuste to znovu za chvíli',
      retryAfter: 5
    });
  }

  activeRequests++;
  
  // Timeout pro požadavek
  const timeout = setTimeout(() => {
    activeRequests--;
    if (!res.headersSent) {
      res.status(408).json({
        error: 'Timeout',
        message: 'Požadavek trval příliš dlouho'
      });
    }
  }, TRAFFIC_PROTECTION.requestTimeout);

  // Cleanup při dokončení
  res.on('finish', () => {
    clearTimeout(timeout);
    activeRequests--;
  });

  // Throttling (zpomalení)
  if (TRAFFIC_PROTECTION.throttleEnabled) {
    setTimeout(next, TRAFFIC_PROTECTION.throttleDelay);
  } else {
    next();
  }
};

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

// Retry mechanismus pro SMTP
const sendEmailWithRetry = async (mailOptions, attempts = 0) => {
  try {
    return await transporter.sendMail(mailOptions);
  } catch (error) {
    if (attempts < TRAFFIC_PROTECTION.retryAttempts) {
      console.log(`⚠️ SMTP selhal, opakuji za ${TRAFFIC_PROTECTION.retryDelay}ms (pokus ${attempts + 1}/${TRAFFIC_PROTECTION.retryAttempts})`);
      await new Promise(resolve => setTimeout(resolve, TRAFFIC_PROTECTION.retryDelay));
      return sendEmailWithRetry(mailOptions, attempts + 1);
    }
    throw error;
  }
};

// Email endpoint s zabezpečením
app.post('/send-email', checkApiKey, emailLimiter, trafficProtection, async (req, res) => {
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

    await sendEmailWithRetry(mailOptions);
    
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
      user: smtpConfig.auth.user,
      pool: smtpConfig.pool,
      maxConnections: smtpConfig.maxConnections
    },
    security: {
      rateLimitEnabled: true,
      apiKeyRequired: true,
      trafficProtection: TRAFFIC_PROTECTION.enabled,
      activeRequests: activeRequests,
      maxConcurrentRequests: TRAFFIC_PROTECTION.maxConcurrentRequests
    }
  });
});

app.listen(PORT, HOST, () => {
  console.log(`🚀 Email server běží na ${HOST}:${PORT}`);
  console.log(`📧 SMTP: ${smtpConfig.host}:${smtpConfig.port}`);
  console.log(`👤 User: ${smtpConfig.auth.user}`);
  console.log(`🔐 API Key: ${API_KEY.substring(0, 10)}...`);
  console.log(`🛡️ Rate Limit: 5 požadavků/5min na IP+email`);
  
  if (TRAFFIC_PROTECTION.enabled) {
    console.log(`🛡️ Traffic Protection: POVOLENO`);
    console.log(`   - Max současných požadavků: ${TRAFFIC_PROTECTION.maxConcurrentRequests}`);
    console.log(`   - Timeout: ${TRAFFIC_PROTECTION.requestTimeout}ms`);
    console.log(`   - Retry pokusů: ${TRAFFIC_PROTECTION.retryAttempts}`);
    if (TRAFFIC_PROTECTION.throttleEnabled) {
      console.log(`   - Throttling: ${TRAFFIC_PROTECTION.throttleDelay}ms`);
    }
  } else {
    console.log(`🛡️ Traffic Protection: VYPNOUTO`);
  }
  
  if (smtpConfig.pool) {
    console.log(`🔗 SMTP Pool: ${smtpConfig.maxConnections} připojení`);
  }
}); 