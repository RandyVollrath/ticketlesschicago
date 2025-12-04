# SnowSOS - Emergency Snow Removal via SMS

A simple MVP for connecting customers who need snow removal with shovelers, entirely via SMS.

## How It Works

1. **Customer** texts their address to your ClickSend number
2. **System** creates a job and broadcasts to all registered shovelers
3. **Shoveler** replies with `CLAIM <job_id>` to accept the job
4. **Customer** receives confirmation that a shoveler is on the way

## Tech Stack

- **Frontend/Backend**: Next.js 14 (App Router)
- **Database**: Supabase (PostgreSQL)
- **SMS**: ClickSend API

## Setup Instructions

### 1. Supabase Setup

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** and run the contents of `supabase/schema.sql`
3. Go to **Settings > API** and copy:
   - Project URL → `SUPABASE_URL`
   - Service Role Key → `SUPABASE_SERVICE_ROLE_KEY`

### 2. ClickSend Setup

1. Create an account at [clicksend.com](https://clicksend.com)
2. Purchase a dedicated phone number
3. Go to **Dashboard > API Credentials** and copy:
   - Username → `CLICKSEND_USERNAME`
   - API Key → `CLICKSEND_API_KEY`

### 3. Local Development

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env.local

# Edit .env.local with your credentials
# Then start the dev server
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000)

### 4. Deploy to Vercel

1. Push your code to GitHub
2. Go to [vercel.com](https://vercel.com) and import your repository
3. Add environment variables in Vercel project settings:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `CLICKSEND_USERNAME`
   - `CLICKSEND_API_KEY`
4. Deploy!

### 5. Configure ClickSend Webhook

After deploying to Vercel:

1. Copy your Vercel deployment URL (e.g., `https://snowsos.vercel.app`)
2. In ClickSend dashboard, go to **SMS > Inbound SMS > Manage**
3. Select your phone number
4. Set the **Inbound SMS URL** to:
   ```
   https://your-domain.vercel.app/api/sms/inbound
   ```
5. Set method to **POST**
6. Save changes

## API Endpoints

### POST /api/sms/inbound
ClickSend webhook endpoint. Handles all inbound SMS messages.

### POST /api/shovelers/add
Add a new shoveler to the system.

```bash
curl -X POST https://your-domain.vercel.app/api/shovelers/add \
  -H "Content-Type: application/json" \
  -d '{"phone": "+13125551234", "name": "John Doe"}'
```

### GET /api/shovelers/add
List all registered shovelers.

### GET /api/jobs/list
List all jobs. Optional query param: `?status=pending|claimed|completed|cancelled`

```bash
# Get all jobs
curl https://your-domain.vercel.app/api/jobs/list

# Get only pending jobs
curl https://your-domain.vercel.app/api/jobs/list?status=pending
```

## SMS Commands

### For Customers
Just text your address:
```
123 Main Street, driveway and sidewalk
```

### For Shovelers
Claim a job:
```
CLAIM abc12345-1234-1234-1234-123456789012
```

## Adding Shovelers

Before the system works, you need to add shovelers:

```bash
curl -X POST https://your-domain.vercel.app/api/shovelers/add \
  -H "Content-Type: application/json" \
  -d '{"phone": "+13125551234", "name": "Shoveler Name"}'
```

Or add them directly in Supabase:
1. Go to your Supabase project
2. Navigate to **Table Editor > shovelers**
3. Click **Insert row**
4. Add phone (in E.164 format like `+13125551234`) and optional name

## Updating the Landing Page

Edit `app/page.tsx` to update the phone number displayed to customers.

## License

MIT
