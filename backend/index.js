const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { admin, db } = require('./firebaseAdmin');

const JWT_SECRET = process.env.JWT_SECRET || 'codeorbit-secret-key-123456';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'codeorbit-refresh-key-123456';

const app = express();
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

// Password hashing helpers
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  const checkHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return hash === checkHash;
}

// Authentication Middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired access token' });
    }
    req.user = user;
    next();
  });
};

// Health Check Route
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'AI PR Reviewer Backend is running!' });
});

// Direct root /health for uptime monitors (like Render / UptimeRobot)
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Authentication Routes
app.post('/api/auth/signup', async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'Missing email, password, or name' });
  }

  try {
    const usersRef = db.collection('users');
    const snapshot = await usersRef.where('email', '==', email.toLowerCase()).limit(1).get();
    if (!snapshot.empty) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const { salt, hash } = hashPassword(password);
    const newUserRef = usersRef.doc();
    const userId = newUserRef.id;

    const userDoc = {
      userId,
      email: email.toLowerCase(),
      name,
      passwordHash: hash,
      salt,
      createdAt: new Date().toISOString()
    };

    await newUserRef.set(userDoc);

    let firebaseUser = null;
    try {
      firebaseUser = await admin.auth().createUser({
        uid: userId,
        email: email.toLowerCase(),
        displayName: name,
        photoURL: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random`
      });
    } catch (fbErr) {
      console.warn("Could not create Firebase Auth user:", fbErr.message);
    }

    const accessToken = jwt.sign({ userId, email: email.toLowerCase(), name }, JWT_SECRET, { expiresIn: '1h' });
    const refreshToken = jwt.sign({ userId, email: email.toLowerCase() }, JWT_REFRESH_SECRET, { expiresIn: '7d' });

    await db.collection('refresh_tokens').doc(userId).set({
      token: refreshToken,
      createdAt: new Date().toISOString()
    });

    let firebaseCustomToken = null;
    try {
      firebaseCustomToken = await admin.auth().createCustomToken(userId);
    } catch (fbTokErr) {
      console.error("Failed to generate custom token:", fbTokErr);
    }

    res.status(201).json({
      accessToken,
      refreshToken,
      firebaseCustomToken,
      user: {
        uid: userId,
        email: email.toLowerCase(),
        displayName: name,
        photoURL: firebaseUser ? firebaseUser.photoURL : `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random`
      }
    });

  } catch (error) {
    console.error("Signup error:", error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Missing email or password' });
  }

  try {
    const usersRef = db.collection('users');
    const snapshot = await usersRef.where('email', '==', email.toLowerCase()).limit(1).get();
    if (snapshot.empty) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    const userDoc = snapshot.docs[0].data();
    const isPasswordValid = verifyPassword(password, userDoc.salt, userDoc.passwordHash);
    if (!isPasswordValid) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    const userId = userDoc.userId;
    const name = userDoc.name;

    let firebaseUser = null;
    try {
      firebaseUser = await admin.auth().getUser(userId);
    } catch (fbErr) {
      if (fbErr.code === 'auth/user-not-found') {
        try {
          firebaseUser = await admin.auth().createUser({
            uid: userId,
            email: email.toLowerCase(),
            displayName: name,
            photoURL: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random`
          });
        } catch (createErr) {
          console.warn("Could not sync user in Firebase Auth:", createErr.message);
        }
      }
    }

    const accessToken = jwt.sign({ userId, email: email.toLowerCase(), name }, JWT_SECRET, { expiresIn: '1h' });
    const refreshToken = jwt.sign({ userId, email: email.toLowerCase() }, JWT_REFRESH_SECRET, { expiresIn: '7d' });

    await db.collection('refresh_tokens').doc(userId).set({
      token: refreshToken,
      createdAt: new Date().toISOString()
    });

    let firebaseCustomToken = null;
    try {
      firebaseCustomToken = await admin.auth().createCustomToken(userId);
    } catch (fbTokErr) {
      console.error("Failed to generate custom token:", fbTokErr);
    }

    res.json({
      accessToken,
      refreshToken,
      firebaseCustomToken,
      user: {
        uid: userId,
        email: email.toLowerCase(),
        displayName: name,
        photoURL: firebaseUser ? firebaseUser.photoURL : `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random`
      }
    });

  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/api/auth/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(400).json({ error: 'Missing refresh token' });
  }

  try {
    const decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
    const userId = decoded.userId;

    const tokenDoc = await db.collection('refresh_tokens').doc(userId).get();
    if (!tokenDoc.exists || tokenDoc.data().token !== refreshToken) {
      return res.status(403).json({ error: 'Invalid or expired refresh token' });
    }

    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userData = userDoc.data();
    const accessToken = jwt.sign(
      { userId, email: userData.email, name: userData.name },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    let firebaseCustomToken = null;
    try {
      firebaseCustomToken = await admin.auth().createCustomToken(userId);
    } catch (fbTokErr) {
      console.error("Failed to generate custom token during refresh:", fbTokErr);
    }

    res.json({
      accessToken,
      firebaseCustomToken
    });

  } catch (error) {
    console.error("Refresh token error:", error);
    res.status(403).json({ error: 'Invalid or expired refresh token' });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(400).json({ error: 'Missing refresh token' });
  }

  try {
    const decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
    const userId = decoded.userId;

    await db.collection('refresh_tokens').doc(userId).delete();
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error("Logout error:", error);
    res.status(200).json({ message: 'Logged out (token already invalid)' });
  }
});

