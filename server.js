require('dotenv').config();
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const fetch = require('node-fetch');
const { google } = require('googleapis');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json());

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const AGENT_PASSWORD = process.env.AGENT_PASSWORD || 'Loce2634!';

// ─── In-memory session store ──────────────────────────────────────────────────
const sessions = new Map();

function generateSessionId() {
  return crypto.randomBytes(32).toString('hex');
}

function isAuthenticated(req) {
  const cookie = req.headers.cookie || '';
  const match = cookie.match(/agent_session=([a-f0-9]+)/);
  if (!match) return false;
  return sessions.has(match[1]);
}

// ─── Login page HTML ──────────────────────────────────────────────────────────
const LOGIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Endeavor Agent — Login</title>
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600&family=DM+Sans:wght@400;500&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      min-height: 100vh;
      background: linear-gradient(135deg, #0a2540 0%, #1a4a7a 50%, #0d5c46 100%);
      display: flex; align-items: center; justify-content: center;
      font-family: 'DM Sans', sans-serif;
    }
    .login-box {
      background: white;
      border-radius: 20px;
      padding: 48px 40px;
      width: 100%;
      max-width: 420px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      text-align: center;
    }
    .logo { font-size: 2.5rem; margin-bottom: 8px; }
    h1 {
      font-family: 'Playfair Display', serif;
      color: #0a2540;
      font-size: 1.6rem;
      margin-bottom: 6px;
    }
    .subtitle { color: #666; font-size: 0.9rem; margin-bottom: 32px; }
    input[type="password"] {
      width: 100%;
      padding: 14px 18px;
      border: 2px solid #e0e0e0;
      border-radius: 10px;
      font-size: 1rem;
      font-family: 'DM Sans', sans-serif;
      margin-bottom: 16px;
      outline: none;
      transition: border-color 0.2s;
    }
    input[type="password"]:focus { border-color: #0a2540; }
    button {
      width: 100%;
      padding: 14px;
      background: linear-gradient(135deg, #0a2540, #1a4a7a);
      color: white;
      border: none;
      border-radius: 10px;
      font-size: 1rem;
      font-family: 'DM Sans', sans-serif;
      font-weight: 500;
      cursor: pointer;
      transition: opacity 0.2s;
    }
    button:hover { opacity: 0.9; }
    .error {
      color: #e53e3e;
      font-size: 0.88rem;
      margin-top: 12px;
      display: none;
    }
    .error.show { display: block; }
  </style>
</head>
<body>
  <div class="login-box">
    <div class="logo">🤖</div>
    <h1>Endeavor Agent</h1>
    <p class="subtitle">Endeavor Evolution Enterprises — Powered by Claude AI</p>
    <input type="password" id="pwd" placeholder="Enter password" onkeydown="if(event.key==='Enter')login()">
    <button onclick="login()">Access Agent</button>
    <p class="error" id="err">Incorrect password. Try again.</p>
  </div>
  <script>
    async function login() {
      const pwd = document.getElementById('pwd').value;
      const res = await fetch('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pwd })
      });
      if (res.ok) {
        window.location.href = '/agent';
      } else {
        document.getElementById('err').classList.add('show');
        document.getElementById('pwd').value = '';
        document.getElementById('pwd').focus();
      }
    }
  </script>
</body>
</html>`;

// ─── Login routes ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  if (isAuthenticated(req)) return res.redirect('/agent');
  res.send(LOGIN_HTML);
});

app.post('/login', (req, res) => {
  const { password } = req.body;
  if (password === AGENT_PASSWORD) {
    const sessionId = generateSessionId();
    sessions.set(sessionId, { createdAt: Date.now() });
    res.setHeader('Set-Cookie', `agent_session=${sessionId}; HttpOnly; Path=/; Max-Age=86400; SameSite=Strict`);
    return res.json({ success: true });
  }
  res.status(401).json({ error: 'Invalid password' });
});

app.get('/logout', (req, res) => {
  const cookie = req.headers.cookie || '';
  const match = cookie.match(/agent_session=([a-f0-9]+)/);
  if (match) sessions.delete(match[1]);
  res.setHeader('Set-Cookie', 'agent_session=; HttpOnly; Path=/; Max-Age=0');
  res.redirect('/');
});

// ─── Auth middleware for protected routes ─────────────────────────────────────
function requireAuth(req, res, next) {
  if (isAuthenticated(req)) return next();
  res.status(401).json({ error: 'Not authenticated' });
}

function requireAuthPage(req, res, next) {
  if (isAuthenticated(req)) return next();
  res.redirect('/');
}

// ─── Serve agent page (protected) ────────────────────────────────────────────
app.get('/agent', requireAuthPage, (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.use('/assets', requireAuthPage, express.static(__dirname));

// ─── In-memory token store ────────────────────────────────────────────────────
let gmailTokens = null;
let calendarTokens = null;

// ─── OAuth2 Clients ───────────────────────────────────────────────────────────
const gmailOAuth2 = new google.auth.OAuth2(
  process.env.GOOGLE_GMAIL_CLIENT_ID,
  process.env.GOOGLE_GMAIL_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

const calendarOAuth2 = new google.auth.OAuth2(
  process.env.GOOGLE_CALENDAR_CLIENT_ID,
  process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// ─── System Prompt ────────────────────────────────────────────────────────────
const MASTER_SYSTEM_PROMPT = `You are the Endeavor Agent — an AI assistant for Endeavor Evolution Enterprises LLC, a North Miami Beach-based holding company offering Credit Repair, Business Funding, and LLC Formation services.

Owner: Witson | Website: https://www.endeavorevolt.com | Phone: (786) 520-1734
Booking: https://calendar.notion.so/meet/loceanw/book

You have access to the following live data actions. When the user's intent matches, respond with ONLY the exact action tag — nothing else.

MONDAY CRM:
- To view leads from any board → respond with: ACTION:GET_LEADS
- To onboard a new lead → respond with: ACTION:ONBOARDING

NOTION TASKS:
- To view tasks or to-do items → respond with: ACTION:GET_TASKS
- To create a new task → respond with: ACTION:CREATE_TASK

GMAIL:
- To check email, inbox, or messages → respond with: ACTION:GET_EMAILS
- To send an email → respond with: ACTION:SEND_EMAIL:{"to":"email","subject":"subject","body":"body"}

GOOGLE CALENDAR:
- To check schedule, meetings, or calendar → respond with: ACTION:GET_CALENDAR_EVENTS
- To create a calendar event → respond with: ACTION:CREATE_CALENDAR_EVENT

For all other questions, respond helpfully as the Endeavor Agent.`;

// ─── Monday CRM ───────────────────────────────────────────────────────────────
const MONDAY_BOARDS = {
  CREDIT:     { id: '18392231096', name: 'Credit Leads' },
  FUNDING:    { id: '18392232978', name: 'Funding Leads' },
  LLC:        { id: '18392233062', name: 'LLC Filing Leads' },
  MANAGEMENT: { id: '18395864294', name: 'Management Leads' },
};

async function getMondayLeads() {
  const results = [];
  for (const [div, board] of Object.entries(MONDAY_BOARDS)) {
    const query = `{ boards(ids: ${board.id}) { items_page(limit: 10) { items { id name column_values { id text } } } } }`;
    const res = await fetch('https://api.monday.com/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: process.env.MONDAY_API_KEY },
      body: JSON.stringify({ query }),
    });
    const data = await res.json();
    const items = data?.data?.boards?.[0]?.items_page?.items || [];
    results.push({ division: div, boardName: board.name, leads: items });
  }
  return results;
}

// ─── Notion ───────────────────────────────────────────────────────────────────
async function getNotionTasks() {
  const res = await fetch(`https://api.notion.com/v1/databases/${process.env.NOTION_TASKS_DB}/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ page_size: 20 }),
  });
  return res.json();
}

