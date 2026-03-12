#!/usr/bin/env node
/**
 * inject-file-reader.js
 * Run once: node inject-file-reader.js
 * Injects the Client File Reader panel into index.html
 */

const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, 'index.html');
if (!fs.existsSync(indexPath)) {
  console.error('❌ index.html not found in', __dirname);
  process.exit(1);
}

let html = fs.readFileSync(indexPath, 'utf-8');

if (html.includes('id="fileReaderPanel"')) {
  console.log('⚠️  Client File Reader already injected. Skipping.');
  process.exit(0);
}

// ─── File Reader CSS ──────────────────────────────────────────────────────────
const CSS = `
<style id="fileReaderStyles">
#fileReaderPanel { margin-top: 32px; }
#fileDropZone { border: 2px dashed #2dd4a0; border-radius: 14px; padding: 40px 20px; text-align: center; background: #f8fffc; cursor: pointer; transition: all 0.2s; }
#fileDropZone:hover { background: #e0fff5; border-color: #0d5c46; }
.fr-summary { background: linear-gradient(135deg, #0a2540, #1a4a7a); border-radius: 12px; padding: 20px; color: white; margin-bottom: 20px; }
.fr-tab-btn { padding: 8px 16px; border-radius: 8px; border: none; background: #e8f0fe; color: #0a2540; font-size: 0.85rem; cursor: pointer; font-weight: 600; transition: all 0.2s; }
.fr-tab-btn.active { background: #0a2540; color: white; }
.fr-account-card { background: #fff; border: 1px solid #e0e0e0; border-radius: 12px; padding: 16px; margin-bottom: 12px; }
.fr-account-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; margin-top: 12px; font-size: 0.83rem; }
.fr-account-grid span.label { color: #888; }
.fr-dispute-basis { margin-top: 8px; font-size: 0.82rem; background: #f8f9ff; border-radius: 8px; padding: 8px; color: #1a4a7a; }
.fr-badge { border-radius: 10px; padding: 2px 10px; font-size: 0.75rem; display: inline-block; }
.fr-score-box { text-align: center; background: #f4f6f9; border-radius: 10px; padding: 12px 18px; }
@keyframes frSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
.fr-spinning { animation: frSpin 1s linear infinite; display: inline-block; }
</style>`;

