/**
 * Dashboard App - Simplified Auth
 * 
 * Token passed via URL only. No cookies, no localStorage.
 */

const express = require('express');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 8080;

// Config
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const AUTH_SERVICE = 'https://inacio-auth.fly.dev';

// App registry
const APPS = {
  reminders: {
    name: 'Reminders',
    url: 'https://reminders-app.fly.dev',
    apiSecret: process.env.REMINDERS_API_SECRET || 'assistant-secret-key',
    icon: '✅',
    color: '#007AFF'
  },
  classquizzes: {
    name: 'ClassQuizzes',
    url: 'https://classquizzes.fly.dev',
    icon: '📝',
    color: '#5856D6'
  },
  seminars: {
    name: 'Seminars',
    url: 'https://seminars-app.fly.dev',
    apiSecret: process.env.SEMINARS_API_SECRET || 'seminars-api-secret-for-dashboard',
    icon: '🎓',
    color: '#FF9500'
  }
};

app.use(express.json());
app.use(express.static('public'));

// Auth middleware - check token from query or header
function checkAuth(req, res, next) {
  const token = req.query.token || req.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    // Redirect to login with return URL
    const currentUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    return res.redirect(`${AUTH_SERVICE}/login?returnTo=${encodeURIComponent(currentUrl)}`);
  }
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    req.token = token;
    next();
  } catch (err) {
    const currentUrl = `${req.protocol}://${req.get('host')}${req.path}`;
    return res.redirect(`${AUTH_SERVICE}/login?returnTo=${encodeURIComponent(currentUrl)}`);
  }
}

// API routes require auth
app.use('/api', checkAuth);

// ============================================================================
// API Routes
// ============================================================================

app.get('/api/overview', async (req, res) => {
  const overview = { apps: {}, timestamp: Date.now() };
  
  try {
    const fetch = (await import('node-fetch')).default;
    const remindersRes = await fetch(
      `${APPS.reminders.url}/api/external/reminders?secret=${APPS.reminders.apiSecret}&today=true`
    );
    const remindersData = await remindersRes.json();
    
    const statsRes = await fetch(
      `${APPS.reminders.url}/api/external/stats?secret=${APPS.reminders.apiSecret}`
    );
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
      items: remindersData.reminders?.slice(0, 5) || []
    };
  } catch (err) {
    console.error('Failed to fetch reminders:', err);
    overview.apps.reminders = { error: 'Failed to load' };
  }
  
  // Fetch from ClassQuizzes
  try {
    overview.apps.classquizzes = {
      name: 'ClassQuizzes',
      icon: '📝',
      color: '#5856D6',
      url: `${APPS.classquizzes.url}/admin`
    };
  } catch (err) {
    console.error('Failed to fetch quizzes:', err);
    overview.apps.classquizzes = { error: 'Failed to load' };
  }
  
  // Fetch from Seminars
  try {
    const fetch = (await import('node-fetch')).default;
    const seminarsStatsRes = await fetch(
      `${APPS.seminars.url}/api/external/stats?secret=${APPS.seminars.apiSecret}`
    );
    const seminarsStats = await seminarsStatsRes.json();
    
    const seminarsUpcomingRes = await fetch(
      `${APPS.seminars.url}/api/external/upcoming?secret=${APPS.seminars.apiSecret}&limit=5`
    );
    const seminarsUpcoming = await seminarsUpcomingRes.json();
    
    overview.apps.seminars = {
      name: 'Seminars',
      icon: '🎓',
      color: '#FF9500',
      upcomingCount: seminarsStats.upcoming_seminars || 0,
      totalSpeakers: seminarsStats.total_speakers || 0,
      pendingTasks: seminarsStats.pending_tasks || 0,
      items: seminarsUpcoming.seminars?.slice(0, 5) || []
    };
  } catch (err) {
    console.error('Failed to fetch seminars:', err);
    overview.apps.seminars = { error: 'Failed to load' };
  }
  
  res.json(overview);
});

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

app.post('/api/reminders/:id/complete', async (req, res) => {
  try {
    const fetch = (await import('node-fetch')).default;
    const { id } = req.params;
    
    // Get current state
    const getRes = await fetch(
      `${APPS.reminders.url}/api/external/reminders?secret=${APPS.reminders.apiSecret}`
    );
    const data = await getRes.json();
    const reminder = data.reminders?.find(r => r.id === id);
    
    if (!reminder) {
      return res.status(404).json({ error: 'Reminder not found' });
    }
    
    // Toggle via bulk API
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
// Start
// ============================================================================

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Dashboard app on port ${PORT}`);
});
