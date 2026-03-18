# Security Fixes Applied - 2026-03-09

This document summarizes the critical (P0) and high (P1) priority security fixes applied to the podcast-to-text application.

## Summary

- **Total Issues Fixed**: 9 (4 P0, 5 P1)
- **Files Modified**: 5
- **New Files Created**: 2 (SECURITY_NOTICE.md, this file)

---

## P0 - Critical Issues (All Fixed ✅)

### P0-1: API Key Exposure ✅
**File**: `.env`, `SECURITY_NOTICE.md`
**Impact**: Credential exposure, billing fraud

**Fix Applied**:
- Replaced exposed API key in `.env` with placeholder
- Created `SECURITY_NOTICE.md` with remediation steps
- Added warning comment in `.env` file

**Action Required**:
1. ⚠️ **IMMEDIATELY** revoke the exposed key: `sk-f0c114eb4598486d87b3e35f1242e171`
2. Generate new API key from DashScope console
3. Update `.env` file with new key (never commit it!)

---

### P0-2: Command Injection Vulnerability ✅
**File**: `server/index.js:665-708`
**Impact**: Remote code execution

**Fix Applied**:
- Replaced `execPromise()` with shell string with `spawn()` using array arguments
- Prevents injection through `audioPath` or `outputPath` parameters

**Before**:
```javascript
const command = `python3 "${whisperScript}" "${audioPath}" "${outputPath}" --model ${model}`;
await execPromise(command);
```

**After**:
```javascript
const args = [whisperScript, audioPath, outputPath, '--model', model, ...];
const proc = spawn('python3', args);
```

---

### P0-3: SSRF Validation Bypass ✅
**File**: `server/services/podcastService.js:18-90`
**Impact**: Access to internal services, cloud metadata endpoints

**Fix Applied**:
- Added IPv6 loopback blocking (`::1`, `::ffff:127.x.x.x`)
- Extended IPv4 private range coverage (CGNAT, multicast, reserved)
- Added `.local` and `.internal` domain blocking
- Added port restriction warnings for common internal services

**New protections**:
- All 127.x.x.x addresses (not just 127.0.0.1)
- IPv6 link-local (fe80:) and unique local (fc00:, fd00:)
- CGNAT range (100.64.0.0/10)
- TEST-NET ranges
- Multicast and broadcast addresses

---

### P0-4: Unauthenticated File Access ✅
**File**: `server/services/fileUrlService.js`
**Impact**: Privacy breach, unauthorized access to uploaded audio files

**Fix Applied**:
- Implemented HMAC-SHA256 signed URLs with expiration
- Added `FILE_URL_SECRET` environment variable
- Modified file server to verify token before serving files
- URLs now expire after 1 hour

**New URL format**:
```
https://tunnel.url/file/{fileId}?token={hmac}&expires={timestamp}
```

**Configuration Required**:
Add to `.env`:
```bash
FILE_URL_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
```

---

## P1 - High Priority Issues (All Fixed ✅)

### P1-5: Missing Chat Rate Limiting ✅
**File**: `server/index.js:60-73, 274`
**Impact**: API cost abuse, DoS

**Fix Applied**:
- Added `chatLimiter` middleware: 30 requests per 15 minutes per job
- Rate limiting keys by IP + jobId combination
- Applied to `/api/chat/:jobId` endpoint

**Configuration**:
```javascript
max: 30,              // 30 requests per window
windowMs: 15 * 60 * 1000,  // 15 minutes
keyGenerator: (req) => `${req.ip}-${req.params.jobId}`
```

---

### P1-6: ReDoS Vulnerability ✅
**File**: `server/services/chatService.js:285-317`
**Impact**: Denial of service through regex exploitation

**Fix Applied**:
- Added input length validation (max 1000 chars)
- Limited keyword length (max 50 chars per keyword)
- Limited total keywords (max 20)
- Added try-catch for regex operations
- Sanitized query before processing

**Protections**:
- Input sanitization before regex
- Maximum query length: 1000 chars
- Maximum keyword length: 50 chars
- Maximum keywords extracted: 20

---

### P1-7: Unhandled Promise Rejection Cleanup ✅
**File**: `server/index.js:140-168, 178-206`
**Impact**: Resource leaks on error

**Fix Applied**:
- Added cleanup handlers in `.catch()` blocks for both `processPodcast` and `processAudioFile`
- Cleanup now handles:
  - Audio file deletion
  - Transcript file deletion
  - Removal from fileUrlService served files map

**Resources cleaned on error**:
```javascript
- job.audioPath (downloaded audio)
- transcript.txt (partial transcription)
- Served file registrations (tunnel/OSS)
```

---

### P1-8: Infinite Loop Risk in ASR Polling ✅
**File**: `server/services/asrService.js:78-138`
**Impact**: Resource exhaustion, hung requests