// ─── File Reader HTML ─────────────────────────────────────────────────────────
const HTML = `
<!-- ═══════════════════════════════════════════════════════════════════════════
     CLIENT FILE READER — Injected by inject-file-reader.js
     ═══════════════════════════════════════════════════════════════════════════ -->
<div class="card" id="fileReaderPanel">
  <h2 style="font-family:'Playfair Display',serif;color:#0a2540;font-size:1.4rem;margin-bottom:6px;">📂 Client File Reader</h2>
  <p style="color:#666;font-size:0.9rem;margin-bottom:20px;">Upload credit reports, funding profiles, or financial documents. The AI will extract, analyze, and organize everything instantly.</p>

  <!-- Upload Zone -->
  <div id="fileDropZone"
    ondragover="event.preventDefault();this.style.background='#e0fff5';this.style.borderColor='#0d5c46';"
    ondragleave="this.style.background='#f8fffc';this.style.borderColor='#2dd4a0';"
    ondrop="frHandleFileDrop(event)"
    onclick="document.getElementById('fileUploadInput').click()">
    <div style="font-size:2.5rem;margin-bottom:10px;">📄</div>
    <div style="font-weight:600;color:#0a2540;font-size:1rem;">Drag &amp; drop client file here</div>
    <div style="color:#888;font-size:0.85rem;margin-top:6px;">or click to browse — PDF, DOCX, XLSX, TXT, HTML, CSV</div>
    <input type="file" id="fileUploadInput" style="display:none;" accept=".pdf,.docx,.xlsx,.txt,.html,.csv" onchange="frHandleFileSelect(this)">
  </div>

  <!-- Analysis Type Selector -->
  <div style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
    <span style="font-size:0.85rem;color:#555;font-weight:600;">Analyze as:</span>
    <button onclick="frSetType('auto',this)" id="frtype-auto" class="fr-tab-btn active">🤖 Auto Detect</button>
    <button onclick="frSetType('credit_report',this)" id="frtype-credit_report" class="fr-tab-btn">📊 Credit Report</button>
    <button onclick="frSetType('funding_profile',this)" id="frtype-funding_profile" class="fr-tab-btn">🏦 Funding Profile</button>
    <button onclick="frSetType('financial_doc',this)" id="frtype-financial_doc" class="fr-tab-btn">📋 Financial Doc</button>
  </div>

  <!-- Processing Indicator -->
  <div id="frProcessing" style="display:none;text-align:center;padding:40px 20px;color:#0d5c46;">
    <div class="fr-spinning" style="font-size:2rem;">⚙️</div>
    <div style="margin-top:12px;font-weight:700;font-size:1rem;">AI is analyzing the document...</div>
    <div id="frProcessingStatus" style="font-size:0.85rem;color:#888;margin-top:6px;"></div>
  </div>

  <!-- Results Panel -->
  <div id="frResults" style="display:none;margin-top:24px;">

    <!-- Summary Bar -->
    <div id="frSummaryBar" class="fr-summary"></div>

    <!-- Result Tabs -->
    <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;">
      <button onclick="frShowTab('negative')" id="frtab-negative" class="fr-tab-btn active">⚠️ Negative Items</button>
      <button onclick="frShowTab('dispute')" id="frtab-dispute" class="fr-tab-btn">📝 Dispute Plan</button>
      <button onclick="frShowTab('funding')" id="frtab-funding" class="fr-tab-btn">🏦 Funding Analysis</button>
      <button onclick="frShowTab('positive')" id="frtab-positive" class="fr-tab-btn">✅ Positive Accounts</button>
      <button onclick="frShowTab('insights')" id="frtab-insights" class="fr-tab-btn">💡 AI Insights</button>
    </div>

    <div id="frtab-content-negative"><div id="frNegativeTable"></div></div>
    <div id="frtab-content-dispute" style="display:none;"><div id="frDisputePlan"></div></div>
    <div id="frtab-content-funding" style="display:none;"><div id="frFundingAnalysis"></div></div>
    <div id="frtab-content-positive" style="display:none;"><div id="frPositiveAccounts"></div></div>
    <div id="frtab-content-insights" style="display:none;"><div id="frAiInsights"></div></div>

    <!-- Generated Letter Box -->
    <div id="frLetterBox" style="display:none;margin-top:24px;background:#f8f9ff;border-radius:12px;padding:20px;border:1px solid #dde;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <strong style="color:#0a2540;font-size:1rem;">📝 Generated Dispute Letter</strong>
        <div style="display:flex;gap:8px;">
          <button onclick="frCopyLetter()" style="padding:6px 14px;background:#0a2540;color:white;border:none;border-radius:8px;cursor:pointer;font-size:0.82rem;">📋 Copy</button>
          <button onclick="document.getElementById('frLetterBox').style.display='none'" style="padding:6px 12px;background:#eee;color:#333;border:none;border-radius:8px;cursor:pointer;font-size:0.82rem;">✕</button>
        </div>
      </div>
      <pre id="frLetterText" style="white-space:pre-wrap;font-family:'DM Sans',sans-serif;font-size:0.88rem;color:#333;line-height:1.7;max-height:500px;overflow-y:auto;"></pre>
    </div>
  </div>
</div>`;

