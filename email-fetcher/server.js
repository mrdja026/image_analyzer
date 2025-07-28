const express = require('express');
const path = require('path');
const { google } = require('googleapis');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Parse JSON body
app.use(express.json());

// API endpoint to get auth config (only expose client ID, not API key)
app.get('/api/auth-config', (req, res) => {
  res.json({
    clientId: process.env.CLIENT_ID
  });
});

// Proxy API for Gmail requests
app.post('/api/gmail/labels', async (req, res) => {
  try {
    const accessToken = req.headers.authorization?.split(' ')[1];
    if (!accessToken) {
      return res.status(401).json({ error: 'No access token provided' });
    }
    
    // Create client with user's access token
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const response = await gmail.users.labels.list({ userId: 'me' });
    
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching labels:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint to fetch emails with 'Discovery' label
app.post('/api/gmail/emails', async (req, res) => {
  try {
    const accessToken = req.headers.authorization?.split(' ')[1];
    if (!accessToken) {
      return res.status(401).json({ error: 'No access token provided' });
    }
    
    // Create client with user's access token
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    
    // First get the ID of the "Discovery" label
    const labelsResponse = await gmail.users.labels.list({ userId: 'me' });
    const discoveryLabel = labelsResponse.data.labels.find(label => label.name === 'Discovery');
    
    if (!discoveryLabel) {
      return res.status(404).json({ error: 'Discovery label not found' });
    }
    
    // Then get emails with that label
    const emailsResponse = await gmail.users.messages.list({
      userId: 'me',
      maxResults: 20,
      labelIds: [discoveryLabel.id]
    });
    
    if (!emailsResponse.data.messages || emailsResponse.data.messages.length === 0) {
      return res.json({ emails: [] });
    }
    
    // Get message details for each email to extract subject
    const emailPromises = emailsResponse.data.messages.map(async (message) => {
      const messageDetails = await gmail.users.messages.get({
        userId: 'me',
        id: message.id,
        format: 'metadata',
        metadataHeaders: ['Subject']
      });
      
      const subjectHeader = messageDetails.data.payload.headers.find(
        header => header.name === 'Subject'
      );
      
      return {
        id: message.id,
        subject: subjectHeader ? subjectHeader.value : '(No subject)'
      };
    });
    
    const emails = await Promise.all(emailPromises);
    res.json({ emails });
  } catch (error) {
    console.error('Error fetching emails:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create route to serve index.html without exposing API credentials in the window object
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Serve other static files
app.use(express.static(__dirname));

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
