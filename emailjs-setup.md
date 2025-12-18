# EmailJS Setup Guide for Label Scanner (with CSV Attachment)

## Quick Setup (5 minutes)

### Step 1: Create EmailJS Account
1. Go to [emailjs.com](https://www.emailjs.com/)
2. Click **Sign Up** (free tier: 200 emails/month)
3. Verify your email

### Step 2: Add Gmail Service
1. In EmailJS dashboard, go to **Email Services**
2. Click **Add New Service** → Select **Gmail**
3. Click **Connect Account** and sign in with your Gmail
4. Name it (e.g., "Label Scanner Gmail")
5. Click **Create Service**
6. **Copy your Service ID** (e.g., `service_abc123`)

### Step 3: Create Email Template (with Attachment Support)
1. Go to **Email Templates** → **Create New Template**
2. Set these fields:

**To Email:** `{{to_email}}`

**Subject:** `{{subject}}`

**Content (Body):**
```
{{{message}}}

--- CSV Data ---
{{csv_data}}
```

> **Note:** EmailJS free tier doesn't support file attachments directly. The CSV data is included in the email body. For actual file attachments, you'd need EmailJS Pro or a backend solution.

3. Click **Save**
4. **Copy your Template ID** (e.g., `template_xyz789`)

### Step 4: Get Public Key
1. Go to **Account** → **General**
2. **Copy your Public Key** (e.g., `abcdef123456`)

### Step 5: Update app.js (Already Done!)
Your credentials are already configured in `js/app.js`:
```javascript
EMAILJS_SERVICE_ID: 'service_n25uei8',
EMAILJS_TEMPLATE_ID: 'template_mg93g7t',
EMAILJS_PUBLIC_KEY: 'KR8R8Md2snSurgMJF',
```

## ✅ Done!
Now when you click **Email** in Label Scanner, the CSV data will be sent via email.

## Template Variables Available

| Variable | Description |
|----------|-------------|
| `{{to_email}}` | Recipient email address |
| `{{subject}}` | Email subject line |
| `{{message}}` | Summary message |
| `{{csv_data}}` | Full CSV content |
| `{{csv_filename}}` | Suggested filename |
| `{{scan_count}}` | Number of scans |
| `{{date_range}}` | Date range of scans |
| `{{export_time}}` | Export timestamp |
