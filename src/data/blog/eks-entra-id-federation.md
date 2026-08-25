---
title: "Secure AWS EKS to Microsoft Entra ID Federation: A Complete Guide"
pubDatetime: 2026-08-25T23:55:53+07:00
tags: ["tutorial", "aws", "eks", "azure", "security", "federation", "oidc"]
description: "Enable your EKS pods to access Microsoft Graph and Azure resources without storing any credentials using OIDC federation."
lang: "en"
featured: true
---

**Enable your EKS pods to access Microsoft Graph and Azure resources without storing any credentials**

---

## Table of Contents

1. [Introduction](#introduction)
2. [What is OIDC Federation?](#what-is-oidc-federation)
3. [Architecture Overview](#architecture-overview)
4. [Prerequisites](#prerequisites)
5. [Step 1: Set Up Microsoft Entra ID Application](#step-1-set-up-microsoft-entra-id-application)
6. [Step 2: Configure Federated Credential](#step-2-configure-federated-credential)
7. [Step 3: Grant API Permissions](#step-3-grant-api-permissions)
8. [Step 4: Annotate Kubernetes ServiceAccount](#step-4-annotate-kubernetes-serviceaccount)
9. [Step 5: Deploy Test Pod](#step-5-deploy-test-pod)
10. [Step 6: Verify the Federation](#step-6-verify-the-federation)
11. [Troubleshooting](#troubleshooting)
12. [Security Best Practices](#security-best-practices)
13. [Real-World Use Cases](#real-world-use-cases)
14. [Conclusion](#conclusion)

---

## Introduction

In modern cloud-native architectures, securely accessing external services without storing credentials is a critical challenge. This guide demonstrates how to enable your Amazon EKS pods to authenticate with Microsoft Entra ID (formerly Azure AD) and access Microsoft Graph API or Azure resources using **OIDC (OpenID Connect) federation** — with zero static credentials stored anywhere.

**What you'll achieve:**
- ✅ EKS pods authenticate to Entra ID using temporary tokens
- ✅ No client secrets, passwords, or API keys in code or environment variables
- ✅ Automatic token rotation and expiration
- ✅ Access Microsoft Graph API (read users, groups, etc.)
- ✅ Access Azure resources (Storage, Key Vault, etc.) with the same pattern

---

## What is OIDC Federation?

OIDC federation allows one identity provider (AWS EKS) to issue tokens that another identity provider (Microsoft Entra ID) trusts and accepts.

**Traditional approach (insecure):**
```
Application → Reads client secret from environment variable → Authenticates with Azure
```
❌ Problems: Secrets can leak, need rotation, stored in plain text

**OIDC Federation approach (secure):**
```
EKS Pod → Gets temporary token from Kubernetes → Exchanges with Entra ID → Accesses Azure
```
✅ Benefits: No secrets, automatic rotation, cryptographically verified

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Pod starts in EKS cluster                                │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Kubernetes injects ServiceAccount token (JWT)            │
│    - Signed by EKS OIDC provider                            │
│    - Audience: api://AzureADTokenExchange                   │
│    - Subject: system:serviceaccount:namespace:sa-name       │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Application calls: az login --federated-token            │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Entra ID validates token against EKS OIDC issuer        │
│    - Downloads OIDC discovery document                      │
│    - Verifies token signature using public keys             │
│    - Checks audience, subject, expiration                   │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. Entra ID issues Azure access token                      │
│    - Valid for 1 hour                                       │
│    - Scoped to granted permissions                          │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. Application uses token to call Microsoft Graph API      │
│    or Azure resource APIs                                   │
└─────────────────────────────────────────────────────────────┘
```

**Key Security Features:**
- Tokens are short-lived (1 hour default)
- Cryptographically signed and verified
- Audience validation prevents token reuse
- Subject validation ensures only specific pods can authenticate

---

## Prerequisites

Before you begin, ensure you have:

**AWS Side:**
- ✅ EKS cluster running (any version with OIDC provider enabled)
- ✅ OIDC provider URL (format: `https://oidc.eks.<region>.amazonaws.com/id/<UNIQUE_ID>`)
- ✅ kubectl configured to access your cluster
- ✅ A Kubernetes namespace and ServiceAccount

**Azure Side:**
- ✅ Azure subscription
- ✅ Permissions to create App Registrations in Entra ID
- ✅ Permissions to grant API permissions (or access to an admin who can)

**Tools:**
- ✅ `kubectl` CLI
- ✅ `aws` CLI (optional, for getting OIDC issuer)
- ✅ Access to Azure Portal

---

## Step 1: Set Up Microsoft Entra ID Application

### 1.1 Get Your EKS OIDC Issuer URL

First, retrieve your EKS cluster's OIDC issuer URL:

```bash
aws eks describe-cluster \
  --name <YOUR_CLUSTER_NAME> \
  --region <YOUR_REGION> \
  --query 'cluster.identity.oidc.issuer' \
  --output text
```

**Example output:**
```
https://oidc.eks.ap-southeast-1.amazonaws.com/id/ABC123DEF456
```

**Important:** Save this URL — you'll need it in Step 2.

### 1.2 Create App Registration in Entra ID

1. Go to **Azure Portal** (https://portal.azure.com)
2. Navigate to **Microsoft Entra ID** (search for it in the top bar)
3. Click **App registrations** in the left menu
4. Click **+ New registration**

5. Fill in the registration form:
   - **Name**: `eks-federation-app` (or any descriptive name)
   - **Supported account types**: Select **"Accounts in this organizational directory only (Single tenant)"**
   - **Redirect URI**: Leave empty (not needed for service principal)

6. Click **Register**

### 1.3 Save Important Values

After registration, you'll see the app's overview page. **Copy and save these values:**

| Field | Where to Find It | Example | What It's Used For |
|-------|-----------------|---------|-------------------|
| **Application (client) ID** | Overview page | `aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee` | Identifies your app to Azure |
| **Directory (tenant) ID** | Overview page | `11111111-2222-3333-4444-555555555555` | Identifies your Azure AD tenant |

---

## Step 2: Configure Federated Credential

This is the crucial step that establishes trust between EKS and Entra ID.

### 2.1 Open Federated Credentials Settings

1. In your app registration, click **Certificates & secrets** in the left menu
2. Click the **Federated credentials** tab
3. Click **+ Add credential**

### 2.2 Select Scenario

Select the scenario: **"Kubernetes accessing Azure resources"**

### 2.3 Fill in the Form

Now fill in the form with these exact values:

**Connect your Kubernetes service account:**

| Field | Value | Notes |
|-------|-------|-------|
| **Cluster issuer URL** | `https://oidc.eks.<region>.amazonaws.com/id/<YOUR_ID>` | Paste the OIDC issuer URL from Step 1.1 |
| **Namespace** | `your-namespace` | The Kubernetes namespace where your pod runs (e.g., `default`, `gitlab-runner`, `production`) |
| **Service account name** | `your-serviceaccount` | The name of the Kubernetes ServiceAccount (e.g., `gitlab-runner`, `app-sa`) |
| **Subject identifier** | `system:serviceaccount:<namespace>:<sa-name>` | Auto-generated based on namespace and SA name |

**Example values:**
```
Cluster issuer URL: https://oidc.eks.ap-southeast-1.amazonaws.com/id/ABC123DEF456
Namespace: gitlab-runner
Service account name: gitlab-runner
Subject identifier: system:serviceaccount:gitlab-runner:gitlab-runner
```

**Credential details:**

| Field | Value |
|-------|-------|
| **Name** | `eks-federation-credential` |
| **Description** | `Federated credential for EKS pods to access Azure` |
| **Audience** | `api://AzureADTokenExchange` ⚠️ **Do not change this!** |

### 2.4 Save the Credential

Click **Add** to save the federated credential.

**What just happened?**
- You told Entra ID to trust tokens issued by your EKS cluster's OIDC provider
- Only tokens with the exact subject identifier (namespace + ServiceAccount) will be accepted
- The audience field ensures tokens can't be reused for other purposes

---

## Step 3: Grant API Permissions

Now grant your app permissions to access Microsoft Graph API.

### 3.1 Add API Permission

1. In your app registration, click **API permissions** in the left menu
2. Click **+ Add a permission**
3. Select **Microsoft Graph**
4. Select **Application permissions** (not Delegated permissions)
5. Search for and select: **`User.Read.All`**
6. Click **Add permissions**

**Why User.Read.All?**
This permission allows your app to read all users in your Azure AD tenant. You can grant different permissions based on your needs:
- `User.Read.All` - Read all users
- `Group.Read.All` - Read all groups
- Azure resource permissions (for accessing Storage, Key Vault, etc.)

### 3.2 Grant Admin Consent

⚠️ **Critical Step:** Application permissions require admin consent.

1. Click the button: **"Grant admin consent for [Your Organization]"**
2. Confirm by clicking **Yes**
3. You should see a green checkmark in the "Status" column

**Don't have admin permissions?**
- Ask your Azure AD administrator to grant consent
- Share this link with them: `https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationMenuBlade/~/CallAnAPI/appId/<YOUR_CLIENT_ID>`

---

## Step 4: Annotate Kubernetes ServiceAccount

Now connect your Kubernetes ServiceAccount to the Azure app.

### 4.1 Check Existing ServiceAccount

First, check if your ServiceAccount already exists:

```bash
kubectl get serviceaccount <YOUR_SA_NAME> -n <YOUR_NAMESPACE>
```

If it doesn't exist, create it:

```bash
kubectl create serviceaccount <YOUR_SA_NAME> -n <YOUR_NAMESPACE>
```

### 4.2 Add Azure Annotation

Annotate the ServiceAccount with your Azure client ID:

```bash
kubectl annotate serviceaccount <YOUR_SA_NAME> \
  -n <YOUR_NAMESPACE> \
  azure.workload.identity/client-id="<YOUR_AZURE_CLIENT_ID>" \
  --overwrite
```

**Example:**
```bash
kubectl annotate serviceaccount gitlab-runner \
  -n gitlab-runner \
  azure.workload.identity/client-id="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" \
  --overwrite
```

### 4.3 Verify the Annotation

```bash
kubectl get serviceaccount <YOUR_SA_NAME> -n <YOUR_NAMESPACE> -o yaml
```

You should see:
```yaml
metadata:
  annotations:
    azure.workload.identity/client-id: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee
  name: your-serviceaccount
  namespace: your-namespace
```

---

## Step 5: Deploy Test Pod

Create a test pod to verify the federation works.

### 5.1 Create Pod Manifest

Save this as `azure-test-pod.yaml`:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: azure-federation-test
  namespace: <YOUR_NAMESPACE>  # Change this
  labels:
    azure.workload.identity/use: "true"  # Required label
spec:
  serviceAccountName: <YOUR_SA_NAME>  # Change this

  # Optional: Add node selectors/tolerations if needed
  # nodeSelector:
  #   workload: your-workload
  # tolerations:
  # - key: workload
  #   operator: Equal
  #   value: your-workload
  #   effect: NoSchedule

  containers:
  - name: azure-cli
    image: mcr.microsoft.com/azure-cli:latest
    command: ["/bin/bash"]
    args: ["-c", "while true; do sleep 3600; done"]

    env:
    - name: AZURE_CLIENT_ID
      value: "<YOUR_AZURE_CLIENT_ID>"  # Change this
    - name: AZURE_TENANT_ID
      value: "<YOUR_AZURE_TENANT_ID>"  # Change this
    - name: AZURE_FEDERATED_TOKEN_FILE
      value: "/var/run/secrets/tokens/azure-identity-token"

    volumeMounts:
    - name: azure-identity-token
      mountPath: /var/run/secrets/tokens
      readOnly: true

  volumes:
  - name: azure-identity-token
    projected:
      sources:
      - serviceAccountToken:
          path: azure-identity-token
          expirationSeconds: 3600
          audience: api://AzureADTokenExchange  # Must match Step 2
```

**Replace these placeholders:**
- `<YOUR_NAMESPACE>` - Your Kubernetes namespace
- `<YOUR_SA_NAME>` - Your ServiceAccount name
- `<YOUR_AZURE_CLIENT_ID>` - Application (client) ID from Step 1.3
- `<YOUR_AZURE_TENANT_ID>` - Directory (tenant) ID from Step 1.3

### 5.2 Deploy the Pod

```bash
kubectl apply -f azure-test-pod.yaml
```

### 5.3 Wait for Pod to be Ready

```bash
kubectl wait --for=condition=ready pod/azure-federation-test \
  -n <YOUR_NAMESPACE> \
  --timeout=120s
```

### 5.4 Verify Pod is Running

```bash
kubectl get pod azure-federation-test -n <YOUR_NAMESPACE>
```

Expected output:
```
NAME                    READY   STATUS    RESTARTS   AGE
azure-federation-test   1/1     Running   0          45s
```

---

## Step 6: Verify the Federation

Now test that everything works end-to-end.

### 6.1 Check Token is Mounted

First, verify the Azure identity token file exists:

```bash
kubectl exec azure-federation-test -n <YOUR_NAMESPACE> -- \
  ls -la /var/run/secrets/tokens/
```

**Expected output:**
```
total 0
drwxrwxrwt 3 root root  140 Aug 25 15:00 .
drwxr-xr-x 3 root root 4096 Aug 25 15:00 ..
drwxr-xr-x 2 root root  100 Aug 25 15:00 ..2026_08_25_15_00_12.123456789
lrwxrwxrwx 1 root root   32 Aug 25 15:00 ..data -> ..2026_08_25_15_00_12.123456789
lrwxrwxrwx 1 root root   27 Aug 25 15:00 azure-identity-token -> ..data/azure-identity-token
```

✅ You should see the `azure-identity-token` file.

### 6.2 Test Azure Authentication

Set your environment variables:

```bash
export AZURE_CLIENT_ID="<YOUR_AZURE_CLIENT_ID>"
export AZURE_TENANT_ID="<YOUR_AZURE_TENANT_ID>"
```

Now test authentication:

```bash
kubectl exec azure-federation-test -n <YOUR_NAMESPACE> -- sh -c "
az login --service-principal \
  -u $AZURE_CLIENT_ID \
  -t $AZURE_TENANT_ID \
  --federated-token \"\$(cat /var/run/secrets/tokens/azure-identity-token)\" \
  --allow-no-subscriptions
"
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

**Key indicators of success:**
- Returns JSON (not an error)
- `"state": "Enabled"`
- `"type": "servicePrincipal"`
- The `name` matches your Azure client ID

### 6.3 Test Microsoft Graph API Access

Now test calling Microsoft Graph API to read users:

```bash
kubectl exec azure-federation-test -n <YOUR_NAMESPACE> -- sh -c "
# Login first (suppress output)
az login --service-principal \
  -u $AZURE_CLIENT_ID \
  -t $AZURE_TENANT_ID \
  --federated-token \"\$(cat /var/run/secrets/tokens/azure-identity-token)\" \
  --allow-no-subscriptions > /dev/null 2>&1

# Get access token for Microsoft Graph
TOKEN=\$(az account get-access-token \
  --resource https://graph.microsoft.com \
  --query accessToken -o tsv)

# Call Microsoft Graph API
curl -s 'https://graph.microsoft.com/v1.0/users?\$top=5' \
  -H \"Authorization: Bearer \$TOKEN\" \
  -H 'Content-Type: application/json'
"
```

**✅ Success looks like this:**
```json
{
  "@odata.context": "https://graph.microsoft.com/v1.0/$metadata#users",
  "value": [
    {
      "businessPhones": [],
      "displayName": "John Doe",
      "givenName": "John",
      "jobTitle": "Developer",
      "mail": "john@example.com",
      "userPrincipalName": "john@example.onmicrosoft.com",
      "id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
    },
    {
      "displayName": "Jane Smith",
      "userPrincipalName": "jane@example.onmicrosoft.com",
      ...
    }
  ]
}
```

**Key indicators of success:**
- Returns JSON with user data
- Shows users from your Azure AD tenant
- No authentication errors

---

## Troubleshooting

### Error: "AADSTS70021: No matching federated identity record found"

**Meaning:** Azure cannot find a federated credential matching your token.

**Causes:**
1. OIDC issuer URL mismatch
2. Subject identifier mismatch
3. Audience mismatch

**Fix:**

1. Verify your EKS OIDC issuer:
```bash
aws eks describe-cluster --name <CLUSTER_NAME> --region <REGION> \
  --query 'cluster.identity.oidc.issuer' --output text
```

2. Go to Azure Portal → Your App → Certificates & secrets → Federated credentials

3. Verify these values **exactly** match:
   - **Issuer:** Must match EKS OIDC URL exactly
   - **Subject:** `system:serviceaccount:<namespace>:<serviceaccount-name>`
   - **Audience:** `api://AzureADTokenExchange`

4. Check Kubernetes ServiceAccount subject:
```bash
kubectl exec azure-federation-test -n <YOUR_NAMESPACE> -- \
  cat /var/run/secrets/tokens/azure-identity-token | \
  cut -d'.' -f2 | base64 -d 2>/dev/null | grep -o '"sub":"[^"]*"'
```

### Error: "Token file not found"

**Meaning:** The Azure identity token is not mounted in the pod.

**Fix:**

1. Verify the pod has the projected volume:
```bash
kubectl describe pod azure-federation-test -n <YOUR_NAMESPACE> | \
  grep -A 10 "Volumes:"
```

2. Check the pod manifest has:
   - Label: `azure.workload.identity/use: "true"`
   - Volume: `projected` with `audience: api://AzureADTokenExchange`
   - VolumeMount: mounted at `/var/run/secrets/tokens`

3. Recreate the pod:
```bash
kubectl delete pod azure-federation-test -n <YOUR_NAMESPACE>
kubectl apply -f azure-test-pod.yaml
```

### Error: "Unauthorized" or "Forbidden" when calling Graph API

**Meaning:** The app doesn't have permissions or admin consent wasn't granted.

**Fix:**

1. Go to Azure Portal → Your App → API permissions

2. Verify:
   - `User.Read.All` permission is listed
   - Permission type is **"Application"** (not Delegated)
   - Status shows **"Granted for [Your Org]"** (green checkmark)

3. If not granted:
   - Click **"Grant admin consent for [Your Organization]"**
   - Wait 5-10 minutes for propagation

4. Verify permission grant:
```bash
# Check the access token claims
kubectl exec azure-federation-test -n <YOUR_NAMESPACE> -- sh -c "
az login --service-principal \
  -u $AZURE_CLIENT_ID \
  -t $AZURE_TENANT_ID \
  --federated-token \"\$(cat /var/run/secrets/tokens/azure-identity-token)\" \
  --allow-no-subscriptions > /dev/null 2>&1

TOKEN=\$(az account get-access-token --resource https://graph.microsoft.com --query accessToken -o tsv)

# Decode the token (without signature verification)
echo \$TOKEN | cut -d'.' -f2 | base64 -d 2>/dev/null
"
```

Look for the `"roles"` claim — it should include `"User.Read.All"`.

### Error: "Connection refused" when running kubectl

**Meaning:** kubectl is not configured or you're not connected to the cluster.

**Fix:**

```bash
# Configure kubectl
aws eks update-kubeconfig --name <CLUSTER_NAME> --region <REGION>

# Verify connection
kubectl get nodes
```

### Token expires after 1 hour

**This is expected behavior!** The projected ServiceAccount token automatically refreshes.

**How it works:**
- Token expires after 1 hour (3600 seconds)
- Kubernetes automatically writes a new token to the same file path
- Your application should not cache the token — read from the file each time

**Verify auto-refresh:**
```bash
# Watch the token file modification time
kubectl exec azure-federation-test -n <YOUR_NAMESPACE> -- sh -c "
watch -n 60 'stat /var/run/secrets/tokens/azure-identity-token'
"
```

---

## Security Best Practices

### ✅ Do This

1. **Use least-privilege permissions**
   - Only grant the minimum API permissions your app needs
   - Example: Use `User.Read.All` only if you need to read all users
   - Use more restrictive permissions like `User.Read` when possible

2. **Use separate ServiceAccounts per application**
   - Don't share ServiceAccounts between different apps
   - Each app should have its own ServiceAccount and Azure app registration

3. **Set short token expiration**
   - Default 3600 seconds (1 hour) is good
   - Can be reduced for high-security scenarios
   - Kubernetes auto-refreshes the token

4. **Monitor authentication attempts**
   - Enable Azure AD sign-in logs
   - Set up alerts for authentication failures
   - Review federated authentication activity regularly

5. **Use namespace isolation**
   - Deploy apps in separate namespaces
   - Each namespace can have its own federated identity
   - Prevents cross-namespace token reuse

6. **Validate audience in your app**
   ```python
   # Python example
   assert token_claims['aud'] == 'api://AzureADTokenExchange'
   ```

7. **Read token from file each time**
   - Don't cache the token in memory
   - Always read from `/var/run/secrets/tokens/azure-identity-token`
   - This ensures you get the refreshed token

### ❌ Don't Do This

1. **Don't hardcode client secrets** (this defeats the purpose!)
2. **Don't store tokens in environment variables**
3. **Don't disable token expiration**
4. **Don't share Azure app registrations** across multiple EKS clusters
5. **Don't grant wildcard permissions** (`*` in API permissions)
6. **Don't skip the audience validation** in your federated credential

---

## Real-World Use Cases

### Use Case 1: CI/CD Accessing Azure Resources

**Scenario:** GitLab Runner on EKS needs to deploy artifacts to Azure Blob Storage.

**Setup:**
```yaml
# GitLab CI job
deploy-to-azure:
  stage: deploy
  image: mcr.microsoft.com/azure-cli
  variables:
    AZURE_CLIENT_ID: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    AZURE_TENANT_ID: "11111111-2222-3333-4444-555555555555"
    AZURE_FEDERATED_TOKEN_FILE: "/var/run/secrets/tokens/azure-identity-token"
  script:
    - az login --service-principal -u $AZURE_CLIENT_ID -t $AZURE_TENANT_ID 
        --federated-token "$(cat $AZURE_FEDERATED_TOKEN_FILE)" --allow-no-subscriptions
    - az storage blob upload --account-name mystorageaccount 
        --container-name builds --name app-v1.0.tar.gz 
        --file ./build/app.tar.gz --auth-mode login
```

**Permissions needed:**
- `Storage Blob Data Contributor` role on Azure Storage Account

### Use Case 2: Reading User Data for Application Logic

**Scenario:** Your app running on EKS needs to list Azure AD users for directory sync.

**Setup:**
```python
# Python application
import subprocess
import json
import requests

# Read token from file
with open('/var/run/secrets/tokens/azure-identity-token', 'r') as f:
    federated_token = f.read().strip()

# Exchange for Azure token
result = subprocess.run([
    'az', 'login', '--service-principal',
    '-u', os.environ['AZURE_CLIENT_ID'],
    '-t', os.environ['AZURE_TENANT_ID'],
    '--federated-token', federated_token,
    '--allow-no-subscriptions'
], capture_output=True)

# Get Graph token
token_result = subprocess.run([
    'az', 'account', 'get-access-token',
    '--resource', 'https://graph.microsoft.com',
    '--query', 'accessToken', '-o', 'tsv'
], capture_output=True, text=True)
access_token = token_result.stdout.strip()

# Call Graph API
response = requests.get(
    'https://graph.microsoft.com/v1.0/users',
    headers={'Authorization': f'Bearer {access_token}'}
)
users = response.json()
```

**Permissions needed:**
- `User.Read.All` application permission

### Use Case 3: Accessing Azure Key Vault Secrets

**Scenario:** Application needs to read secrets from Azure Key Vault.

**Setup:**
```bash
# Inside your pod
az login --service-principal \
  -u $AZURE_CLIENT_ID \
  -t $AZURE_TENANT_ID \
  --federated-token "$(cat $AZURE_FEDERATED_TOKEN_FILE)" \
  --allow-no-subscriptions

# Read a secret
az keyvault secret show \
  --vault-name my-keyvault \
  --name database-password \
  --query value -o tsv
```

**Permissions needed:**
- `Key Vault Secrets User` role on the Key Vault
- Or add access policy: Get, List permissions on secrets

---

## Conclusion

You've successfully set up secure, credential-free authentication between AWS EKS and Microsoft Entra ID using OIDC federation!

**What you achieved:**
- ✅ Zero static credentials stored in code, config, or environment
- ✅ Automatic token rotation every hour
- ✅ Cryptographically verified trust chain
- ✅ Least-privilege access with granular API permissions
- ✅ Audit trail in Azure AD sign-in logs

**Key takeaways:**
1. OIDC federation eliminates the need for client secrets
2. Kubernetes projected volumes provide automatic token refresh
3. Azure validates tokens using public OIDC discovery
4. This pattern works for all Azure APIs (Graph, Storage, Key Vault, etc.)

**Next steps:**
- Integrate this into your application code
- Set up monitoring and alerting for auth failures
- Replicate for other namespaces and applications
- Explore other Azure services you can access

**Further reading:**
- [Azure Workload Identity Documentation](https://azure.github.io/azure-workload-identity/)
- [EKS OIDC Provider Documentation](https://docs.aws.amazon.com/eks/latest/userguide/enable-iam-roles-for-service-accounts.html)
- [Microsoft Graph API Reference](https://learn.microsoft.com/en-us/graph/api/overview)
- [Kubernetes Projected Volumes](https://kubernetes.io/docs/concepts/storage/projected-volumes/)

---

## Appendix: Quick Reference

### Configuration Checklist

- [ ] EKS OIDC issuer URL obtained
- [ ] Azure app registration created
- [ ] Federated credential configured with correct issuer, subject, audience
- [ ] API permissions granted (e.g., User.Read.All)
- [ ] Admin consent granted for application permissions
- [ ] Kubernetes ServiceAccount annotated with Azure client ID
- [ ] Test pod deployed with projected volume
- [ ] Token file exists at `/var/run/secrets/tokens/azure-identity-token`
- [ ] `az login` with federated token succeeds
- [ ] Microsoft Graph API call returns data

### Critical Values Reference

| Setting | Format | Example (Placeholder) |
|---------|--------|----------------------|
| EKS OIDC Issuer | `https://oidc.eks.<region>.amazonaws.com/id/<ID>` | `https://oidc.eks.us-east-1.amazonaws.com/id/ABC123...` |
| Azure Client ID | UUID | `aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee` |
| Azure Tenant ID | UUID | `11111111-2222-3333-4444-555555555555` |
| Subject | `system:serviceaccount:<ns>:<sa>` | `system:serviceaccount:default:my-app` |
| Audience | Fixed value | `api://AzureADTokenExchange` |
| Token Path | Fixed value | `/var/run/secrets/tokens/azure-identity-token` |

### Common Commands

```bash
# Get OIDC issuer
aws eks describe-cluster --name <CLUSTER> --region <REGION> \
  --query 'cluster.identity.oidc.issuer' --output text

# Annotate ServiceAccount
kubectl annotate serviceaccount <SA_NAME> -n <NAMESPACE> \
  azure.workload.identity/client-id="<CLIENT_ID>" --overwrite

# Test authentication
kubectl exec <POD_NAME> -n <NAMESPACE> -- \
  az login --service-principal -u <CLIENT_ID> -t <TENANT_ID> \
  --federated-token "$(cat /var/run/secrets/tokens/azure-identity-token)" \
  --allow-no-subscriptions

# Call Microsoft Graph API
kubectl exec <POD_NAME> -n <NAMESPACE> -- sh -c "
TOKEN=\$(az account get-access-token --resource https://graph.microsoft.com --query accessToken -o tsv)
curl 'https://graph.microsoft.com/v1.0/users' -H \"Authorization: Bearer \$TOKEN\"
"
```
