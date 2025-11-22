# Mobile Programming Access Setup

**Goal**: Program on your phone/tablet with readable text and full MCP access

**Status**: ⏳ In Progress

---

## Why This Solution?

- ✅ Secure encrypted connection (Tailscale VPN)
- ✅ Access your dev machine from anywhere
- ✅ Full terminal access with readable fonts
- ✅ MCP server works exactly the same
- ✅ Free for personal use
- ✅ No port forwarding or firewall config needed

---

## Step 1: Install Tailscale on Your Dev Machine

**On your Linux machine (this one):**

```bash
# Install Tailscale
curl -fsSL https://tailscale.com/install.sh | sh

# Start Tailscale and authenticate
sudo tailscale up

# Get your machine's Tailscale IP
tailscale ip -4
```

**Save the IP address** - it will look like `100.x.x.x`

---

## Step 2: Install Tailscale on Your Mobile Device

**On your phone/tablet:**

1. **Install Tailscale app:**
   - **Android**: https://play.google.com/store/apps/details?id=com.tailscale.ipn
   - **iOS**: https://apps.apple.com/us/app/tailscale/id1470499037

2. **Open Tailscale app**
3. **Sign in** with the same account you used on desktop
4. **Enable VPN** - You should see your dev machine listed

---

## Step 3: Install Termius (Best Mobile SSH Client)

**On your phone/tablet:**

1. **Install Termius:**
   - **Android**: https://play.google.com/store/apps/details?id=com.server.auditor.ssh.client
   - **iOS**: https://apps.apple.com/us/app/termius-ssh-client/id549039908

2. **Open Termius**
3. **Create new host:**
   - **Label**: "Dev Machine"
   - **Address**: `100.x.x.x` (your Tailscale IP from Step 1)
   - **Username**: `randy-vollrath`
   - **Password/Key**: Your user password or SSH key

4. **Font Settings (Important!):**
   - Open Termius settings
   - **Font Size**: 14-16 (large enough to read without zooming)
   - **Theme**: Pick one with good contrast (e.g., "Dracula", "Solarized Dark")

---

## Step 4: Test Connection

**From Termius on mobile:**

```bash
# You should now be in your dev machine's terminal
pwd
# Should show: /home/randy-vollrath

cd ticketless-chicago
ls

# Test Claude Code
claude
```

---

## Alternative: Blink Shell (iOS - More Powerful)

If you're on iOS and want a more powerful terminal:

1. **Install Blink Shell**: https://apps.apple.com/us/app/blink-shell-mosh-ssh-client/id1156707581
2. **Add host** with your Tailscale IP
3. **Supports mosh** (better for unstable connections)
4. **Better keyboard** for coding

---

## Using MCP from Mobile

Once connected via SSH:

```bash
# Your MCP server is already running locally
# Just use Claude Code normally:
claude

# Or run your MCP client directly:
npx @anthropic-ai/claude-code
```

**Everything works the same** because you're literally on your dev machine.

---

## Pro Tips for Mobile Coding

1. **Font Size**: Start at 14-16pt, adjust as needed
2. **Landscape Mode**: Easier for coding
3. **External Keyboard**: Bluetooth keyboard makes a huge difference
4. **Dark Theme**: Easier on eyes for long sessions
5. **Screen Time**: Take breaks - mobile screens are smaller

---

## Troubleshooting

### Can't connect from Termius?
1. Check Tailscale is running on both devices (green checkmark in app)
2. Verify IP with `tailscale ip -4` on dev machine
3. Make sure SSH is enabled: `sudo systemctl status sshd`

### Text too small?
- Termius: Settings → Appearance → Font Size → 16+
- Blink Shell: Settings → Appearance → Font Size → 16+

### Keyboard doesn't work well?
- Enable "Extended Keyboard" in app settings
- Consider Bluetooth keyboard for serious coding

---

## Next Steps After Setup

Once you can SSH from mobile:

1. **Test Claude Code**: `claude` should work normally
2. **Check FOIA demo**: Navigate to http://localhost:3000/foia-demo
3. **Run dev server**: `npm run dev` (access via Tailscale IP)

---

## Cost

- **Tailscale**: Free for personal use (up to 100 devices)
- **Termius**: Free version works great (paid has sync features)
- **Blink Shell**: $20 one-time purchase (iOS only)

---

## Security Notes

- Tailscale uses WireGuard (military-grade encryption)
- Only you can access your devices
- No exposed ports or firewall changes needed
- Can disconnect/revoke access anytime

---

## Ready to Start?

Run this on your dev machine now:

```bash
# Install Tailscale
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
tailscale ip -4
```

Then follow steps 2-4 on your mobile device!
