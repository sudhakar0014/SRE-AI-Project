const $ = (selector) => document.querySelector(selector);
const welcome = $('#welcome');
const conversation = $('#conversation');
const input = $('#messageInput');
const sendButton = $('#sendButton');
let activeIncidentId = null;
let toastTimer;

const scenarios = {
  pods: 'Several pods in our production EKS cluster are in CrashLoopBackOff. Two containers show OOMKilled in their last termination state, and restarts increased after the latest deployment. Help me investigate safely. What evidence should I collect first?',
  latency: 'Our API p95 latency rose from 180 ms to 2.4 seconds over the last 15 minutes, and HTTP 5xx responses increased to 7%. CPU is around 90% on two nodes. Help me prioritize likely causes and safe diagnostic checks.',
  capacity: 'Several Kubernetes pods are stuck Pending. Karpenter has not provisioned new nodes. Pod events mention insufficient CPU and one node pool has taints. Walk me through a systematic investigation.',
  deploy: 'After a production deployment, error rates increased and background jobs began failing. Help me assess whether this is a deployment regression, what evidence to compare, and how to evaluate a safe rollback.'
};
function toast(message) {
  const el = $('#toast'); el.textContent = message; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
// Minimal Markdown renderer for model output. Raw HTML is escaped before formatting.
function markdown(value) {
  let s = escapeHtml(value).replace(/```([\s\S]*?)```/g, (_, code) => `<pre><code>${code.trim()}</code></pre>`);
  s = s.replace(/^### (.+)$/gm, '<h3>$1</h3>').replace(/^## (.+)$/gm, '<h2>$1</h2>').replace(/^# (.+)$/gm, '<h1>$1</h1>');
  s = s.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>').replace(/^\s*[-*] (.+)$/gm, '<li>$1</li>').replace(/(?:<li>.*<\/li>\n?)+/gs, m => `<ul>${m}</ul>`);
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>');
  return s.split(/\n{2,}/).map(block => /^(<h[1-3]|<ul|<pre|<blockquote)/.test(block.trim()) ? block : `<p>${block.replace(/\n/g,'<br>')}</p>`).join('');
}
function addMessage(role, content, thinking = false) {
  welcome.classList.add('hidden'); conversation.classList.add('active');
  const node = document.createElement('article'); node.className = `message ${role}`;
  node.innerHTML = `<div class="message-avatar">${role === 'assistant' ? '✳' : 'S'}</div><div class="message-body"><div class="message-meta">${role === 'assistant' ? 'SRE COPILOT' : 'YOU'} · ${new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</div><div class="message-content ${thinking ? 'thinking' : ''}">${thinking ? escapeHtml(content) : (role === 'assistant' ? markdown(content) : `<p>${escapeHtml(content).replace(/\n/g,'<br>')}</p>`)}</div></div>`;
  conversation.appendChild(node); conversation.scrollTop = conversation.scrollHeight; return node;
}
function resetChat() {
  activeIncidentId = null; conversation.innerHTML = ''; conversation.classList.remove('active'); welcome.classList.remove('hidden');
  $('#chatView').classList.remove('hidden'); $('#incidentsView').classList.add('hidden'); $('#pageTitle').textContent = 'AI incident investigator';
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === 'chat'));
  input.focus();
}
async function sendMessage(text = input.value) {
  const message = text.trim(); if (!message || sendButton.disabled) return;
  input.value = ''; input.style.height = 'auto'; addMessage('user', message);
  sendButton.disabled = true;
  const loading = addMessage('assistant', 'Reviewing the incident and preparing safe next steps…', true);
  try {
    const response = await fetch('/api/chat', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({message, incidentId:activeIncidentId})});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Request failed');
    activeIncidentId = data.incidentId;
    loading.remove(); addMessage('assistant', data.answer || 'No response was returned.');
    await refreshIncidents();
  } catch (error) {
    loading.remove(); addMessage('assistant', `I couldn't complete the request. ${error.message}\n\nCheck that the Worker is running, the D1 migration has been applied, and Workers AI is enabled.`); toast('Request failed');
  } finally { sendButton.disabled = false; input.focus(); }
}
async function refreshIncidents() {
  try {
    const response = await fetch('/api/incidents'); if (!response.ok) return;
    const data = await response.json(); const items = data.incidents || [];
    $('#incidentCount').textContent = items.length;
    $('#incidentList').innerHTML = items.length ? items.map(item => `<article class="incident-card" data-id="${escapeHtml(item.id)}"><div class="incident-info"><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.summary || 'No summary available')}</p></div><span class="severity ${escapeHtml(item.severity)}">${escapeHtml(item.severity)}</span><span class="incident-date">${new Date(item.updated_at).toLocaleDateString()}</span></article>`).join('') : '<div class="empty-state">No incidents yet. Start an investigation or try a sample scenario.</div>';
  } catch { /* The UI remains usable while local services are starting. */ }
}
async function openIncident(incidentId) {
  try {
    const response = await fetch(`/api/incidents/${encodeURIComponent(incidentId)}`); const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load incident');
    activeIncidentId = incidentId; conversation.innerHTML = ''; welcome.classList.add('hidden'); conversation.classList.add('active');
    $('#incidentsView').classList.add('hidden'); $('#chatView').classList.remove('hidden'); $('#pageTitle').textContent = 'Incident investigation';
    document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === 'chat'));
    (data.messages || []).forEach(m => addMessage(m.role === 'user' ? 'user' : 'assistant', m.content));
  } catch (error) { toast(error.message); }
}
async function showIncidents() {
  $('#chatView').classList.add('hidden'); $('#incidentsView').classList.remove('hidden'); $('#pageTitle').textContent = 'Incident history';
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === 'incidents'));
  await refreshIncidents();
}
sendButton.addEventListener('click', () => sendMessage());
input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight,180)}px`; });
$('#newIncident').addEventListener('click', resetChat); $('#emptyNew').addEventListener('click', resetChat); $('#refreshButton').addEventListener('click', refreshIncidents);
document.querySelectorAll('[data-view="incidents"]').forEach(el => el.addEventListener('click', showIncidents));
document.querySelectorAll('[data-view="chat"]').forEach(el => el.addEventListener('click', resetChat));
document.querySelectorAll('[data-scenario]').forEach(el => el.addEventListener('click', () => { const prompt = scenarios[el.dataset.scenario]; if (prompt) sendMessage(prompt); }));
$('#incidentList').addEventListener('click', e => { const card = e.target.closest('[data-id]'); if (card) openIncident(card.dataset.id); });
refreshIncidents();
