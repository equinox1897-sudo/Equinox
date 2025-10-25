@echo off
echo Starting Equinox Server...
echo Setting up environment variables...

set DATABASE_URL=postgresql://watchers_eye_db_user:KTgflWxaluWsHcvcRBacpLuzoPGKCK62@dpg-d3pkt7ili9vc73blnkn0-a.oregon-postgres.render.com/watchers_eye_db
set ADMIN_KEY=test-admin-key-12345
set NODE_ENV=development

echo Environment variables set.
echo Starting server on http://localhost:3000
echo.
echo Press Ctrl+C to stop the server
echo.

node server.js
