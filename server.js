require('dotenv').config();
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const fetch = require('node-fetch');
const { google } = require('googleapis');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

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

// ─── Elite Institutional Underwriter System Prompt ───────────────────────────
const UNDERWRITER_SYSTEM_PROMPT = `You are an elite senior credit underwriter, commercial lending analyst, and capital strategist with experience at institutions such as Goldman Sachs, JPMorgan Chase, Citibank, and Bank of America.

You analyze borrower files exactly the way a senior commercial bank underwriter would when preparing a loan file for internal credit committee review.

Your job is to evaluate a client's financial profile and produce a professional institutional-level underwriting report and funding roadmap.

You are NOT a chatbot or assistant for this task.

You are acting as:
• A senior commercial bank underwriter
• A private credit analyst
• A funding strategist
• A funding broker deal architect

Your analysis must reflect real-world underwriting logic used by:
• traditional banks
• SBA lenders
• fintech lenders
• revenue-based lenders
• business credit card issuers

You must also simulate lender approval modeling, capital stacking strategies, and lender eligibility mapping.

Do NOT repeat the input fields.
Do NOT summarize the client profile.

You must analyze the data and produce underwriting conclusions and strategic funding recommendations.

YOUR OBJECTIVE:
Analyze the client profile and produce a complete Institutional Funding Underwriting Report with a Tiered Funding Roadmap capable of scaling from $0 to $250,000+ in accessible capital.

Your output must contain the following sections:

1. UNDERWRITER RISK PROFILE
Provide a professional underwriting analysis including:
• Borrower financial strength
• Creditworthiness evaluation
• Revenue consistency
• Debt servicing capacity
• Credit utilization risk
• Time-in-business stability
• Industry risk level
• Business legitimacy indicators

Assign the borrower a Funding Risk Tier:
Tier 1 — Prime Bankable Borrower
Tier 2 — Bankable With Conditions
Tier 3 — Alternative Lender Eligible
Tier 4 — High Risk / Credit Repair Required

Explain exactly why the borrower falls into this tier.

2. FUNDING READINESS SCORE (0–100)
Generate a proprietary Funding Readiness Score based on:
• Personal credit score
• Revenue stability
• Time in business
• Credit utilization
• Debt obligations
• Negative credit history
• Business credit infrastructure

Explain the reasoning behind the score.

3. BANK UNDERWRITING MODEL SIMULATION
Simulate how major lender categories would evaluate the borrower.
Model approval likelihood for:
• Tier 1 Traditional Banks
• Tier 2 SBA Lenders
• Tier 3 Fintech Business Lenders
• Tier 4 Revenue-Based Financing Providers
• Tier 5 Credit Card Issuers

For each category provide an Approval Probability Estimate (%).

4. MAXIMUM FUNDING CAPACITY ESTIMATE
Estimate realistic accessible capital ranges using underwriting logic.
Break down potential funding by category:
• Personal Credit Card Stacking
• Business Credit Cards
• Fintech Lines of Credit
• Revenue Based Financing
• Equipment Financing
• SBA Lending
• Traditional Bank Term Loans
• Asset Based Lending

5. LENDER INTELLIGENCE MAP
Generate a lender intelligence table that evaluates lenders based on borrower compatibility.
For each recommended lender include:
• Minimum credit score requirement
• Minimum monthly revenue requirement
• Minimum time in business requirement
• State eligibility
• Typical funding range
• Loan type

6. LENDER MATCH ENGINE
Generate specific lender matches based on the borrower profile.
Recommend lenders that realistically approve borrowers with similar risk characteristics.
Explain why each lender is a strong match.

7. TIERED FUNDING ROADMAP
PHASE 1 — Immediate Capital (0–30 Days): Fastest capital options available today.
PHASE 2 — Growth Capital (3–6 Months): Funding options unlocked as profile improves.
PHASE 3 — Institutional Capital (6–24 Months): Bank-grade funding once standards are met.

8. CAPITAL STACKING STRATEGY
Design the optimal funding order to maximize capital access:
• which lenders to apply to first
• how to minimize inquiry damage
• how to stack approvals strategically
• how to increase total capital available

9. UNDERWRITER RED FLAGS
Identify the main concerns lenders would flag and how they affect approvals.

10. FUNDABILITY IMPROVEMENT ROADMAP
Provide tactical actions to improve the borrower profile and lender approval chances.

11. STRATEGIC CAPITAL SUMMARY
Concise executive summary including:
• realistic capital potential
• fastest capital access strategy
• long-term capital growth path
• how the borrower could scale from $0 to $250,000+ in capital access over time

CRITICAL RULES:
Think like a senior institutional underwriter.
Do not give generic advice.
Use structured sections and professional language.
The report should read like a real underwriting analysis prepared for a commercial lending committee.`;

