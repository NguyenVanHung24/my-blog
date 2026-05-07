---
title: "Kết nối EC2 Private qua SSM và VSCode"
pubDatetime: 2026-05-07T22:00:00+07:00
tags: ["tutorial", "aws", "ssm", "vscode", "security"]
description: "Cách truy cập an toàn vào EC2 private thông qua AWS SSM và VSCode Remote SSH — không cần mở port, không lộ access key."
lang: "vi"
---

🇬🇧 [Read in English](/posts/connect-ec2-ssm-vscode)

## Vấn đề

Bất kỳ ai có quyền truy cập vào EC2 đều có thể đọc Access Key lưu trên máy và truy vấn toàn bộ resource trên cloud. Vì vậy, ta cần một cách truy cập EC2 an toàn hơn — không lộ credential, không cần mở port inbound.

Giải pháp: **AWS Systems Manager (SSM)**. Kết hợp với AWS SSO và VSCode Remote SSH, bạn có thể kết nối vào EC2 private hoàn toàn qua tunnel, có audit log, không cần bastion host hay mở port 22.

---

## Điều kiện

- AWS CLI đã cài và cấu hình
- [Session Manager plugin cho AWS CLI](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html)
- VSCode đã cài extension **Remote - SSH**
- Node.js (một số tính năng remote của VSCode yêu cầu)
- IAM user/role có quyền SSM đến EC2 cần truy cập
- EC2 phải có SSM Agent đang chạy và IAM role với policy `AmazonSSMManagedInstanceCore`

---

## Bước 1: Tạo SSH Key Pair

Trên máy local:

```bash
ssh-keygen -t rsa -b 4096
```

Lệnh này tạo ra `~/.ssh/id_rsa` (private key) và `~/.ssh/id_rsa.pub` (public key).

---

## Bước 2: Đăng nhập AWS SSO

```bash
aws sso login --profile <your-sso-profile>
```

---

## Bước 3: Đẩy Public Key lên EC2 Private qua SSM

Dùng `ssm send-command` để ghi public key vào `authorized_keys` trên instance — không cần mở port SSH:

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

## Bước 4: Cấu hình SSH trong VSCode

Mở VSCode, nhấn `Ctrl + Shift + P` → **Remote-SSH: Add New SSH Host**, sau đó chỉnh file `~/.ssh/config`:

```
Host i-xxxxxxxxxxxxxxxxx
  User ubuntu
  IdentityFile C:/Users/<you>/.ssh/id_rsa
  ProxyCommand C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe "aws ssm start-session --target %h --document-name AWS-StartSSHSession --parameters 'portNumber=%p' --profile <your-sso-profile>"
```

> Thay `ubuntu` bằng `ec2-user` nếu bạn dùng Amazon Linux AMI.

---

## Bước 5: Kết nối

Trong VSCode, nhấn `Ctrl + Shift + P` → **Remote-SSH: Connect to Host** → chọn instance ID.

VSCode sẽ tunnel qua SSM và mở workspace remote trên EC2 private của bạn — không cần mở port, không cần bastion, không lộ key.

---

## So sánh

| | SSH truyền thống | SSM + VSCode |
|---|---|---|
| Cần mở port 22 | ✅ | ❌ |
| Cần bastion host | ✅ | ❌ |
| Có audit log CloudTrail | ❌ | ✅ |
| Hoạt động với private subnet | ❌ | ✅ |

---

## Bonus: Tương tác với server như máy tính của mình

Sau khi kết nối, VSCode coi EC2 như máy local của bạn. Bạn có thể:

- Duyệt và chỉnh sửa file trực tiếp trong file explorer của VSCode
- Mở terminal, chạy script và lệnh build ngay bên trong instance
- Cài extension VSCode chạy trên remote server (linter, debugger, Copilot, v.v.)
- Dùng port forwarding để xem trước web app đang chạy trên EC2 ngay trên trình duyệt local

Đặc biệt hữu ích khi làm việc với **MCP server**, **Steampipe**, hoặc các workload nặng mà bạn không muốn chạy trên máy local.

---

## Tham khảo

- [Remote Development with VS Code using AWS SSM](https://pub.towardsai.net/how-to-do-remote-development-with-vs-code-using-aws-ssm-415881d249f3)