async function createNotionTask(title, description = '', dueDate = null) {
  const properties = { 'Task name': { title: [{ text: { content: title } }] } };
  if (description) properties['Description'] = { rich_text: [{ text: { content: description } }] };
  if (dueDate) properties['Due date'] = { date: { start: dueDate } };
  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ parent: { database_id: process.env.NOTION_TASKS_DB }, properties }),
  });
  return res.json();
}

// ─── Gmail ────────────────────────────────────────────────────────────────────
async function getGmailInbox() {
  if (!gmailTokens) throw new Error('Gmail not authenticated. Visit /auth/gmail first.');
  gmailOAuth2.setCredentials(gmailTokens);
  const gmail = google.gmail({ version: 'v1', auth: gmailOAuth2 });
  const list = await gmail.users.messages.list({ userId: 'me', maxResults: 10, labelIds: ['INBOX'] });
  const messages = list.data.messages || [];
  const emails = await Promise.all(messages.map(async (m) => {
    const msg = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'metadata', metadataHeaders: ['From', 'Subject', 'Date'] });
    const headers = msg.data.payload.headers;
    const get = (name) => headers.find(h => h.name === name)?.value || '';
    return { id: m.id, from: get('From'), subject: get('Subject'), date: get('Date'), snippet: msg.data.snippet };
  }));
  return emails;
}

