---
title: "Connect to a Private EC2 Instance via SSM and VSCode"
pubDatetime: 2026-05-07T22:00:00+07:00
tags: ["tutorial", "aws", "ssm", "vscode", "security"]
description: "How to securely access a private EC2 instance through AWS SSM and VSCode Remote SSH — no open ports, no exposed access keys."
lang: "en"
---

🇻🇳 [Đọc bản tiếng Việt](/posts/connect-ec2-ssm-vscode-vi)

## The Problem

Anyone with access to an EC2 instance can potentially read the Access Key stored on it and query all resources in your cloud account. We need a safer way to access EC2 — one that doesn't expose credentials or require open inbound ports.

The solution: **AWS Systems Manager (SSM)**. Combined with AWS SSO and VSCode Remote SSH, you get a fully private, auditable connection to your EC2 instance without a bastion host or open port 22.

---

## Prerequisites

- AWS CLI installed and configured
- [Session Manager plugin for AWS CLI](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html)
- VSCode with the **Remote - SSH** extension installed
- Node.js (required by some VSCode remote features)
- An IAM user/role with SSM permissions to the target EC2
- The EC2 instance must have the SSM Agent running and an IAM role with `AmazonSSMManagedInstanceCore`

---

## Step 1: Generate an SSH Key Pair

On your local machine:

```bash
ssh-keygen -t rsa -b 4096
```

This creates `~/.ssh/id_rsa` (private) and `~/.ssh/id_rsa.pub` (public).

---

## Step 2: Log in via AWS SSO

```bash
aws sso login --profile <your-sso-profile>
```

---

## Step 3: Push Your Public Key to the Private EC2 via SSM

Use `ssm send-command` to write your public key into the instance's `authorized_keys` — no inbound SSH port needed:

```powershell
$pubkey = $(cat ~/.ssh/id_rsa.pub)
$instance_id = "i-xxxxxxxxxxxxxxxxx"
$region = "ap-southeast-1"
$cmd = "echo `"$pubkey`" > /home/ubuntu/.ssh/authorized_keys"

aws ssm send-command `
  --instance-ids $instance_id `
  --document-name "AWS-RunShellScript" `
  --parameters commands="$cmd" `
  --region $region
```

---

## Step 4: Configure VSCode SSH

Open VSCode, press `Ctrl + Shift + P` → **Remote-SSH: Add New SSH Host**, then edit your `~/.ssh/config`:

```
Host i-xxxxxxxxxxxxxxxxx
  User ubuntu
  IdentityFile C:/Users/<you>/.ssh/id_rsa
  ProxyCommand C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe "aws ssm start-session --target %h --document-name AWS-StartSSHSession --parameters 'portNumber=%p' --profile <your-sso-profile>"
```

> Replace `ubuntu` with `ec2-user` if your AMI is Amazon Linux.

---

## Step 5: Connect

In VSCode, press `Ctrl + Shift + P` → **Remote-SSH: Connect to Host** → select your instance ID.

VSCode will tunnel through SSM and open a full remote workspace on your private EC2 — no open ports, no bastion, no exposed keys.

---

## Why This Is Better

| | Traditional SSH | SSM + VSCode |
|---|---|---|
| Requires open port 22 | ✅ | ❌ |
| Requires bastion host | ✅ | ❌ |
| Auditable in CloudTrail | ❌ | ✅ |
| Works with private subnets | ❌ | ✅ |

---

## Bonus: Full IDE Experience on a Remote Server

Once connected, VSCode treats the EC2 instance exactly like your local machine. You can:

- Browse and edit files directly in the VSCode file explorer
- Run terminals, scripts, and build commands inside the instance
- Install VSCode extensions that run on the remote server (linters, debuggers, Copilot, etc.)
- Use port forwarding to preview web apps running on the EC2 in your local browser

This is especially useful when working with tools like **MCP servers**, **Steampipe**, or any heavy workload you don't want running locally.

---

## Reference

- [Remote Development with VS Code using AWS SSM](https://pub.towardsai.net/how-to-do-remote-development-with-vs-code-using-aws-ssm-415881d249f3)