const { getPRDiffs, postPRComment } = require('./githubService');
const { generateReview } = require('./aiService');

// GitHub Webhook Endpoint
app.post('/api/webhooks/github', async (req, res) => {
  try {
    const event = req.headers['x-github-event'];
    
    // We only care about pull requests
    if (event !== 'pull_request') {
      return res.status(200).send('Ignored: Not a PR event');
    }

    const { action, pull_request, repository } = req.body;
    
    // We only want to review when PR is opened, reopened, or new commits are pushed (synchronize)
    if (!['opened', 'synchronize', 'reopened'].includes(action)) {
      return res.status(200).send(`Ignored: Action is ${action}`);
    }

    const repoFullName = repository.full_name;
    const prNumber = pull_request.number;

    console.log(`Received PR event for ${repoFullName} #${prNumber}`);

    // 1. Check if this repository is actively tracked in Firestore
    const sessionsRef = db.collection('tracking_sessions');
    const snapshot = await sessionsRef
      .where('repoFullName', '==', repoFullName)
      .where('isActive', '==', true)
      .get();

    if (snapshot.empty) {
      console.log('No active tracking session found for this repo.');
      return res.status(200).send('Ignored: Repo not tracked');
    }

    // Since multiple users could track the same repo, we'll just grab the first valid one
    // In a production app, you might want more sophisticated logic.
    let validSession = null;
    snapshot.forEach(doc => {
      const data = doc.data();
      if (new Date(data.endDate) > new Date()) {
        validSession = data;
      }
    });

    if (!validSession) {
      console.log('Tracking session expired.');
      return res.status(200).send('Ignored: Tracking expired');
    }

    const githubToken = validSession.githubToken;
    if (!githubToken) {
      console.error('Session found but missing githubToken!');
      return res.status(500).send('Missing GitHub Token in DB');
    }

    // Send a response back to GitHub immediately so we don't timeout
    // the webhook while the AI processes it.
    res.status(202).send('Accepted for processing');

    // --- Start Background Processing ---
    try {
      console.log('Fetching diffs...');
      const diffs = await getPRDiffs(repoFullName, prNumber, githubToken);
      
      if (diffs.includes('Pas de patch disponible') && diffs.split('---').length <= 2) {
        console.log('No actual code changes found.');
        await db.collection('webhook_logs').add({ repoFullName, prNumber, status: 'ignored_no_patch', timestamp: new Date() });
        return;
      }

      console.log('Generating AI Review with Gemini...');
      const aiReviewText = await generateReview(diffs);

      console.log('Posting review to GitHub...');
      await postPRComment(repoFullName, prNumber, aiReviewText, githubToken);

      console.log('AI Review posted successfully!');
      await db.collection('webhook_logs').add({ repoFullName, prNumber, status: 'success', timestamp: new Date() });

    } catch (bgError) {
      console.error("Background Processing Error:", bgError);
      await db.collection('webhook_logs').add({ 
        repoFullName, 
        prNumber, 
        status: 'error', 
        errorMessage: bgError.message || bgError.toString(),
        stack: bgError.stack || '',
        timestamp: new Date() 
      });
    }

  } catch (error) {
    console.error("Webhook Error:", error);
    if (!res.headersSent) {
      res.status(500).send('Internal Server Error');
    }
  }
});

// Setup Webhook Programmatically on GitHub
app.post('/api/webhooks/setup', authenticateToken, async (req, res) => {
  const { repoFullName, token } = req.body;

  if (!repoFullName || !token) {
    return res.status(400).json({ error: 'Missing repository name or token' });
  }

  try {
    const url = `https://api.github.com/repos/${repoFullName}/hooks`;
    const webhookBase = process.env.WEBHOOK_BASE_URL || `${req.protocol}://${req.get('host')}`;
    const backendWebhookUrl = `${webhookBase}/api/webhooks/github`;

    console.log(`Setting up webhook for ${repoFullName} pointing to ${backendWebhookUrl}`);

    // Create the webhook on GitHub
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'web',
        active: true,
        events: ['pull_request'],
        config: {
          url: backendWebhookUrl,
          content_type: 'json',
          insecure_ssl: '0'
        }
      })
    });

    const data = await response.json();

    if (!response.ok) {
      // If the webhook already exists, GitHub returns a 422. We can treat this as a success.
      if (response.status === 422 && data.errors && data.errors[0].message.includes('already exists')) {
        console.log('Webhook already exists for this repository.');
        return res.status(200).json({ message: 'Webhook already active' });
      }
      console.error('GitHub API Validation Errors:', JSON.stringify(data.errors));
      throw new Error(data.message || 'GitHub API error');
    }

    console.log('Webhook created successfully on GitHub!');
    res.status(200).json({ message: 'Webhook registered successfully' });

  } catch (error) {
    console.error('Error setting up webhook:', error);
    res.status(500).json({ error: error.message || 'Failed to setup webhook' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
