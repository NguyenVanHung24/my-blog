---
title: "AWS IAM Outbound Federation to Microsoft Entra ID: The Ultimate Guide"
pubDatetime: 2026-08-25T23:58:34+07:00
tags: ["tutorial", "aws", "iam", "azure", "security", "federation"]
description: "Enable AWS IAM roles to access Microsoft Graph and Azure resources using temporary tokens - no credentials needed."
lang: "en"
featured: true
---

**Enable AWS IAM roles to access Microsoft Graph and Azure resources using temporary tokens - no credentials needed**

---

## Table of Contents

1. [Introduction](#introduction)
2. [What is AWS IAM Outbound Federation?](#what-is-aws-iam-outbound-federation)
3. [Method 1 vs Method 2: Key Differences](#method-1-vs-method-2-key-differences)
4. [Architecture Overview](#architecture-overview)
5. [Prerequisites](#prerequisites)
6. [Step 1: Enable AWS IAM Outbound Federation](#step-1-enable-aws-iam-outbound-federation)
7. [Step 2: Configure IAM Role Permissions](#step-2-configure-iam-role-permissions)
8. [Step 3: Set Up Microsoft Entra ID Application](#step-3-set-up-microsoft-entra-id-application)
9. [Step 4: Configure Federated Credential in Azure](#step-4-configure-federated-credential-in-azure)
10. [Step 5: Grant API Permissions](#step-5-grant-api-permissions)
11. [Step 6: Test the Federation](#step-6-test-the-federation)
12. [Troubleshooting](#troubleshooting)
13. [Security Best Practices](#security-best-practices)
14. [Real-World Use Cases](#real-world-use-cases)
15. [Conclusion](#conclusion)

---

## Introduction

AWS IAM Outbound Federation is a powerful new feature that allows AWS IAM roles to authenticate with external identity providers like Microsoft Entra ID (formerly Azure AD) without storing any credentials. This guide demonstrates **Method 2** - using AWS IAM Outbound Federation to access Microsoft Graph API and Azure resources from EKS pods, EC2 instances, or any AWS compute running under an IAM role.

**What you'll achieve:**
- ✅ AWS IAM roles authenticate directly to Entra ID using temporary tokens
- ✅ No client secrets, passwords, or API keys anywhere
- ✅ Works across multiple EKS clusters in the same AWS account
- ✅ Simpler than EKS OIDC federation (Method 1)
- ✅ Access Microsoft Graph API and Azure resources seamlessly

---

## What is AWS IAM Outbound Federation?

AWS IAM Outbound Federation allows AWS to act as an OpenID Connect (OIDC) identity provider that issues signed JSON Web Tokens (JWTs) for your IAM roles. These tokens can then be exchanged with external identity providers like Microsoft Entra ID.

**Traditional approach (Method 1 - EKS OIDC):**
```
EKS Pod → Kubernetes ServiceAccount token → Exchange with Entra ID
```
❌ Limitations: Per-cluster setup, complex configuration, EKS-specific

**AWS IAM Outbound Federation (Method 2):**
```
AWS IAM Role → AWS STS token → Exchange with Entra ID
```
✅ Benefits: Account-wide, works everywhere (EKS, EC2, Lambda), simpler setup

---

## Method 1 vs Method 2: Key Differences

| Aspect | Method 1 (EKS OIDC) | Method 2 (AWS IAM Outbound) |
|--------|---------------------|----------------------------|
| **Issuer** | EKS OIDC Provider (per cluster) | AWS IAM Outbound (account-wide) |
| **Issuer Format** | `https://oidc.eks.<region>.amazonaws.com/id/<ID>` | `https://<uuid>.tokens.sts.global.api.aws` |
| **Subject** | `system:serviceaccount:<ns>:<sa>` | IAM Role ARN: `arn:aws:iam::<account>:role/<name>` |
| **Token Source** | Kubernetes projected volume | AWS STS API call |
| **Scope** | Single EKS cluster | Entire AWS account |
| **IAM Policy Required** | No | Yes: `sts:GetWebIdentityToken` |
| **Setup Complexity** | High (per-cluster) | Low (once per account) |
| **Use Cases** | EKS-only workloads | EKS, EC2, Lambda, any AWS compute |

**When to use Method 2:**
- You have multiple EKS clusters
- You want to use the same federation from EC2, Lambda, or other AWS services
- You prefer simpler, account-wide configuration
- You're okay with adding one IAM policy

**When to use Method 1:**
- You only have one EKS cluster
- You want cluster-level isolation
- You don't want to enable account-wide AWS IAM Outbound Federation

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Pod/EC2/Lambda runs under AWS IAM role                   │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Application calls:                                        │
│    aws sts get-web-identity-token                           │
│    --audience api://AzureADTokenExchange                    │
│    --signing-algorithm RS256                                │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. AWS STS returns JWT signed by AWS IAM Outbound issuer   │
│    Token claims:                                            │
│    - iss: https://<uuid>.tokens.sts.global.api.aws         │
│    - sub: arn:aws:iam::<account>:role/<role-name>          │
│    - aud: api://AzureADTokenExchange                        │
│    - exp: <timestamp> (5 minutes default)                   │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Application exchanges AWS token with Entra ID:          │
│    az login --service-principal --federated-token <JWT>     │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. Entra ID validates AWS token:                           │
│    - Downloads JWKS from AWS issuer                         │
│    - Verifies token signature                               │
│    - Checks issuer matches federated credential             │
│    - Checks subject matches IAM role ARN                    │
│    - Checks audience matches                                │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. Entra ID issues Azure access token (1 hour)            │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│ 7. Application uses token to call Microsoft Graph API      │
│    or Azure resource APIs                                   │
└─────────────────────────────────────────────────────────────┘
```

**Key Security Features:**
- Tokens are cryptographically signed by AWS
- Short-lived tokens (5 minutes default, max 15 minutes)
- Subject validation ensures only specific IAM roles can authenticate
- Audience validation prevents token reuse
- No secrets ever stored or transmitted

---

## Prerequisites

Before you begin, ensure you have:

**AWS Side:**
- ✅ AWS account with IAM admin permissions
- ✅ AWS CLI configured
- ✅ An IAM role (for EKS pod, EC2 instance, or other compute)
- ✅ IAM role ARN (format: `arn:aws:iam::<account-id>:role/<role-name>`)

**Azure Side:**
- ✅ Azure subscription
- ✅ Permissions to create App Registrations in Entra ID
- ✅ Permissions to grant API permissions (or access to an admin)

**Tools:**
- ✅ `aws` CLI (version 2.15.0+ for `get-web-identity-token` support)
- ✅ `jq` (for JSON parsing)
- ✅ Access to Azure Portal

---

## Step 1: Enable AWS IAM Outbound Federation

AWS IAM Outbound Federation is an account-level feature that must be explicitly enabled.

### 1.1 Enable Outbound Federation

Run this command **once per AWS account**:

```bash
aws iam enable-outbound-web-identity-federation \
  --region us-east-1
```

**Expected output:**
```
(No output means success)
```

**Note:** This is a global setting (not region-specific), but the API call requires specifying a region.

### 1.2 Verify Federation is Enabled

```bash
aws iam get-outbound-web-identity-federation-info \
  --region us-east-1
```

**Expected output:**
```json
{
    "IssuerIdentifier": "https://a1385c30-2bad-45a7-9461-c37fd441ac07.tokens.sts.global.api.aws",
    "IsJwtVendingEnabled": true
}
```

**Important:** Save the `IssuerIdentifier` URL — you'll need it in Step 4.

---

## Step 2: Configure IAM Role Permissions

Your IAM role needs permission to call `sts:GetWebIdentityToken`.

### 2.1 Create IAM Policy

Create a file `token-exchange-policy.json`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "GetWebIdentityToken",
      "Effect": "Allow",
      "Action": ["sts:GetWebIdentityToken"],
      "Resource": "*",
      "Condition": {
        "ForAllValues:StringEquals": {
          "sts:IdentityTokenAudience": "api://AzureADTokenExchange"
        }
      }
    }
  ]
}
```

**Security Note:** The condition restricts tokens to only be issued for the Azure audience.

### 2.2 Create the Policy

```bash
aws iam create-policy \
  --policy-name Allow-Azure-Token-Exchange \
  --description "Allow IAM role to get tokens for Entra ID federation" \
  --policy-document file://token-exchange-policy.json
```

**Expected output:**
```json
{
    "Policy": {
        "PolicyName": "Allow-Azure-Token-Exchange",
        "PolicyId": "ANPA...",
        "Arn": "arn:aws:iam::123456789012:policy/Allow-Azure-Token-Exchange",
        "CreateDate": "2026-08-25T16:00:00Z"
    }
}
```

**Save the Policy ARN** for the next step.

### 2.3 Attach Policy to Your IAM Role

Replace `<YOUR_ROLE_NAME>` with your actual IAM role name (e.g., `gitlab-runner-eks-gitlab-runner`):

```bash
aws iam attach-role-policy \
  --role-name <YOUR_ROLE_NAME> \
  --policy-arn arn:aws:iam::123456789012:policy/Allow-Azure-Token-Exchange
```

**Verify the attachment:**
```bash
aws iam list-attached-role-policies --role-name <YOUR_ROLE_NAME>
```

You should see the `Allow-Azure-Token-Exchange` policy listed.

---

## Step 3: Set Up Microsoft Entra ID Application

### 3.1 Create App Registration

1. Go to **Azure Portal** (https://portal.azure.com)
2. Navigate to **Microsoft Entra ID**
3. Click **App registrations** → **+ New registration**
4. Fill in:
   - **Name**: `aws-iam-federation-app`
   - **Supported account types**: **Single tenant**
   - **Redirect URI**: Leave empty
5. Click **Register**

### 3.2 Save Important Values

After registration, copy these values from the Overview page:

| Field | Example | Where to Use |
|-------|---------|-------------|
| **Application (client) ID** | `aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee` | In your application code |
| **Directory (tenant) ID** | `11111111-2222-3333-4444-555555555555` | In your application code |

---

## Step 4: Configure Federated Credential in Azure

This establishes trust between AWS IAM and Entra ID.

### 4.1 Open Federated Credentials

1. In your app registration, click **Certificates & secrets**
2. Click the **Federated credentials** tab
3. Click **+ Add credential**

### 4.2 Select Scenario

Select: **"Other issuer"**

(AWS IAM Outbound is not a standard scenario, so we use "Other issuer")

### 4.3 Fill in the Form

| Field | Value | Notes |
|-------|-------|-------|
| **Issuer** | `https://<your-uuid>.tokens.sts.global.api.aws` | Use the exact URL from Step 1.2 |
| **Type** | **Explicit subject identifier** | Select this option |
| **Subject identifier** | `arn:aws:iam::<account-id>:role/<role-name>` | Your IAM role ARN |
| **Name** | `aws-iam-outbound-federation` | Descriptive name |
| **Description** | `AWS IAM Outbound Federation for <role-name>` | Optional |
| **Audience** | `api://AzureADTokenExchange` | **Do not change!** |

**Example values:**
```
Issuer: https://a1385c30-2bad-45a7-9461-c37fd441ac07.tokens.sts.global.api.aws
Subject: arn:aws:iam::707578706742:role/gitlab-runner-eks-gitlab-runner
Audience: api://AzureADTokenExchange
```

### 4.4 Save the Credential

Click **Add** to save.

**Verification:** Go back to the Federated credentials tab and confirm your credential is listed with all three values visible.

---

## Step 5: Grant API Permissions

### 5.1 Add Microsoft Graph Permission

1. In your app registration, click **API permissions**
2. Click **+ Add a permission**
3. Select **Microsoft Graph**
4. Select **Application permissions** (not Delegated)
5. Search for and select: **`User.Read.All`**
6. Click **Add permissions**

### 5.2 Grant Admin Consent

⚠️ **Critical:** Application permissions require admin consent.

1. Click **"Grant admin consent for [Your Organization]"**
2. Confirm by clicking **Yes**
3. Wait for the green checkmark to appear in the Status column

---

## Step 6: Test the Federation

Now test the complete flow from an AWS compute resource (EC2, EKS pod, etc.).

### 6.1 Test from Bastion/EC2 Instance

If testing from an EC2 instance or bastion host running under your IAM role:

#### 6.1.1 Set Environment Variables

```bash
export AZURE_CLIENT_ID="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
export AZURE_TENANT_ID="11111111-2222-3333-4444-555555555555"
```

Replace with your actual Azure client ID and tenant ID from Step 3.2.

#### 6.1.2 Install Azure CLI (if needed)

**For Amazon Linux 2:**
```bash
sudo rpm --import https://packages.microsoft.com/keys/microsoft.asc

sudo sh -c 'echo -e "[azure-cli]
name=Azure CLI
baseurl=https://packages.microsoft.com/yumrepos/azure-cli
enabled=1
gpgcheck=1
gpgkey=https://packages.microsoft.com/keys/microsoft.asc" > /etc/yum.repos.d/azure-cli.repo'

sudo yum install -y azure-cli
```

**For Ubuntu/Debian:**
```bash
curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash
```

#### 6.1.3 Get AWS Token

```bash
JWT=$(aws sts get-web-identity-token \
    --audience api://AzureADTokenExchange \
    --signing-algorithm RS256 \
    --duration-seconds 300 \
    | jq -r '.WebIdentityToken')

echo "AWS Token length: ${#JWT} bytes"
```

**Expected:** Token length should be ~1500-2000 bytes.

#### 6.1.4 Inspect Token Claims (Optional)

```bash
echo $JWT | cut -d'.' -f2 | base64 -d 2>/dev/null | jq .
```

**Expected output:**
```json
{
  "aud": "api://AzureADTokenExchange",
  "sub": "arn:aws:iam::123456789012:role/your-role-name",
  "iss": "https://a1385c30-2bad-45a7-9461-c37fd441ac07.tokens.sts.global.api.aws",
  "exp": 1724599554,
  "iat": 1724599254
}
```

Verify:
- ✅ `aud` matches `api://AzureADTokenExchange`
- ✅ `sub` matches your IAM role ARN
- ✅ `iss` matches your AWS issuer URL

#### 6.1.5 Login to Azure

```bash
az login \
    --service-principal \
    --tenant "$AZURE_TENANT_ID" \
    --username "$AZURE_CLIENT_ID" \
    --federated-token "$JWT"
```

**✅ Success looks like this:**
```json
[
  {
    "cloudName": "AzureCloud",
    "id": "11111111-2222-3333-4444-555555555555",
    "isDefault": true,
    "name": "N/A(tenant level account)",
    "state": "Enabled",
    "tenantId": "11111111-2222-3333-4444-555555555555",
    "user": {
      "name": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      "type": "servicePrincipal"
    }
  }
]
```

#### 6.1.6 Test Microsoft Graph API

```bash
az rest --method GET \
    --url "https://graph.microsoft.com/v1.0/users?\$top=5"
```

**✅ Success looks like this:**
```json
{
  "@odata.context": "https://graph.microsoft.com/v1.0/$metadata#users",
  "value": [
    {
      "displayName": "John Doe",
      "userPrincipalName": "john@example.onmicrosoft.com",
      "mail": "john@example.com",
      "id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
    }
  ]
}
```

### 6.2 Test from EKS Pod

If testing from a pod in EKS:

#### 6.2.1 Create Test Pod Manifest

Save as `aws-iam-federation-test-pod.yaml`:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: aws-iam-federation-test
  namespace: gitlab-runner  # Change to your namespace
spec:
  serviceAccountName: gitlab-runner  # Must have IRSA annotation
  
  nodeSelector:
    workload: gitlab-runner  # Match your node labels
  
  tolerations:
  - key: workload
    operator: Equal
    value: gitlab-runner
    effect: NoSchedule
  
  containers:
  - name: azure-test
    image: mcr.microsoft.com/azure-cli:latest
    command: ["/bin/bash"]
    args: ["-c", "while true; do sleep 3600; done"]
    
    env:
    - name: AZURE_CLIENT_ID
      value: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"  # Change this
    - name: AZURE_TENANT_ID
      value: "11111111-2222-3333-4444-555555555555"  # Change this
```

**Replace:**
- `namespace`, `serviceAccountName`: Your actual namespace and service account
- `nodeSelector`, `tolerations`: Match your cluster setup (or remove if not using taints)
- `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`: Your values from Step 3.2

#### 6.2.2 Deploy the Pod

```bash
kubectl apply -f aws-iam-federation-test-pod.yaml

# Wait for pod to be ready
kubectl wait --for=condition=ready pod/aws-iam-federation-test \
    -n gitlab-runner --timeout=120s
```

#### 6.2.3 Run Test from Pod

```bash
kubectl exec -n gitlab-runner aws-iam-federation-test -- bash -c '
# Get AWS token
JWT=$(aws sts get-web-identity-token \
    --audience api://AzureADTokenExchange \
    --signing-algorithm RS256 \
    --duration-seconds 300 \
    | jq -r ".WebIdentityToken")

echo "✅ Got AWS token (${#JWT} bytes)"

# Login to Azure
az login \
    --service-principal \
    --tenant "$AZURE_TENANT_ID" \
    --username "$AZURE_CLIENT_ID" \
    --federated-token "$JWT"

echo ""
echo "✅ Logged in to Azure successfully!"

# Test Microsoft Graph API
echo ""
echo "Calling Microsoft Graph API..."
az rest --method GET \
    --url "https://graph.microsoft.com/v1.0/users?\$top=5"
'
```

**Expected:** Should see user data from Microsoft Graph.

#### 6.2.4 Cleanup

```bash
kubectl delete pod aws-iam-federation-test -n gitlab-runner
```

---

## Troubleshooting

### Error: "AccessDenied" when calling get-web-identity-token

**Meaning:** IAM role doesn't have `sts:GetWebIdentityToken` permission.

**Fix:**

1. Verify the policy is attached:
```bash
aws iam list-attached-role-policies --role-name <YOUR_ROLE_NAME>
```

2. Check the policy document:
```bash
aws iam get-policy-version \
    --policy-arn arn:aws:iam::123456789012:policy/Allow-Azure-Token-Exchange \
    --version-id v1 \
    --query 'PolicyVersion.Document'
```

3. If missing, reattach from Step 2.3.

### Error: "AADSTS700213: No matching federated identity record found"

**Meaning:** Azure cannot find a federated credential matching your AWS token.

**Causes:**
1. Issuer URL mismatch
2. Subject (IAM role ARN) mismatch  
3. Audience mismatch

**Fix:**

1. Get your exact IAM role ARN:
```bash
aws iam get-role --role-name <YOUR_ROLE_NAME> \
    --query 'Role.Arn' --output text
```

2. Get your AWS issuer URL:
```bash
aws iam get-outbound-web-identity-federation-info \
    --region us-east-1 \
    --query 'IssuerIdentifier' --output text
```

3. Go to Azure Portal → Your App → Certificates & secrets → Federated credentials

4. Verify these values **exactly** match:
   - **Issuer:** Must match AWS issuer URL
   - **Subject:** Must match IAM role ARN exactly
   - **Audience:** Must be `api://AzureADTokenExchange`

5. If any mismatch, delete the credential and recreate it with correct values.

### Error: "Invalid audience"

**Meaning:** The audience in the token doesn't match the federated credential.

**Fix:**

1. Verify you're passing the correct audience:
```bash
# Should always be this exact value
--audience api://AzureADTokenExchange
```

2. Check the federated credential in Azure has `api://AzureADTokenExchange` as the audience.

### Error: "Command 'get-web-identity-token' not found"

**Meaning:** AWS CLI version is too old.

**Fix:**

```bash
# Check AWS CLI version
aws --version

# Update to latest version (2.15.0+)
# For Linux:
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install --update

# Verify
aws --version
```

### Error: "Unauthorized" when calling Graph API

**Meaning:** API permissions not granted or admin consent missing.

**Fix:**

1. Go to Azure Portal → Your App → API permissions
2. Verify `User.Read.All` is listed with type "Application"
3. Check Status column shows "Granted for [Your Org]" (green checkmark)
4. If not granted, click "Grant admin consent"
5. Wait 5-10 minutes for propagation

### Token expires quickly

**Expected behavior:** Tokens are short-lived (5 minutes default, max 15 minutes).

**Solution:**

Your application should:
1. **Not cache tokens** - Request a new token for each operation
2. **Call get-web-identity-token** each time you need to authenticate
3. **Handle token expiration** gracefully in your code

**Example pattern:**
```bash
# Bad: Cache token
JWT=$(aws sts get-web-identity-token ...) 
# Use JWT for hours (will fail!)

# Good: Request token when needed
function get_azure_token() {
    JWT=$(aws sts get-web-identity-token \
        --audience api://AzureADTokenExchange \
        --signing-algorithm RS256 \
        --duration-seconds 300 | jq -r '.WebIdentityToken')
    
    az login --service-principal ... --federated-token "$JWT"
}

# Call function each time you need Azure access
get_azure_token
az rest --method GET --url "..."
```

---

## Security Best Practices

### ✅ Do This

1. **Use least-privilege IAM policies**
   - Only grant `sts:GetWebIdentityToken` to roles that need it
   - Use condition keys to restrict audience:
   ```json
   "Condition": {
     "ForAllValues:StringEquals": {
       "sts:IdentityTokenAudience": "api://AzureADTokenExchange"
     }
   }
   ```

2. **Use separate Azure apps per IAM role**
   - Don't share Azure app registrations across multiple IAM roles
   - Each role should have its own federated credential

3. **Grant minimal Azure API permissions**
   - Only grant the specific permissions your application needs
   - Use `User.Read.All` only if you truly need to read all users
   - Consider more restrictive permissions like `User.Read`

4. **Set short token durations**
   - Default 300 seconds (5 minutes) is recommended
   - Maximum is 900 seconds (15 minutes)
   - Shorter is more secure

5. **Monitor authentication attempts**
   - Enable Azure AD sign-in logs
   - Set up alerts for authentication failures
   - Review federated authentication activity regularly

6. **Use CloudTrail to audit token requests**
   ```bash
   # Find all get-web-identity-token calls
   aws cloudtrail lookup-events \
       --lookup-attributes AttributeKey=EventName,AttributeValue=GetWebIdentityToken
   ```

7. **Validate token claims in your application**
   ```python
   # Python example
   import jwt
   
   # Decode without verification (for inspection only)
   claims = jwt.decode(token, options={"verify_signature": False})
   
   # Validate
   assert claims['aud'] == 'api://AzureADTokenExchange'
   assert claims['iss'].startswith('https://')
   assert claims['sub'].startswith('arn:aws:iam::')
   ```

### ❌ Don't Do This

1. **Don't cache AWS tokens** - They expire in 5 minutes
2. **Don't share federated credentials** across different IAM roles
3. **Don't grant wildcard permissions** in Azure (`*` permissions)
4. **Don't disable audience validation**
5. **Don't use the same Azure app** for both Method 1 and Method 2
6. **Don't hardcode token duration** to maximum - use default
7. **Don't skip CloudTrail** - Always enable logging for security

---

## Real-World Use Cases

### Use Case 1: Multi-Cluster GitLab Runner

**Scenario:** You have 3 EKS clusters (dev, staging, prod), all need to access Azure resources.

**Traditional approach (Method 1):**
- Configure EKS OIDC provider for each cluster (3x setup)
- Create 3 separate federated credentials in Azure
- Manage 3 different configurations

**AWS IAM Outbound approach (Method 2):**
- Enable AWS IAM Outbound Federation once
- Create one IAM role: `gitlab-runner-eks-gitlab-runner`
- Create one federated credential in Azure
- Works across all 3 clusters automatically

**Setup:**
```bash
# One-time AWS setup
aws iam enable-outbound-web-identity-federation --region us-east-1

# One IAM policy for all clusters
aws iam create-policy --policy-name Allow-Azure-Token-Exchange ...
aws iam attach-role-policy --role-name gitlab-runner-eks-gitlab-runner ...

# One Azure federated credential
# Subject: arn:aws:iam::123456789012:role/gitlab-runner-eks-gitlab-runner

# Works from any cluster!
```

### Use Case 2: EC2 Accessing Azure Storage

**Scenario:** EC2 instances need to sync data to Azure Blob Storage.

**Setup:**
```bash
#!/bin/bash
# On EC2 instance with IAM role

export AZURE_CLIENT_ID="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
export AZURE_TENANT_ID="11111111-2222-3333-4444-555555555555"
export STORAGE_ACCOUNT="mystorageaccount"
export CONTAINER="backups"

# Get AWS token
JWT=$(aws sts get-web-identity-token \
    --audience api://AzureADTokenExchange \
    --signing-algorithm RS256 \
    --duration-seconds 300 | jq -r '.WebIdentityToken')

# Login to Azure
az login --service-principal \
    -u "$AZURE_CLIENT_ID" \
    -t "$AZURE_TENANT_ID" \
    --federated-token "$JWT"

# Upload to Azure Storage
az storage blob upload \
    --account-name "$STORAGE_ACCOUNT" \
    --container-name "$CONTAINER" \
    --name "backup-$(date +%Y%m%d).tar.gz" \
    --file ./backup.tar.gz \
    --auth-mode login
```

**Azure permissions needed:**
- `Storage Blob Data Contributor` role on the storage account

### Use Case 3: Lambda Reading Azure Key Vault

**Scenario:** AWS Lambda function needs secrets from Azure Key Vault.

**Setup:**
```python
# lambda_function.py
import boto3
import subprocess
import os
import json

def lambda_handler(event, context):
    # Get AWS token
    sts = boto3.client('sts')
    response = sts.get_web_identity_token(
        Audience='api://AzureADTokenExchange',
        SigningAlgorithm='RS256',
        DurationSeconds=300
    )
    jwt_token = response['WebIdentityToken']
    
    # Login to Azure
    subprocess.run([
        'az', 'login', '--service-principal',
        '-u', os.environ['AZURE_CLIENT_ID'],
        '-t', os.environ['AZURE_TENANT_ID'],
        '--federated-token', jwt_token
    ], check=True, capture_output=True)
    
    # Read secret from Key Vault
    result = subprocess.run([
        'az', 'keyvault', 'secret', 'show',
        '--vault-name', os.environ['KEY_VAULT_NAME'],
        '--name', os.environ['SECRET_NAME'],
        '--query', 'value',
        '-o', 'tsv'
    ], check=True, capture_output=True, text=True)
    
    secret_value = result.stdout.strip()
    
    return {
        'statusCode': 200,
        'body': json.dumps({'message': 'Secret retrieved successfully'})
    }
```

**Lambda IAM role needs:**
- Policy from Step 2 (`sts:GetWebIdentityToken`)

**Azure permissions needed:**
- `Key Vault Secrets User` role on the Key Vault

---

## Conclusion

You've successfully set up AWS IAM Outbound Federation to Microsoft Entra ID!

**What you achieved:**
- ✅ Account-wide federation (works across all clusters and services)
- ✅ No static credentials anywhere
- ✅ Simpler setup than per-cluster EKS OIDC
- ✅ Short-lived tokens with automatic expiration
- ✅ Cryptographically verified trust chain
- ✅ Works from EKS, EC2, Lambda, and any AWS compute

**Key takeaways:**
1. AWS IAM Outbound Federation is simpler than EKS OIDC for multi-cluster scenarios
2. One-time account setup enables federation everywhere
3. IAM role ARN becomes the identity (vs Kubernetes ServiceAccount)
4. Tokens are very short-lived (5 min default) for security
5. This pattern works for all Azure APIs (Graph, Storage, Key Vault, etc.)

**When to choose Method 2 (AWS IAM Outbound) over Method 1 (EKS OIDC):**
- ✅ You have multiple EKS clusters
- ✅ You need federation from EC2, Lambda, or other AWS services
- ✅ You prefer simpler, account-wide configuration
- ✅ You want one credential to rule them all

**Next steps:**
- Integrate this into your application code
- Set up CloudTrail logging and Azure sign-in monitoring
- Replicate for other IAM roles and applications
- Explore other Azure services you can access

**Further reading:**
- [AWS IAM Outbound Federation Documentation](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_outbound_getting_started.html)
- [AWS STS GetWebIdentityToken API](https://docs.aws.amazon.com/STS/latest/APIReference/API_GetWebIdentityToken.html)
- [Microsoft Entra Workload Identity Federation](https://learn.microsoft.com/en-us/entra/workload-id/workload-identity-federation)
- [Microsoft Graph API Reference](https://learn.microsoft.com/en-us/graph/api/overview)

---

## Appendix: Quick Reference

### Configuration Checklist

- [ ] AWS IAM Outbound Federation enabled
- [ ] IAM policy created with `sts:GetWebIdentityToken` permission
- [ ] IAM policy attached to target role
- [ ] AWS issuer identifier obtained
- [ ] Azure app registration created
- [ ] Federated credential configured with correct issuer, subject (IAM role ARN), and audience
- [ ] API permissions granted (e.g., User.Read.All)
- [ ] Admin consent granted
- [ ] Test command succeeds: `aws sts get-web-identity-token`
- [ ] `az login` with federated token succeeds
- [ ] Microsoft Graph API call returns data

### Critical Values Reference

| Setting | Format | Example |
|---------|--------|---------|
| AWS Issuer | `https://<uuid>.tokens.sts.global.api.aws` | `https://a1385c30-2bad-45a7-9461-c37fd441ac07.tokens.sts.global.api.aws` |
| IAM Role ARN | `arn:aws:iam::<account>:role/<name>` | `arn:aws:iam::123456789012:role/my-role` |
| Azure Client ID | UUID | `aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee` |
| Azure Tenant ID | UUID | `11111111-2222-3333-4444-555555555555` |
| Subject | IAM Role ARN | `arn:aws:iam::123456789012:role/my-role` |
| Audience | Fixed value | `api://AzureADTokenExchange` |

### Common Commands

```bash
# Enable AWS IAM Outbound Federation
aws iam enable-outbound-web-identity-federation --region us-east-1

# Get AWS issuer URL
aws iam get-outbound-web-identity-federation-info --region us-east-1

# Get AWS token
JWT=$(aws sts get-web-identity-token \
    --audience api://AzureADTokenExchange \
    --signing-algorithm RS256 \
    --duration-seconds 300 | jq -r '.WebIdentityToken')

# Login to Azure
az login --service-principal \
    -u "$AZURE_CLIENT_ID" \
    -t "$AZURE_TENANT_ID" \
    --federated-token "$JWT"

# Call Microsoft Graph API
az rest --method GET \
    --url "https://graph.microsoft.com/v1.0/users?\$top=5"
```

### Comparison: Method 1 vs Method 2

| Feature | EKS OIDC (Method 1) | AWS IAM Outbound (Method 2) |
|---------|---------------------|----------------------------|
| **Setup per cluster** | Yes | No (account-wide) |
| **Works from EC2** | No | Yes |
| **Works from Lambda** | No | Yes |
| **Token duration** | 1 hour | 5 minutes (default) |
| **IAM policy required** | No | Yes |
| **Subject format** | `system:serviceaccount:...` | `arn:aws:iam::...` |
| **Best for** | Single EKS cluster | Multiple clusters or mixed compute |