// ─── File Reader JavaScript ───────────────────────────────────────────────────
const JS = `
<script id="fileReaderScript">
// ─── Client File Reader Module ────────────────────────────────────────────────
window._frType = 'auto';
window._frData = null;

function frSetType(type, btn) {
  window._frType = type;
  document.querySelectorAll('[id^="frtype-"]').forEach(function(b) { b.classList.remove('active'); });
  btn.classList.add('active');
}

function frShowTab(tab) {
  ['negative','dispute','funding','positive','insights'].forEach(function(t) {
    document.getElementById('frtab-content-' + t).style.display = t === tab ? 'block' : 'none';
    var btn = document.getElementById('frtab-' + t);
    if (btn) { btn.classList.toggle('active', t === tab); }
  });
}

function frHandleFileDrop(e) {
  e.preventDefault();
  var dz = document.getElementById('fileDropZone');
  dz.style.background = '#f8fffc';
  dz.style.borderColor = '#2dd4a0';
  var file = e.dataTransfer.files[0];
  if (file) frProcessFile(file);
}

function frHandleFileSelect(input) {
  var file = input.files[0];
  if (file) frProcessFile(file);
  input.value = '';
}

function frProcessFile(file) {
  document.getElementById('frProcessing').style.display = 'block';
  document.getElementById('frResults').style.display = 'none';
  document.getElementById('frLetterBox').style.display = 'none';
  document.getElementById('frProcessingStatus').textContent = 'Reading: ' + file.name + ' (' + (file.size / 1024).toFixed(1) + ' KB)';

  var reader = new FileReader();
  reader.onload = function(e) {
    var base64 = e.target.result.split(',')[1];
    document.getElementById('frProcessingStatus').textContent = 'Sending to Claude AI for deep analysis...';
    fetch('/api/analyze-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: file.name, fileType: file.type, fileData: base64, analysisType: window._frType })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      document.getElementById('frProcessing').style.display = 'none';
      if (data.error) { alert('Analysis error: ' + data.error); return; }
      frRenderResults(data.parsed || {}, file.name);
    })
    .catch(function(err) {
      document.getElementById('frProcessing').style.display = 'none';
      alert('Error: ' + err.message);
    });
  };
  reader.readAsDataURL(file);
}

function frRenderResults(p, fileName) {
  window._frData = p;
  document.getElementById('frResults').style.display = 'block';

  // ── Summary Bar ────────────────────────────────────────────────────────────
  var rec = (p.summary && p.summary.recommendation) || 'REVIEW';
  var recColor = rec === 'FUNDING_READY' ? '#2dd4a0' : rec === 'DISPUTE_FIRST' ? '#fc8181' : '#f6ad55';
  var scores = (p.summary && p.summary.creditScores) || {};
  var scoreHtml = ['equifax','experian','transunion'].map(function(b) {
    var s = scores[b];
    var c = !s ? '#888' : s >= 720 ? '#2dd4a0' : s >= 640 ? '#f6ad55' : '#fc8181';
    return '<div class="fr-score-box"><div style="font-size:0.72rem;color:#888;text-transform:uppercase;">' + b + '</div><div style="font-size:1.5rem;font-weight:700;color:' + c + ';">' + (s || '—') + '</div></div>';
  }).join('');

  document.getElementById('frSummaryBar').innerHTML =
    '<div style="display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start;">' +
      '<div style="flex:1;min-width:200px;">' +
        '<div style="font-size:0.72rem;opacity:0.7;text-transform:uppercase;letter-spacing:1px;">Client</div>' +
        '<div style="font-size:1.2rem;font-weight:700;">' + ((p.summary && p.summary.clientName) || fileName) + '</div>' +
        '<div style="margin-top:12px;display:flex;gap:12px;flex-wrap:wrap;">' +
          '<div><div style="font-size:0.7rem;opacity:0.7;">ACCOUNTS</div><div style="font-size:1.1rem;font-weight:700;">' + ((p.summary && p.summary.totalAccounts) || '—') + '</div></div>' +
          '<div><div style="font-size:0.7rem;opacity:0.7;">NEGATIVES</div><div style="font-size:1.1rem;font-weight:700;color:#fc8181;">' + ((p.negativeAccounts && p.negativeAccounts.length) || 0) + '</div></div>' +
          '<div><div style="font-size:0.7rem;opacity:0.7;">TOTAL DEBT</div><div style="font-size:1.1rem;font-weight:700;">' + ((p.summary && p.summary.totalDebt) || '—') + '</div></div>' +
          '<div><div style="font-size:0.7rem;opacity:0.7;">UTILIZATION</div><div style="font-size:1.1rem;font-weight:700;">' + ((p.summary && p.summary.utilization) || '—') + '</div></div>' +
        '</div>' +
      '</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;">' + scoreHtml + '</div>' +
      '<div style="margin-left:auto;display:flex;align-items:flex-start;">' +
        '<div style="background:' + recColor + ';color:#0a2540;padding:8px 18px;border-radius:20px;font-weight:700;font-size:0.85rem;white-space:nowrap;">' + rec + '</div>' +
      '</div>' +
    '</div>' +
    '<div style="margin-top:10px;font-size:0.85rem;opacity:0.85;">' + ((p.summary && p.summary.recommendationReason) || '') + '</div>';

  // ── Negative Accounts ──────────────────────────────────────────────────────
  var neg = p.negativeAccounts || [];
  var negHtml = '';
  if (neg.length === 0) {
    negHtml = '<div style="padding:20px;text-align:center;color:#888;">No negative accounts identified in this document.</div>';
  } else {
    neg.forEach(function(a, i) {
      var pColor = a.priority === 'HIGH' ? '#fc8181' : a.priority === 'MEDIUM' ? '#f6ad55' : '#68d391';
      negHtml +=
        '<div class="fr-account-card" style="border-left:4px solid ' + pColor + ';">' +
          '<div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;">' +
            '<div>' +
              '<span style="font-weight:700;color:#0a2540;font-size:1rem;">' + (a.originalCreditor || a.collectionCompany || 'Unknown Creditor') + '</span>' +
              ' <span class="fr-badge" style="background:#0a2540;color:white;">' + (a.accountType || '—') + '</span>' +
              ' <span class="fr-badge" style="background:' + pColor + ';color:white;">' + (a.priority || 'MEDIUM') + '</span>' +
            '</div>' +
            '<button onclick="frGenerateLetter(' + i + ')" style="padding:7px 16px;background:linear-gradient(135deg,#0a2540,#1a4a7a);color:white;border:none;border-radius:8px;cursor:pointer;font-size:0.82rem;font-weight:600;">✍️ Draft Letter</button>' +
          '</div>' +
          '<div class="fr-account-grid">' +
            '<div><span class="label">Bureau:</span> ' + (a.bureau || '—') + '</div>' +
            '<div><span class="label">Collection Co:</span> ' + (a.collectionCompany || '—') + '</div>' +
            '<div><span class="label">Account #:</span> ****' + (a.accountLast4 || '—') + '</div>' +
            '<div><span class="label">Balance:</span> ' + (a.balance || '—') + '</div>' +
            '<div><span class="label">DOFD:</span> ' + (a.dofd || '—') + '</div>' +
            '<div><span class="label">Status:</span> ' + (a.status || '—') + '</div>' +
          '</div>' +
          '<div class="fr-dispute-basis"><strong>Dispute Basis:</strong> ' + (a.disputeBasis || '—') + '</div>' +
          (a.notes ? '<div style="margin-top:6px;font-size:0.8rem;color:#666;">' + a.notes + '</div>' : '') +
        '</div>';
    });
  }
  document.getElementById('frNegativeTable').innerHTML = negHtml;

  // ── Dispute Plan ───────────────────────────────────────────────────────────
  var dp = p.disputePlan || {};
  document.getElementById('frDisputePlan').innerHTML =
    '<div style="background:#fff8f0;border-radius:12px;padding:20px;border:1px solid #f6ad55;">' +
      '<h3 style="color:#0a2540;margin-bottom:14px;">📋 Recommended Dispute Strategy</h3>' +
      '<div style="margin-bottom:10px;"><strong>Strategy:</strong> ' + (dp.strategy || '—') + '</div>' +
      '<div style="margin-bottom:10px;"><strong>Priority Order:</strong> ' + (dp.priorityOrder || '—') + '</div>' +
      '<div style="margin-bottom:10px;"><strong>Estimated Timeline:</strong> ' + (dp.estimatedTimeline || '—') + '</div>' +
      '<div><strong>Round 1 Accounts:</strong><ul style="margin-top:6px;padding-left:20px;">' +
        ((dp.round1Accounts || []).map(function(a) { return '<li style="margin-bottom:4px;">' + a + '</li>'; }).join('') || '<li style="color:#888;">None specified</li>') +
      '</ul></div>' +
    '</div>';

  // ── Funding Analysis ───────────────────────────────────────────────────────
  var fa = p.fundingAnalysis || {};
  var qualColor = fa.qualifies === true ? '#2dd4a0' : fa.qualifies === false ? '#fc8181' : '#f6ad55';
  var qualText = fa.qualifies === true ? '✅ QUALIFIES FOR FUNDING' : fa.qualifies === false ? '❌ DOES NOT QUALIFY' : '⚠️ NEEDS REVIEW';
  document.getElementById('frFundingAnalysis').innerHTML =
    '<div style="background:#f0fff8;border-radius:12px;padding:20px;border:1px solid #2dd4a0;">' +
      '<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap;">' +
        '<div style="background:' + qualColor + ';color:white;border-radius:12px;padding:8px 20px;font-weight:700;font-size:0.9rem;">' + qualText + '</div>' +
        (fa.tier ? '<div><strong>Tier:</strong> ' + fa.tier + '</div>' : '') +
        (fa.estimatedRange ? '<div><strong>Est. Range:</strong> ' + fa.estimatedRange + '</div>' : '') +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">' +
        '<div><strong style="color:#0d5c46;">✅ Strengths</strong><ul style="margin-top:6px;padding-left:18px;">' +
          ((fa.strengths || []).map(function(s) { return '<li style="font-size:0.85rem;margin-bottom:4px;">' + s + '</li>'; }).join('') || '<li style="color:#888;">—</li>') +
        '</ul></div>' +
        '<div><strong style="color:#e53e3e;">❌ Blockers</strong><ul style="margin-top:6px;padding-left:18px;">' +
          ((fa.blockers || []).map(function(b) { return '<li style="font-size:0.85rem;margin-bottom:4px;">' + b + '</li>'; }).join('') || '<li style="color:#888;">—</li>') +
        '</ul></div>' +
      '</div>' +
      (fa.suggestedLenders && fa.suggestedLenders.length ? '<div style="margin-top:14px;"><strong>Suggested Lenders:</strong> ' + fa.suggestedLenders.join(', ') + '</div>' : '') +
    '</div>';

  // ── Positive Accounts ──────────────────────────────────────────────────────
  var pos = p.positiveAccounts || [];
  document.getElementById('frPositiveAccounts').innerHTML = pos.length === 0
    ? '<p style="color:#888;padding:12px;">No positive accounts identified.</p>'
    : pos.map(function(a) {
        return '<div style="background:#f0fff8;border:1px solid #c6f6d5;border-radius:10px;padding:12px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">' +
          '<div><strong>' + (a.creditor || '—') + '</strong> <span style="color:#888;font-size:0.82rem;">' + (a.accountType || '') + '</span></div>' +
          '<div style="font-size:0.82rem;color:#555;">Balance: ' + (a.balance || '—') + ' | Limit: ' + (a.limit || '—') + ' | Age: ' + (a.age || '—') + '</div>' +
          '<span class="fr-badge" style="background:#2dd4a0;color:white;">' + (a.status || '—') + '</span>' +
        '</div>';
      }).join('');

  // ── AI Insights ────────────────────────────────────────────────────────────
  document.getElementById('frAiInsights').innerHTML =
    '<div style="background:#f4f6f9;border-radius:12px;padding:20px;white-space:pre-wrap;font-size:0.9rem;line-height:1.7;color:#333;">' +
    (p.aiInsights || 'No additional insights available.') + '</div>';

  frShowTab('negative');
  document.getElementById('fileReaderPanel').scrollIntoView({ behavior: 'smooth' });
}

function frGenerateLetter(index) {
  var p = window._frData;
  if (!p || !p.negativeAccounts) return;
  var account = p.negativeAccounts[index];
  var clientName = (p.summary && p.summary.clientName) || 'Client';
  var box = document.getElementById('frLetterBox');
  var txt = document.getElementById('frLetterText');
  box.style.display = 'block';
  txt.textContent = 'Generating dispute letter for ' + (account.originalCreditor || account.collectionCompany || 'account') + '...';
  box.scrollIntoView({ behavior: 'smooth' });

  fetch('/api/analyze-file/dispute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: account, clientName: clientName })
  })
  .then(function(r) { return r.json(); })
  .then(function(data) { txt.textContent = data.letter || data.error || 'No letter generated'; })
  .catch(function(err) { txt.textContent = 'Error: ' + err.message; });
}

function frCopyLetter() {
  var text = document.getElementById('frLetterText').textContent;
  navigator.clipboard.writeText(text).then(function() { alert('Letter copied to clipboard!'); });
}
</script>`;