**Fix Applied**:
- Added `maxPollAttempts` counter independent of time
- Loop now exits if either time limit OR poll count exceeded
- Better error messages showing poll count

**Protections**:
```javascript
const maxPollAttempts = Math.ceil(maxWaitTime / pollInterval);
while (Date.now() - startTime < maxWaitTime && pollCount < maxPollAttempts) {
  pollCount++;
  // ... polling logic
}
```

---

### P1-9: Path Traversal in TEMP_DIR ✅
**File**: `server/index.js:29-48`
**Impact**: Arbitrary file write outside intended directory

**Fix Applied**:
- Validate resolved `TEMP_DIR` path is within allowed base directory
- Throws error on startup if path traversal detected
- Logs the validated path being used

**Validation**:
```javascript
const allowedBasePath = path.resolve(__dirname, '..');
const resolvedTempDir = path.resolve(TEMP_DIR);

if (!resolvedTempDir.startsWith(allowedBasePath)) {
  throw new Error('Invalid TEMP_DIR configuration: path traversal detected');
}
```

---

## Configuration Changes Required

### 1. Environment Variables

Add to your `.env` file:

```bash
# Generate a secure secret for file URL signing
FILE_URL_SECRET=<run: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
```

### 2. API Key Rotation

⚠️ **CRITICAL - Do this immediately**:

1. Log in to DashScope console
2. Revoke the key: `sk-f0c114eb4598486d87b3e35f1242e171`
3. Generate a new API key
4. Update `.env` with the new key

### 3. Dependencies

No new dependencies added. All fixes use built-in Node.js modules.

---

## Testing Recommendations

### Security Tests to Run

1. **Command Injection Test**:
   ```bash
   # Try uploading file with name: test"; rm -rf /tmp; echo ".mp3
   # Should be safely handled
   ```

2. **SSRF Test**:
   ```bash
   curl -X POST http://localhost:3000/api/process \
     -H "Content-Type: application/json" \
     -d '{"url": "http://127.0.0.1:22"}'
   # Should return: "不允许访问本地地址"
   ```

3. **File Access Test**:
   ```bash
   # Try accessing file without token
   curl http://localhost:3001/file/test-file-id
   # Should return: 403 "Authentication required"
   ```

4. **Rate Limit Test**:
   ```bash
   # Send 31 chat requests rapidly
   for i in {1..31}; do
     curl -X POST "http://localhost:3000/api/chat/test-job?token=test" \
       -H "Content-Type: application/json" \
       -d '{"message":"test","history":[]}' &
   done
   # 31st request should fail with rate limit error
   ```

5. **Path Traversal Test**:
   ```bash
   # Set TEMP_DIR=../../../etc/passwd in .env
   # Server should fail to start with error
   ```

---

## Deployment Checklist

Before deploying to production:

- [ ] Revoke exposed API key and generate new one
- [ ] Set `FILE_URL_SECRET` in production environment
- [ ] Set `NODE_ENV=production`
- [ ] Verify `TEMP_DIR` is properly configured
- [ ] Test all rate limiters are working
- [ ] Review logs for any security warnings
- [ ] Run security tests (see above)
- [ ] Consider adding a WAF (Web Application Firewall)
- [ ] Enable HTTPS (if not already)
- [ ] Set up monitoring for rate limit violations

---

## Additional Security Recommendations

While not implemented in this fix round, consider these for future improvements:

1. **Input Validation**: Add schema validation with `joi` or `zod`
2. **CORS**: Review CORS configuration (currently allows all origins)
3. **Helmet.js**: Add security headers
4. **HTTPS**: Enforce HTTPS in production
5. **API Authentication**: Consider adding API keys for endpoint access
6. **Audit Logging**: Log all security-relevant events
7. **Dependency Scanning**: Use `npm audit` regularly
8. **Secrets Management**: Use AWS Secrets Manager or similar in production

---

## Files Modified

1. `.env` - Removed exposed API key
2. `server/index.js` - P0-2, P1-5, P1-7, P1-9
3. `server/services/podcastService.js` - P0-3
4. `server/services/fileUrlService.js` - P0-4
5. `server/services/asrService.js` - P1-8
6. `server/services/chatService.js` - P1-6
7. `.env.example` - Added FILE_URL_SECRET

## Files Created

1. `SECURITY_NOTICE.md` - API key exposure incident report
2. `SECURITY_FIXES_2026-03-09.md` - This file

---

## Questions or Issues?

If you encounter any issues with these security fixes:

1. Check the logs for detailed error messages
2. Verify environment variables are set correctly
3. Ensure all dependencies are installed (`npm install`)
4. Review the code changes in this document

For production deployments, consider a security audit by a professional security team.

---

**Document Version**: 1.0
**Last Updated**: 2026-03-09
**Reviewed By**: Claude Code Review Expert
