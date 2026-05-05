# Monitoring Setup Notes

This backend now exposes Prometheus metrics at `/metrics` and emits domain logs:

- app + request logs (stdout)
- security audit logs (`logs/security.log`)
- business events (`logs/business.log`)
- payment events (`logs/payment.log`)

## Recommended Stack

1. Prometheus scrapes `/metrics`.
2. Grafana dashboards and alerts read from Prometheus.
3. Loki ingests stdout and `logs/*.log` streams.
4. Alertmanager routes alerts to Slack/email.

## High Priority Signals

1. payment events and failures
2. admin and security audit events
3. order lifecycle events
4. suspicious traffic and rate-limit spikes
5. backend 5xx spikes
