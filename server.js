const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');

// Načtení SMTP konfigurace
let smtpConfig;
try {
  smtpConfig = require('./smtp-config.js');
} catch (error) {
  console.log('⚠️  SMTP config not found, using default configuration');
  smtpConfig = {
    host: 'localhost',
    port: 587,
    secure: false,
    auth: {
      user: 'noreply@medstrackingapp.havlik.eu',
      pass: 'your-smtp-password-here'
    }
  };
}

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// SMTP transporter
const transporter = nodemailer.createTransport(smtpConfig);

// Email endpoint
app.post('/send-email', async (req, res) => {
  try {
    const { to, subject, code } = req.body;
    
    if (!to || !subject || !code) {
      return res.status(400).json({ error: 'Chybí povinné parametry' });
    }

    const mailOptions = {
      from: smtpConfig.auth.user,
      to: to,
      subject: subject,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2563eb;">MedsTrackingApp</h2>
          <h3>Váš verifikační kód</h3>
          <div style="background-color: #f3f4f6; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0;">
            <span style="font-size: 32px; font-weight: bold; color: #2563eb; letter-spacing: 4px;">${code}</span>
          </div>
          <p><strong>Tento kód je platný 5 minut.</strong></p>
          <p>Pokud jste tento kód nevyžádali, ignorujte tento email.</p>
          <hr style="margin: 30px 0;">
          <p style="color: #6b7280; font-size: 14px;">
            S pozdravem,<br>
            Tým MedsTrackingApp
          </p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    
    console.log(`✅ Email odeslán na ${to}`);
    res.json({ success: true, message: 'Email odeslán' });
    
  } catch (error) {
    console.error('❌ Chyba při odesílání emailu:', error);
    res.status(500).json({ error: 'Chyba při odesílání emailu', details: error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    smtp: {
      host: smtpConfig.host,
      port: smtpConfig.port,
      user: smtpConfig.auth.user
    }
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Email server běží na portu ${PORT}`);
  console.log(`📧 SMTP: ${smtpConfig.host}:${smtpConfig.port}`);
  console.log(`👤 User: ${smtpConfig.auth.user}`);
}); 