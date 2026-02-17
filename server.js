/**
 * Dashboard App - Unified interface for all personal tools
 * 
 * Aggregates data from multiple apps:
 * - Reminders (panel: list, quick-add)
 * - Future: ClassQuizzes, Notes, Calendar, etc.
 * 
 * Each panel is independent and communicates via APIs.
 * 
 * @author Inacio Bo
 */

const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

// Config
const AUTH_SERVICE = process.env.AUTH_SERVICE || 'https://inacio-auth.fly.dev';
const COOKIE_NAME = 'auth_session';

// App registry - easy to add new apps
const APPS = {
  reminders: {
    name: 'Reminders',
    url: 'https://reminders-app.fly.dev',
    apiSecret: process.env.REMINDERS_API_SECRET || 'assistant-secret-key',
    icon: '✅',
    color: '#007AFF'
  },
  // Future apps:
  // classquizzes: { name: 'ClassQuizzes', url: '...', icon: '📝', color: '#...' },
  // notes: { name: 'Notes', url: '...', icon: '📓', color: '#...' },
  // calendar: { name: 'Calendar', url: '...', icon: '📅', color: '#...' },
};

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use(express.static('public'));

// Auth middleware
async function requireAuth(req, res, next) {
  const token = req.cookies[COOKIE_NAME] || req.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ 
        error: 'Not authenticated',
        loginUrl: `${AUTH_SERVICE}/login?returnTo=${encodeURIComponent(`https://inacio-dashboard.fly.dev${req.originalUrl}`)}`
      });
    }
    return res.redirect(`${AUTH_SERVICE}/login?returnTo=${encodeURIComponent(`https://inacio-dashboard.fly.dev${req.originalUrl}`)}`);
  }
  
  try {
    const fetch = (await import('node-fetch')).default;
    const response = await fetch(`${AUTH_SERVICE}/api/verify`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!response.ok) throw new Error('Invalid token');
    
    const data = await response.json();
    req.user = data.user;
    req.token = token;
    next();
  } catch (err) {
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ 
        error: 'Not authenticated',
        loginUrl: `${AUTH_SERVICE}/login`
      });
    }
    return res.redirect(`${AUTH_SERVICE}/login`);
  }
}

// Apply auth to all routes
app.use('/api', requireAuth);
app.use('/', requireAuth, express.static('public'));

// ============================================================================
// API Routes - App Proxies
// ============================================================================

// Get data from all apps (for dashboard overview)
app.get('/api/overview', async (req, res) => {
  const overview = {
    apps: {},
    timestamp: Date.now()
  };
  
  // Fetch from Reminders
  try {
    const fetch = (await import('node-fetch')).default;
    const remindersRes = await fetch(`${APPS.reminders.url}/api/external/reminders?secret=${APPS.reminders.apiSecret}&today=true`);
    const remindersData = await remindersRes.json();
    
    const statsRes = await fetch(`${APPS.reminders.url}/api/external/stats?secret=${APPS.reminders.apiSecret}`);
    const statsData = await statsRes.json();
    
    overview.apps.reminders = {
      name: 'Reminders',
      icon: '✅',
      color: '#007AFF',
      todayCount: remindersData.count || 0,
      total: statsData.stats?.total || 0,
      incomplete: statsData.stats?.incomplete || 0,
      overdue: statsData.stats?.overdue || 0,
      highPriority: statsData.stats?.highPriority || 0,
      items: remindersData.reminders?.slice(0, 5) || [] // Top 5 for today
    };
  } catch (err) {
    console.error('Failed to fetch reminders:', err);
    overview.apps.reminders = { error: 'Failed to load' };
  }
  
  res.json(overview);
});

// Proxy: Get reminders (with filters)
app.get('/api/reminders', async (req, res) => {
  try {
    const fetch = (await import('node-fetch')).default;
    const { folder, completed, today, tag, search } = req.query;
    
    let url = `${APPS.reminders.url}/api/external/reminders?secret=${APPS.reminders.apiSecret}`;
    if (folder) url += `&folder=${encodeURIComponent(folder)}`;
    if (completed !== undefined) url += `&completed=${completed}`;
    if (today) url += `&today=true`;
    if (tag) url += `&tag=${encodeURIComponent(tag)}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;
    
    const response = await fetch(url);
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch reminders' });
  }
});

// Proxy: Create reminder (quick add)
app.post('/api/reminders', async (req, res) => {
  try {
    const fetch = (await import('node-fetch')).default;
    const { title, notes = '', priority = 'normal' } = req.body;
    
    const response = await fetch(`${APPS.reminders.url}/api/external/reminder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: APPS.reminders.apiSecret,
        title,
        notes,
        priority
      })
    });
    
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create reminder' });
  }
});

// Proxy: Complete reminder
app.post('/api/reminders/:id/complete', async (req, res) => {
  try {
    const fetch = (await import('node-fetch')).default;
    const { id } = req.params;
    
    // First get the reminder to check current state
    const getRes = await fetch(`${APPS.reminders.url}/api/external/reminders?secret=${APPS.reminders.apiSecret}`);
    const data = await getRes.json();
    const reminder = data.reminders?.find(r => r.id === id);
    
    if (!reminder) {
      return res.status(404).json({ error: 'Reminder not found' });
    }
    
    // Toggle completion via bulk API
    const response = await fetch(`${APPS.reminders.url}/api/external/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: APPS.reminders.apiSecret,
        action: reminder.completed ? 'uncomplete' : 'complete',
        ids: [id]
      })
    });
    
    const result = await response.json();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update reminder' });
  }
});

// ============================================================================
// Start Server
// ============================================================================

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Dashboard app on port ${PORT}`);
});