async function sendGmail({ to, subject, body }) {
  if (!gmailTokens) throw new Error('Gmail not authenticated. Visit /auth/gmail first.');
  gmailOAuth2.setCredentials(gmailTokens);
  const gmail = google.gmail({ version: 'v1', auth: gmailOAuth2 });
  const raw = Buffer.from(
    `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`
  ).toString('base64url');
  return gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
}

// ─── Calendar ─────────────────────────────────────────────────────────────────
async function getCalendarEvents() {
  if (!calendarTokens) throw new Error('Calendar not authenticated. Visit /auth/calendar first.');
  calendarOAuth2.setCredentials(calendarTokens);
  const cal = google.calendar({ version: 'v3', auth: calendarOAuth2 });
  const res = await cal.events.list({
    calendarId: 'primary',
    timeMin: new Date().toISOString(),
    maxResults: 10,
    singleEvents: true,
    orderBy: 'startTime',
  });
  return res.data.items || [];
}

async function createCalendarEvent({ summary, description, start, end }) {
  if (!calendarTokens) throw new Error('Calendar not authenticated. Visit /auth/calendar first.');
  calendarOAuth2.setCredentials(calendarTokens);
  const cal = google.calendar({ version: 'v3', auth: calendarOAuth2 });
  const res = await cal.events.insert({
    calendarId: 'primary',
    requestBody: { summary, description, start: { dateTime: start }, end: { dateTime: end } },
  });
  return res.data;
}

// ─── OAuth Routes (public — needed for Google callback) ───────────────────────
app.get('/auth/gmail', (req, res) => {
  const url = gmailOAuth2.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send'],
    state: 'gmail',
  });
  res.redirect(url);
});

app.get('/auth/calendar', (req, res) => {
  const url = calendarOAuth2.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar'],
    state: 'calendar',
  });
  res.redirect(url);
});

app.get('/auth/google/callback', async (req, res) => {
  const { code, state } = req.query;
  try {
    if (state === 'gmail') {
      const { tokens } = await gmailOAuth2.getToken(code);
      gmailTokens = tokens;
      res.send('<h2>✅ Gmail connected! You can close this tab.</h2>');
    } else if (state === 'calendar') {
      const { tokens } = await calendarOAuth2.getToken(code);
      calendarTokens = tokens;
      res.send('<h2>✅ Google Calendar connected! You can close this tab.</h2>');
    } else {
      res.send('<h2>Unknown state. Try again.</h2>');
    }
  } catch (err) {
    res.status(500).send('<h2>Auth failed: ' + err.message + '</h2>');
  }
});

