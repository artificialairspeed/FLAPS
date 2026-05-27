# FLAPS Quick Start Guide

## Installation

```bash
npm install
npm start
```

The server will start on port 3000 (or `PORT` environment variable).

## New Features

### 🎯 Toast Notifications
- **No more alert() popups!**
- Smooth, non-blocking notifications
- Auto-dismiss after 4 seconds
- Types: Error (red), Warning (yellow), Success (green)

### ⌨️ Keyboard Navigation
- **Tab** through voting cards
- **Enter** or **Space** to vote
- Full keyboard accessibility

### 🔄 Connection Status
- Real-time connection indicator in header
- Toast notifications on disconnect/reconnect
- Automatic reconnection handling

### ⏳ Loading States
- Visual feedback when creating/joining rooms
- Buttons show "Loading..." during operations
- Prevents double-clicks

### 🛡️ Security Improvements
- Rate limiting (50 events per 10 seconds)
- Input sanitization (max lengths enforced)
- URL validation (blocks javascript: and data: URLs)
- Graceful error handling

### ⚡ Performance Improvements
- Gzip/Brotli compression (70% size reduction)
- 1-year cache for static assets in production
- Optimized Socket.IO broadcasting
- Memory leak fixes

## Environment Variables

```bash
# Required for production
NODE_ENV=production

# Optional
PORT=3000
CORS_ORIGIN=false  # Or set to specific origin
```

## Testing the New Features

### Test Toast Notifications
1. Try to join without entering a name → See error toast
2. Try to add story without title → See error toast
3. Disconnect network → See warning toast

### Test Keyboard Navigation
1. Click in voting deck area
2. Press Tab to navigate between cards
3. Press Enter or Space to vote

### Test Rate Limiting
1. Open browser console
2. Rapidly click vote buttons
3. After ~50 clicks in 10 seconds, you'll see rate limit toast

### Test Loading States
1. Click "Create Room" → Button shows "Loading..."
2. Click "Join" → Button shows "Loading..."
3. Both reset after successful operation

### Test Connection Handling
1. Start the app and join a room
2. Stop the server
3. See "Disconnected" status and toast
4. Restart server
5. See "Reconnected" status

## Troubleshooting

### "Rate limit exceeded" message
- **Cause**: Too many socket events in short time
- **Solution**: Wait 10 seconds and try again
- **Prevention**: Normal usage won't trigger this

### "Invalid URL format" message
- **Cause**: Story link contains invalid protocol
- **Solution**: Use http:// or https:// URLs only

### Loading state stuck
- **Cause**: Network issue or server not responding
- **Solution**: Refresh page (auto-resets after 5 seconds)

### Compression not working
- **Cause**: `compression` package not installed
- **Solution**: Run `npm install`

## Browser Support

- ✅ Chrome/Edge (latest)
- ✅ Firefox (latest)
- ✅ Safari (latest)
- ✅ Mobile browsers (iOS Safari, Chrome Mobile)

## Accessibility

- ✅ Keyboard navigation
- ✅ Screen reader support (ARIA labels)
- ✅ Focus indicators
- ✅ Motion reduction support
- ✅ High contrast compatible

## Performance Tips

### Production Deployment
1. Set `NODE_ENV=production`
2. Enable HTTPS (handled by Railway)
3. Monitor server logs for rate limit events
4. Use CDN for static assets (optional)

### Development
- Compression disabled in dev mode
- No caching for easier debugging
- Full error logging

## What's Next?

See `OPTIMIZATIONS.md` for:
- Complete list of all improvements
- Technical details
- Future enhancement ideas
- Rollback instructions

---

**Questions?** Check the code comments or `OPTIMIZATIONS.md` for details.