// ─── Inject into index.html ───────────────────────────────────────────────────
// 1. Add CSS before </head>
if (html.includes('</head>')) {
  html = html.replace('</head>', CSS + '\n</head>');
} else {
  html = CSS + '\n' + html;
}

// 2. Add JS before </body>
if (html.includes('</body>')) {
  html = html.replace('</body>', JS + '\n</body>');
} else {
  html = html + '\n' + JS;
}

// 3. Find first .card div and inject File Reader panel after it
// Look for the closing of first card
const firstCardEnd = html.indexOf('</div>', html.indexOf('class="card"'));
if (firstCardEnd !== -1) {
  // Find a clean injection point after the first card block
  // We'll inject before the leadIntelPanel or second card
  const markerOptions = [
    'id="leadIntelPanel"',
    '<!-- Lead',
    'Funding — AI Underwriter',
    'id="fClientName"',
  ];
  
  let injected = false;
  for (const marker of markerOptions) {
    const markerIdx = html.indexOf(marker);
    if (markerIdx !== -1) {
      // Find the opening <div of this block
      let insertAt = html.lastIndexOf('<div', markerIdx);
      html = html.slice(0, insertAt) + HTML + '\n\n' + html.slice(insertAt);
      injected = true;
      console.log('✅ Injected File Reader before: ' + marker);
      break;
    }
  }
  
  if (!injected) {
    // Last resort — append before </body>
    html = html.replace('</body>', HTML + '\n</body>');
    console.log('✅ Injected File Reader before </body>');
  }
} else {
  html = html.replace('</body>', HTML + '\n</body>');
}

// ─── Write back ───────────────────────────────────────────────────────────────
fs.writeFileSync(indexPath, html, 'utf-8');
console.log('✅ index.html updated successfully!');
console.log('');
console.log('Next steps:');
console.log('  cd ~/endeavor-agent');
console.log('  git add index.html server.js');
console.log('  git commit -m "Add Client File Reader system"');
console.log('  git push');