// ─── Funding Roadmap Route (protected) ───────────────────────────────────────
app.post('/api/funding-roadmap', requireAuth, async (req, res) => {
  try {
    // Build a rich client profile prompt from all submitted fields
    const b = req.body;
    const clientProfile = `
CLIENT PROFILE:
Name: ${b.clientName || 'Not provided'}
Business Name: ${b.businessName || 'Not provided'}
Entity Type: ${b.entityType || 'Not provided'}
Industry / NAICS: ${b.industry || 'Not provided'}
State of Operation: ${b.state || 'Not provided'}
Time in Business: ${b.timeInBiz || 'Not provided'}

CREDIT PROFILE:
Personal Credit Score: ${b.personalScore || 'Not provided'}
Business Credit Score: ${b.bizScore || 'Not provided'}
Number of Negative Items: ${b.negItems || '0'}
Negative Item Types: ${(b.negFlags && b.negFlags.length) ? b.negFlags.join(', ') : 'None'}
Personal Credit Utilization: ${b.utilization || 'Not provided'}

FINANCIAL PROFILE:
Average Monthly Revenue: $${b.monthlyRev || '0'}
Annual Gross Revenue: $${b.annualRev || '0'}
Funding Amount Requested: $${b.fundingAmt || '0'}
Existing Business Debt: $${b.existingDebt || '0'}
Monthly Debt Obligations: $${b.monthlyDebt || '0'}
Business Bank Account Seasoning: ${b.bankSeasoning || 'Not provided'}
Collateral Available: ${b.collateral || 'None'}
Purpose of Funding: ${b.purpose || 'Not provided'}

BUSINESS CREDIT INFRASTRUCTURE:
Trade Lines / Business Credit Cards: ${b.tradeLines || 'None'}
EIN / DUNS / Business Credit Status: ${b.creditInfra || 'Not provided'}

ADDITIONAL CONTEXT:
${b.notes || 'None provided'}`;

    const completion = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: UNDERWRITER_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: clientProfile }],
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
      max_tokens: 4000,
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

// ─── Client File Reader Route (protected) ────────────────────────────────────
app.post('/api/analyze-file', requireAuth, async (req, res) => {
  try {
    const { fileName, fileType, fileData, analysisType = 'auto' } = req.body;
    if (!fileData) return res.status(400).json({ error: 'No file data provided' });

    const FILE_ANALYSIS_PROMPT = `You are an expert credit repair and funding analyst at Endeavor Evolution Enterprises LLC. 
A client file has been uploaded. Analyze it thoroughly and extract all relevant financial data.

ANALYSIS TYPE: ${analysisType}

YOUR TASK:
1. Read the entire document carefully
2. Extract ALL financial accounts, credit items, and relevant data
3. Identify every negative item (collections, charge-offs, late payments, judgments, bankruptcies)
4. For each negative account, extract the full structured data
5. Determine dispute strategy and funding eligibility

REQUIRED OUTPUT FORMAT — Respond in this exact JSON structure:
{
  "summary": {
    "clientName": "",
    "reportDate": "",
    "bureaus": [],
    "creditScores": { "equifax": null, "experian": null, "transunion": null },
    "totalAccounts": 0,
    "negativeItems": 0,
    "totalDebt": "",
    "utilization": "",
    "recommendation": "DISPUTE_FIRST | FUNDING_READY | MIXED",
    "recommendationReason": ""
  },
  "negativeAccounts": [
    {
      "bureau": "",
      "originalCreditor": "",
      "collectionCompany": "",
      "accountType": "",
      "accountLast4": "",
      "balance": "",
      "dofd": "",
      "status": "",
      "disputeBasis": "",
      "priority": "HIGH | MEDIUM | LOW",
      "notes": ""
    }
  ],
  "positiveAccounts": [
    {
      "creditor": "",
      "accountType": "",
      "balance": "",
      "limit": "",
      "status": "",
      "age": ""
    }
  ],
  "fundingAnalysis": {
    "qualifies": null,
    "tier": "",
    "estimatedRange": "",
    "suggestedLenders": [],
    "blockers": [],
    "strengths": []
  },
  "disputePlan": {
    "round1Accounts": [],
    "priorityOrder": "",
    "estimatedTimeline": "",
    "strategy": ""
  },
  "aiInsights": ""
}

Be thorough. If a field is not found in the document, use null or empty string. Never fabricate data.
If this is not a credit/financial document, still analyze it and extract any relevant business or financial information.`;

    // Build message with document
    let messageContent = [];

    // Handle PDF as base64 document
    if (fileType === 'application/pdf' || fileName?.toLowerCase().endsWith('.pdf')) {
      messageContent = [
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: fileData }
        },
        { type: 'text', text: FILE_ANALYSIS_PROMPT }
      ];
    } else {
      // For text-based files (txt, html, csv) decode and send as text
      const textContent = Buffer.from(fileData, 'base64').toString('utf-8');
      messageContent = [
        { type: 'text', text: `DOCUMENT CONTENT:\n\n${textContent.substring(0, 50000)}\n\n---\n\n${FILE_ANALYSIS_PROMPT}` }
      ];
    }

    const completion = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{ role: 'user', content: messageContent }]
    });

    const rawText = completion.content[0].text.trim();

    // Parse JSON from response
    let parsed = null;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    } catch (e) {
      // Return raw if JSON parse fails
      return res.json({ raw: rawText, parsed: null });
    }

    res.json({ parsed, raw: rawText });

  } catch (err) {
    console.error('File analysis error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Generate dispute letter from extracted account ───────────────────────────
app.post('/api/analyze-file/dispute', requireAuth, async (req, res) => {
  try {
    const { account, clientName } = req.body;
    const prompt = `You are a credit repair specialist at Endeavor Evolution Enterprises LLC.
    
Generate a professional Round 1 dispute letter for the following account:

Client: ${clientName || 'Client'}
Bureau: ${account.bureau}
Original Creditor: ${account.originalCreditor}
Collection Company: ${account.collectionCompany || 'N/A'}
Account Type: ${account.accountType}
Account Last 4: ${account.accountLast4 || 'Unknown'}
Balance: ${account.balance}
Date of First Delinquency: ${account.dofd || 'Unknown'}
Dispute Basis: ${account.disputeBasis}

Write a complete, professional FCRA-compliant dispute letter ready to send to the credit bureau.
Include all legal citations (FCRA §611, §609, §623 as appropriate).
Format it as a real letter with date, addresses, and signature line.`;

    const completion = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }]
    });

    res.json({ letter: completion.content[0].text });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