// ─── API Routes (protected) ───────────────────────────────────────────────────
app.get('/api/gmail/inbox', requireAuth, async (req, res) => {
  try { res.json({ emails: await getGmailInbox() }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/gmail/send', requireAuth, async (req, res) => {
  try { await sendGmail(req.body); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/calendar/events', requireAuth, async (req, res) => {
  try { res.json({ events: await getCalendarEvents() }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/calendar/create', requireAuth, async (req, res) => {
  try { res.json({ success: true, event: await createCalendarEvent(req.body) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Daily Agenda Route (protected) ──────────────────────────────────────────
app.post('/api/agent/daily-agenda', requireAuth, async (req, res) => {
  try {
    const today = req.body.date || new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const completion = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: MASTER_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Generate a focused daily agenda for Witson at Endeavor Evolution Enterprises for ${today}. Include morning priorities, follow-up tasks, and end-of-day goals based on the business (Credit Repair, Funding, LLC Formation).` }],
    });
    res.json({ response: completion.content[0].text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Funding Roadmap Route (protected) ───────────────────────────────────────
app.post('/api/funding-roadmap', requireAuth, async (req, res) => {
  try {
    const prompt = req.body.prompt || 'Generate a funding roadmap';
    const completion = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: MASTER_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    });
    res.json({ response: completion.content[0].text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Dispute Letter Route (protected) ────────────────────────────────────────
app.post('/api/dispute', requireAuth, async (req, res) => {
  try {
    const prompt = req.body.prompt || 'Generate a dispute letter';
    const completion = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: MASTER_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    });
    res.json({ response: completion.content[0].text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Claude general route (protected) ────────────────────────────────────────
app.post('/api/claude', requireAuth, async (req, res) => {
  try {
    const prompt = req.body.prompt || req.body.message;
    const completion = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: MASTER_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    });
    res.json({ response: completion.content[0].text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Main Chat Route (protected) ─────────────────────────────────────────────
app.post(['/api/chat', '/api/agent'], requireAuth, async (req, res) => {
  // Accept both { message } and { prompt } from frontend
  const { message = req.body.prompt, history = [] } = req.body;

  try {
    const messages = [...history, { role: 'user', content: message }];
    const completion = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: MASTER_SYSTEM_PROMPT,
      messages,
    });

    const response = completion.content[0].text.trim();
    let action = null;

    if (response.startsWith('ACTION:GET_LEADS')) {
      action = 'GET_LEADS';
      const allLeads = await getMondayLeads();
      let html = '<strong>📋 Monday CRM Leads</strong><br><br>';
      for (const board of allLeads) {
        html += `<strong>${board.division} — ${board.boardName}</strong><br>`;
        if (board.leads.length === 0) { html += 'No leads found.<br>'; }
        else { board.leads.forEach(lead => { html += `• ${lead.name}<br>`; }); }
        html += '<br>';
      }
      return res.json({ reply: html, response: html, action });
    }

    if (response.startsWith('ACTION:ONBOARDING')) {
      action = 'ONBOARDING';
      return res.json({ reply: `<strong>🚀 New Lead Onboarding</strong><br><br>Please provide:<br>• Full Name<br>• Email Address<br>• Phone Number<br>• Service Needed (Credit / Funding / LLC)<br>• Notes`, response: `<strong>🚀 New Lead Onboarding</strong><br><br>Please provide:<br>• Full Name<br>• Email Address<br>• Phone Number<br>• Service Needed (Credit / Funding / LLC)<br>• Notes`, action });
    }

    if (response.startsWith('ACTION:GET_TASKS')) {
      action = 'GET_TASKS';
      const data = await getNotionTasks();
      const tasks = data.results || [];
      let html = '<strong>✅ Notion Tasks</strong><br><br>';
      if (tasks.length === 0) { html += 'No tasks found.'; }
      else {
        tasks.forEach(t => {
          const title = t.properties?.['Task name']?.title?.[0]?.text?.content || 'Untitled';
          const status = t.properties?.Status?.status?.name || 'No status';
          const due = t.properties?.['Due date']?.date?.start || '';
          html += `• <strong>${title}</strong> — ${status}${due ? ' | Due: ' + due : ''}<br>`;
        });
      }
      return res.json({ reply: html, response: html, action });
    }

    if (response.startsWith('ACTION:CREATE_TASK')) {
      action = 'CREATE_TASK';
      const titleMatch = message.match(/task[:\s]+(.+)/i);
      const title = titleMatch ? titleMatch[1].trim() : message;
      await createNotionTask(title);
      return res.json({ reply: `✅ Task created: <strong>${title}</strong>`, response: `✅ Task created: <strong>${title}</strong>`, action });
    }

    if (response.startsWith('ACTION:GET_EMAILS')) {
      action = 'GET_EMAILS';
      const emails = await getGmailInbox();
      let html = '<strong>📬 Gmail Inbox (Latest 10)</strong><br><br>';
      if (emails.length === 0) { html += 'No emails found.'; }
      else {
        emails.forEach(e => {
          html += `<strong>${e.subject || '(no subject)'}</strong><br>`;
          html += `From: ${e.from}<br>`;
          html += `<em>${e.snippet}</em><br><br>`;
        });
      }
      return res.json({ reply: html, response: html, action });
    }

    if (response && response.startsWith('ACTION:SEND_EMAIL:')) {
      action = 'SEND_EMAIL';
      try {
        const jsonStr = response.replace('ACTION:SEND_EMAIL:', '').trim();
        const payload = JSON.parse(jsonStr);
        await sendGmail(payload);
        return res.json({ reply: `✅ Email sent to <strong>${payload.to}</strong>`, response: `✅ Email sent to <strong>${payload.to}</strong>`, action });
      } catch (parseErr) {
        const toMatch = message.match(/to[:\s]+([^\s,]+@[^\s,]+)/i);
        const subjectMatch = message.match(/subject[:\s]+([^,\.]+)/i);
        const bodyMatch = message.match(/body[:\s]+(.+)/i);
        if (toMatch && subjectMatch && bodyMatch) {
          const payload = { to: toMatch[1].trim(), subject: subjectMatch[1].trim(), body: bodyMatch[1].trim() };
          await sendGmail(payload);
          return res.json({ reply: `✅ Email sent to <strong>${payload.to}</strong>`, response: `✅ Email sent to <strong>${payload.to}</strong>`, action });
        }
        return res.json({ reply: '⚠️ Format: "Send email to name@email.com subject: Subject body: Message"', response: '⚠️ Format: "Send email to name@email.com subject: Subject body: Message"', action });
      }
    }

    if (response.startsWith('ACTION:GET_CALENDAR_EVENTS')) {
      action = 'GET_CALENDAR_EVENTS';
      const events = await getCalendarEvents();
      let html = '<strong>📅 Upcoming Calendar Events</strong><br><br>';
      if (events.length === 0) { html += 'No upcoming events.'; }
      else {
        events.forEach(e => {
          const start = e.start?.dateTime || e.start?.date || '';
          const date = start ? new Date(start).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '';
          html += `• <strong>${e.summary || 'Untitled'}</strong>${date ? ' — ' + date : ''}<br>`;
        });
      }
      return res.json({ reply: html, response: html, action });
    }

    if (response.startsWith('ACTION:CREATE_CALENDAR_EVENT')) {
      action = 'CREATE_CALENDAR_EVENT';
      return res.json({ reply: `📅 To create an event, provide:<br>• Title<br>• Start date & time<br>• End date & time<br>• Description (optional)`, response: `📅 To create an event, provide:<br>• Title<br>• Start date & time<br>• End date & time<br>• Description (optional)`, action });
    }

    return res.json({ reply: response, response });

  } catch (err) {
    console.error('Chat error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ─── Health check (public) ────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    gmail: gmailTokens ? 'connected' : 'not connected',
    calendar: calendarTokens ? 'connected' : 'not connected',
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Endeavor Agent v3.0 running on port ${PORT} — Notion + Monday Lead Intelligence active`);
});
