---
title: "Integrating Security Scanning (KICS, tfsec, Checkov) into Atlantis CI/CD"
pubDatetime: 2026-05-07T21:00:00+07:00
tags: ["tutorial", "devsecops", "terraform", "atlantis", "security"]
description: "A hands-on PoC of integrating KICS, tfsec, and Checkov into Atlantis to automatically scan Terraform code and render security findings as a Markdown table directly on GitHub PRs."
lang: "en"
---

> **Disclaimer:** This is a personal Proof of Concept writeup, not an official guide.

The goal: upgrade Atlantis from just running `terraform plan & apply` into a CI/CD pipeline that automatically scans for security issues using **KICS, tfsec, and Checkov**, then renders the results as a Markdown table directly in the GitHub PR comment.

🇻🇳 [Đọc bản tiếng Việt](/posts/atlantis-security-scanning-vi)

---

## 1. Local Setup with Docker Compose + Ngrok

I used Docker and ngrok to simulate a local environment that receives webhooks from GitHub.

### 1.1 Dockerfile

The default Atlantis image doesn't include security tools, so I wrote a custom Dockerfile to add KICS, tfsec, and Checkov:

```dockerfile
# Stage 1: Get KICS binary from official image
FROM checkmarx/kics:latest AS kics-source

# Stage 2: Atlantis + security tools
FROM ghcr.io/runatlantis/atlantis:latest

USER root

# 1. Install Checkov via pip
RUN apk add --no-cache python3 py3-pip wget \
    && pip3 install --break-system-packages checkov \
    && checkov --version

# 2. Download tfsec binary from GitHub Releases
RUN wget -q -O /usr/local/bin/tfsec \
      https://github.com/aquasecurity/tfsec/releases/latest/download/tfsec-linux-amd64 \
    && chmod +x /usr/local/bin/tfsec \
    && tfsec --version

# 3. KICS (copied from Stage 1)
COPY --from=kics-source /app/bin/kics   /usr/local/bin/kics
COPY --from=kics-source /app/bin/assets /app/assets
RUN kics version

USER atlantis
```

### 1.2 Docker Compose

```yaml
version: '3.8'

services:
  atlantis:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: atlantis
    ports:
      - "4141:4141"
    volumes:
      - ./atlantis-data:/atlantis-data
      - ./repos.yaml:/etc/atlantis/repos.yaml:ro
    environment:
      - ATLANTIS_GH_USER=<YOUR_GITHUB_USERNAME>
      - ATLANTIS_GH_TOKEN=<YOUR_GITHUB_TOKEN>
      - ATLANTIS_GH_WEBHOOK_SECRET=<YOUR_WEBHOOK_SECRET>
      - ATLANTIS_REPO_ALLOWLIST=github.com/<YOUR_GITHUB_USERNAME>/<YOUR_REPO>
      - ATLANTIS_REPO_CONFIG=/etc/atlantis/repos.yaml
      - ATLANTIS_URL=https://<your-ngrok-domain>.ngrok-app.com/
      - ATLANTIS_DATA_DIR=/atlantis-data
      # AWS Credentials (optional)
      - AWS_ACCESS_KEY_ID=<YOUR_AWS_ACCESS_KEY_ID>
      - AWS_SECRET_ACCESS_KEY=<YOUR_AWS_SECRET_ACCESS_KEY>
      - AWS_DEFAULT_REGION=ap-southeast-1
    restart: unless-stopped
```

Run `ngrok http 4141` in a separate terminal to get a public URL, then set it as `ATLANTIS_URL`.

---

## 2. Server-side Policy Config (`repos.yaml`)

To allow Atlantis to run custom workflows, configure `repos.yaml` on the server side:

```yaml
repos:
  - id: /.*/
    allowed_overrides:
      - workflow
      - apply_requirements
    # Required to run custom shell commands inside YAML
    allow_custom_workflows: true
```

---

## 3. Parsing CSV → Markdown Table with Inline Python

**The problem:** KICS logs are raw and hard to read. CSV/JSON reports require downloading to view — not great for PR reviews.

**The solution:** Have Atlantis output a CSV report, then embed a small Python script to parse it and print a Markdown table directly into the PR comment.

Full `atlantis.yaml` config is available at: [github.com/NguyenVanHung24/script](https://github.com/NguyenVanHung24/script)

### Hard-learned lesson: YAML + inline Python

Using a bash *heredoc* (`<< EOF`) inside an Atlantis YAML `run` block causes the YAML parser to throw `could not find expected ':'` due to indentation conflicts.

**Workaround:** use `printf` to write each Python line to a temp file, then execute it — completely bypasses the YAML block syntax issue.

```bash
# ❌ heredoc breaks YAML parsing:
# run: |
#   python3 << EOF
#   import csv
#   ...
#   EOF

# ✅ printf to temp file works:
run: |
  printf '%s\n' \
    'import csv' \
    'with open("report.csv") as f:' \
    '    pass  # ... print markdown table' \
  > /tmp/parse.py
  python3 /tmp/parse.py
```

---

## 4. Result

After pushing code to GitHub, the CI/CD flow automatically runs the KICS scan. The Python script successfully renders a Markdown table in the PR's Conversation tab — including a Summary and Detail view of security findings — giving developers visibility into vulnerabilities before anything is applied to cloud.

---

## Closing Thoughts

This PoC proves that hooking security tools into Atlantis is straightforward, and more importantly, that you can shape the report format with Python to make it actually readable. Take this as a starting point and adapt it to your team's real-world pipeline needs.
