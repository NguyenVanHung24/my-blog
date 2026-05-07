---
title: "Tích hợp Security Scanning (KICS, tfsec, Checkov) vào Atlantis CI/CD"
pubDatetime: 2026-05-07T21:00:00+07:00
tags: ["tutorial", "devsecops", "terraform", "atlantis", "security"]
description: "Ghi chép quá trình thử nghiệm tích hợp KICS, tfsec và Checkov vào Atlantis, tự động scan bảo mật và render kết quả Markdown trực tiếp lên GitHub PR."
lang: "vi"
---

> **Disclaimer:** Bài viết này là ghi chép quá trình thử nghiệm (Proof of Concept) cá nhân, không phải hướng dẫn chính thức.

Mục tiêu: nâng cấp Atlantis từ việc chỉ chạy `terraform plan & apply` thành một luồng CI/CD có khả năng tự động scan bảo mật với **KICS, tfsec và Checkov**, đồng thời hiển thị kết quả dưới dạng Markdown table trực tiếp lên comment của GitHub PR.

🇬🇧 [Read in English](/posts/atlantis-security-scanning)

---

## 1. Setup môi trường với Docker Compose + Ngrok

Mình dùng Docker và ngrok để giả lập môi trường nhận webhook từ GitHub tại local.

### 1.1 Dockerfile

Image mặc định của Atlantis không có sẵn các tool security, nên cần viết lại Dockerfile để cài thêm KICS, tfsec, Checkov:

```dockerfile
# Stage 1: Lấy KICS binary từ image official
FROM checkmarx/kics:latest AS kics-source

# Stage 2: Atlantis + các công cụ scan
FROM ghcr.io/runatlantis/atlantis:latest

USER root

# 1. Cài Checkov qua pip
RUN apk add --no-cache python3 py3-pip wget \
    && pip3 install --break-system-packages checkov \
    && checkov --version

# 2. Tải tfsec binary từ GitHub Release
RUN wget -q -O /usr/local/bin/tfsec \
      https://github.com/aquasecurity/tfsec/releases/latest/download/tfsec-linux-amd64 \
    && chmod +x /usr/local/bin/tfsec \
    && tfsec --version

# 3. KICS (copy từ Stage 1)
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

Chạy `ngrok http 4141` ở terminal khác để lấy URL expose ra Internet, sau đó điền vào `ATLANTIS_URL`.

---

## 2. Cấu hình Server-side Policies (`repos.yaml`)

Để Atlantis cho phép thực thi custom workflow, cần cấu hình `repos.yaml` phía server:

```yaml
repos:
  - id: /.*/
    allowed_overrides:
      - workflow
      - apply_requirements
    # Bắt buộc để chạy lệnh shell custom bên trong YAML
    allow_custom_workflows: true
```

---

## 3. Parse CSV → Markdown Table bằng Python inline

**Vấn đề:** Log của KICS rất thô, file CSV/JSON report khó đọc trực tiếp trên GitHub PR.

**Giải pháp:** Bắt Atlantis xuất CSV, sau đó nhúng script Python nhỏ để parse và in ra Markdown table ngay trên comment PR.

Cấu hình đầy đủ trong file `atlantis.yaml` có thể xem tại: [github.com/NguyenVanHung24/script](https://github.com/NguyenVanHung24/script)

### Kinh nghiệm xương máu: YAML + Python inline

Khi dùng *heredoc* (`<< EOF`) lồng trong khối `run` của Atlantis YAML, parser liên tục báo lỗi `could not find expected ':'` do indentation. Workaround: dùng `printf` ghi từng dòng Python ra file tạm rồi thực thi — hoàn toàn bypass lỗi cú pháp YAML block.

```bash
# ❌ heredoc gây lỗi YAML:
# run: |
#   python3 << EOF
#   import csv
#   ...
#   EOF

# ✅ printf ra file tạm hoạt động tốt:
run: |
  printf '%s\n' \
    'import csv' \
    'with open("report.csv") as f:' \
    '    pass  # ... in markdown table' \
  > /tmp/parse.py
  python3 /tmp/parse.py
```

---

## 4. Kết quả

Sau khi push code lên GitHub, flow CI/CD tự động chạy KICS scan. Python script render thành công Markdown table lên tab Conversation của Pull Request — bao gồm Summary và Detail về các lỗ hổng bảo mật, giúp dev review trước khi apply lên cloud.

---

## Lời kết

Bài lab này chứng minh việc hook Security Tools vào Atlantis là khả thi, và quan trọng hơn là có thể can thiệp định dạng report bằng Python để UX tốt hơn hẳn so với raw log. Bạn có thể lấy ý tưởng này để xây dựng pipeline nội bộ theo nhu cầu thực tế.
