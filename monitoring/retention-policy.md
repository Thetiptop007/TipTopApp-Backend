# Log Retention Policy

- debug logs: 7 days
- app/request info logs: 14 to 30 days
- error logs: 90 days
- payment and security audit logs: 180 to 365 days

## Suggested Loki Labels

- service=tiptop-backend
- env=production|staging|development
- logType=app|request|security|business|payment
- event=<domain event name>

## Sampling Rules

- sample normal 2xx request logs with REQUEST_LOG_SAMPLE_RATE (default: 0.2)
- never sample payment events
- never sample error logs
- never sample auth logs
- never sample security events

## Notes

- Keep Render console as fallback only.
- Use centralized storage (Grafana Loki recommended) for search and correlation.
