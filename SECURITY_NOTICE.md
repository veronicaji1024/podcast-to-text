# SECURITY NOTICE

## CRITICAL: API Key Exposure

**Date**: 2026-03-03
**Severity**: P0 - Critical

### Issue
The `.env` file in this repository contained an exposed API key:
- Key: `sk-f0c114eb4598486d87b3e35f1242e171`
- Service: DashScope (Alibaba Cloud)

### Required Actions

1. **IMMEDIATELY REVOKE** the exposed API key from DashScope console
2. **GENERATE** a new API key
3. **NEVER** commit `.env` files to version control

### Remediation Steps

If this code was in a git repository:
```bash
# Remove .env from git history
git filter-branch --force --index-filter \
  "git rm --cached --ignore-unmatch .env" \
  --prune-empty --tag-name-filter cat -- --all

# Force push to remote (if applicable)
git push origin --force --all
```

### Best Practices Going Forward

1. Always use `.env.example` as a template (without real values)
2. Keep `.env` in `.gitignore` (already present)
3. Never commit secrets, API keys, or credentials
4. Use environment variables in production
5. Consider using secret management tools (AWS Secrets Manager, HashiCorp Vault, etc.)

### Impact Assessment
- **Exposure window**: Unknown (no git history available)
- **Risk**: Unauthorized API usage, billing fraud
- **Affected services**: DashScope ASR, OpenAI-compatible API
