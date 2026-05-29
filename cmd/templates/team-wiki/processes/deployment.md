---
title: Deployment Process
owner: backend-team
status: draft
tags: [processes, deployment, ci-cd]
last-reviewed: 2026-01-01
---

# Deployment Process

How to ship code to production.

## When to Use

After a PR is merged to `main` and you want to deploy the change.

## Prerequisites

- [ ] Access to CI/CD dashboard
- [ ] Permission to trigger deployments
- [ ] Changes merged to `main` and CI passing

## Steps

1. Verify CI is green on the latest `main` commit
2. _Document your deployment trigger here (e.g., merge to main auto-deploys, or manual button in CI)_
3. Monitor the deployment dashboard for rollout progress
4. Check health endpoints after deployment completes
5. Verify the change works in production (smoke test)

## Verification

- Health check returns 200: `curl https://api.example.com/health`
- Key user flows work (list your smoke tests)
- No error spike in monitoring

## Rollback

If something goes wrong:

1. _Document your rollback procedure (e.g., revert commit, re-deploy previous image, feature flag)_
2. Notify the team in `#team-urgent`
3. Write a brief incident note (see [[processes/incident-response|Incident Response]])

## Related

- [[architecture]] — system overview
- [[decisions/index|Decisions]] — why we deploy this way
