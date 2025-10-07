# Setup Supabase Storage for Ticket Photos

Since storage buckets need to be created through the Supabase Dashboard, follow these steps:

## Create Storage Bucket

1. Go to **Supabase Dashboard** → **Storage**
2. Click **"New bucket"**
3. Enter these settings:
   - **Name**: `ticket-photos`
   - **Public bucket**: ✅ **YES** (checked)
   - Click **"Create bucket"**

## Set Up RLS Policies

After creating the bucket, go to **Storage** → **Policies** → **ticket-photos bucket**

Click **"New Policy"** and create these 3 policies:

### Policy 1: Users can upload their own photos
- **Policy name**: `Users can upload ticket photos`
- **Allowed operation**: INSERT
- **Target roles**: authenticated
- **USING expression**: Leave empty
- **WITH CHECK expression**:
```sql
bucket_id = 'ticket-photos' AND (storage.foldername(name))[1] = auth.uid()::text
```

### Policy 2: Users can view their own photos
- **Policy name**: `Users can view own ticket photos`
- **Allowed operation**: SELECT
- **Target roles**: authenticated
- **USING expression**:
```sql
bucket_id = 'ticket-photos' AND (storage.foldername(name))[1] = auth.uid()::text
```

### Policy 3: Admins can view all photos
- **Policy name**: `Admins can view all ticket photos`
- **Allowed operation**: SELECT
- **Target roles**: authenticated
- **USING expression**:
```sql
bucket_id = 'ticket-photos' AND auth.jwt() ->> 'email' IN ('randyvollrath@gmail.com', 'carenvollrath@gmail.com')
```

## That's it!

The bucket is now ready to accept ticket photo uploads from Protection users.
