---
description: Steps to deploy the Antigravity Agent to Railway and connect to the dashboard.
---

1. **Commit and Push**: Ensure all local changes are pushed to GitHub.
   ```bash
   git add .
   git commit -m "Finalizing dashboard integration and brand inventory"
   git push origin main
   ```

2. **Railway Configuration**:
   - Access your [Railway Dashboard](https://railway.app/).
   - Go to your Bot project settings.
   - Set the following Environment Variables:
     - `API_BASE`: `https://cuhz-bot-dashboard-846.created.app`
     - `BOT_API_SECRET`: (Contact admin for the production secret)
     - `USE_MOCK_API`: `false`
     - `BOT_OAUTH_TOKEN`: `oauth:your_real_token`
     - `BOT_USERNAME`: `your_bot_username`

3. **Persistent Volume**:
   - In Railway, add a **Volume** and mount it to `/data`.
   - This ensures your SQLite database (`bot.db`) persists across deployments.

4. **Verify Health**:
   - Once deployed, visit `https://your-railway-url/health` to confirm the bot is connected and joining channels.

5. **Dashboard Sync**:
   - Log in to `https://cuhz-bot-dashboard-846.created.app/admin` and verify that the marketing intervals (45m/1h) are reflected in the global settings.
