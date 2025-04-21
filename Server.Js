require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();

// Enhanced CORS configuration
app.use(cors({
  origin: 'https://arkistech.com',
  methods: ['GET', 'POST'],
  credentials: true
}));
app.use(express.json());

// OAuth Configuration
const oAuth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URI
);

// Token management
const TOKEN_PATH = path.join(__dirname, 'token.json');

function saveTokens(tokens) {
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
  oAuth2Client.setCredentials(tokens);
  console.log('Tokens stored to', TOKEN_PATH);
}

function loadTokens() {
  if (fs.existsSync(TOKEN_PATH)) {
    const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH));
    oAuth2Client.setCredentials(tokens);
    console.log('Tokens loaded from', TOKEN_PATH);
    return true;
  }
  return false;
}

// Initialize authentication
if (process.env.REFRESH_TOKEN) {
  oAuth2Client.setCredentials({
    refresh_token: process.env.REFRESH_TOKEN
  });
  console.log('Using refresh token from .env');
} else {
  loadTokens();
}

// OAuth routes
app.get('/auth', (req, res) => {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/gmail.send'],
    prompt: 'consent'
  });
  res.redirect(authUrl);
});

app.get('/oauth2callback', async (req, res) => {
  try {
    const { code } = req.query;
    const { tokens } = await oAuth2Client.getToken(code);
    saveTokens(tokens);
    
    res.send(`<h1>Authentication Successful!</h1>
      <p>You can now send emails. Close this tab and try again.</p>`);
  } catch (error) {
    console.error('Auth error:', error);
    res.status(500).send('Authentication failed. Please try again.');
  }
});

// Email service with date fix
async function sendEmail(name, email, issue, description, dateDay, time) {
  const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });
  
  // Fixed date handling
  const now = new Date();
  const appointmentDate = new Date(
    now.getFullYear(),
    now.getMonth(),
    parseInt(dateDay)
  );

  const formattedDate = appointmentDate.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const emailContent = [
    `From: "${process.env.EMAIL_NAME || 'Tech Support'} <${process.env.ADMIN_EMAIL}>`,
    `To: ${process.env.ADMIN_EMAIL}`,
    'Content-Type: text/html; charset=utf-8',
    'MIME-Version: 1.0',
    `Subject: New Appointment: ${name} - ${issue}`,
    '',
    `<div style="font-family: Arial, sans-serif; padding: 20px;">
      <h3 style="color: #2563eb;">Appointment Details</h3>
      <p><strong>Name:</strong> ${name}</p>
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Issue Type:</strong> ${issue}</p>
      <p><strong>Description:</strong></p>
      <div style="background: #f3f4f6; padding: 10px; border-radius: 5px;">
        ${description.replace(/\n/g, '<br>')}
      </div>
      <p><strong>Date:</strong> ${formattedDate}</p>
      <p><strong>Time:</strong> ${time}</p>
    </div>`
  ].join('\n');

  try {
    const encodedMessage = Buffer.from(emailContent)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const result = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: encodedMessage }
    });

    console.log('Email sent:', result.data);
    return result;
  } catch (error) {
    console.error('Email error:', error.message);
    if (error.response) console.error('Error details:', error.response.data);
    throw error;
  }
}

// Enhanced API endpoint
app.post('/send-email', async (req, res) => {
  console.log('Received request:', req.body);

  if (!oAuth2Client.credentials) {
    console.log('No credentials found');
    return res.status(401).json({
      error: 'Not authenticated',
      authUrl: `http://localhost:${process.env.PORT || 3000}/auth`
    });
  }

  try {
    const { name, email, issue, description, date, time } = req.body;
    
    // Validation
    if (!name || !email || !issue || !description || !date || !time) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    await sendEmail(name, email, issue, description, date, time);
    res.json({ success: true, message: 'Appointment scheduled successfully!' });

  } catch (error) {
    console.error('Server error:', error);
    
    if (error.message.includes('invalid_grant')) {
      console.log('Token expired - requiring re-auth');
      if (fs.existsSync(TOKEN_PATH)) fs.unlinkSync(TOKEN_PATH);
      oAuth2Client.setCredentials({});
      return res.status(401).json({
        error: 'Session expired - please reauthenticate',
        authUrl: `http://localhost:${process.env.PORT || 3000}/auth`
      });
    }
    
    res.status(500).json({
      error: 'Failed to schedule appointment',
      details: error.message
    });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
  Server running on http://localhost:${PORT}
  Authentication URL: http://localhost:${PORT}/auth
  Current token status: ${oAuth2Client.credentials ? 'Authenticated' : 'Not authenticated'}
  `);
});