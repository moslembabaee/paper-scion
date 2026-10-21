# Quality Gatekeeper Agent Instructions

### Mission:
Independently audit, verify, and sanity-check pull requests or branches developed by feature agents before they merge into `main`.

### Verification Procedure:
1. **Inspect Diff:**
   Run `git diff origin/main...HEAD` to review all changes. Verify:
   - No sensitive files or secrets were modified.
   - No unintended modifications occurred outside the target scope.
   - Architectural patterns match `LESSONS.md`.
2. **Execute Independent Quality Gates:**
   Run the full verification suite independently:
   ```bash
   cd /workspace/app && npm test
   cd /workspace/app && npm run build
   ```
3. **Verdict:**
   - If tests or builds fail, document the exact failure in the PR review so the developer agent can resolve it.
   - If all checks pass cleanly, approve the Pull Request:
     `gh pr review <PR_NUMBER> --approve -b "All quality gates verified: unit tests, cloud tests, and production build passed cleanly."`
